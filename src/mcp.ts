/**
 * `telepatia mcp`: a Model Context Protocol server over stdio, so Claude (Claude Code,
 * Claude Desktop, any MCP client) can use Telepatia Scribe as native tools:
 *
 *   claude mcp add telepatia -- telepatia mcp
 *
 * Hand-rolled JSON-RPC (newline-delimited, the MCP stdio transport) to keep the CLI
 * dependency-free. stdout carries protocol messages only; logs go to stderr.
 * It reuses the CLI's session: log in once with `telepatia login`.
 */
import { createInterface } from "node:readline";
import { regenerateNote, resolveSession } from "./api/aiBackend.js";
import { gql } from "./api/graphql.js";
import { GET_PATIENT, GET_PATIENTS, GET_TEMPLATE, PATIENT_TIMELINE, SEARCH_PATIENTS, SESSION_STATUSES } from "./api/queries.js";
import { currentClaims } from "./auth/session.js";
import { loadSession } from "./auth/store.js";
import { sortFilter } from "./commands/patients.js";
import { submitAudio } from "./commands/upload.js";
import { VERSION } from "./config.js";
import { CliError, describeError, EXIT } from "./errors.js";
import { prune } from "./output.js";
import {
  consultationSummary,
  countConsultations,
  fetchSession,
  getTranscript,
  listConsultations,
  listTemplates,
  resolveTemplate,
  sessionToMarkdown,
  waitForSession,
} from "./sessions.js";

type Args = Record<string, any>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run: (a: Args) => Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const int = (description: string, dflt: number, max: number) => ({ type: "integer", description, default: dflt, minimum: 0, maximum: max });

const READ = { readOnlyHint: true, openWorldHint: true };

const lastVisitOf = (p: Args) => p.lastConsultation ?? p.lastSession?.createdAt ?? null;
const patientSummary = (p: Args) => ({
  id: p.id,
  name: p.fullName ?? p.patientName ?? null,
  ids: p.identifications?.map((i: Args) => `${i.idType ?? ""} ${i.idValue ?? ""}`.trim()),
  lastVisit: lastVisitOf(p),
});

const tools: Tool[] = [
  {
    name: "whoami",
    title: "Cuenta activa",
    description: "Cuenta de Telepatia Scribe con la que está autenticado el CLI (email, institución, roles). Úsala para comprobar la sesión.",
    inputSchema: obj({}),
    annotations: READ,
    async run() {
      const c = await currentClaims();
      const acct = loadSession()?.availableAccounts.find((a) => a.accountId === c.accountId);
      return { email: c.email, accountId: c.accountId, institution: acct?.institutionName, roles: c.roles, country: c.country };
    },
  },
  {
    name: "list_consultations",
    title: "Listar consultas",
    description:
      "Consultas médicas del usuario, más recientes primero. Devuelve id, fecha, estado, paciente y plantilla. " +
      "Usa `search` para filtrar por nombre de paciente u otros campos, y `count_only` para saber el total.",
    inputSchema: obj({
      search: str("texto a buscar (p.ej. nombre del paciente)"),
      status: { type: "array", items: { type: "string", enum: [...SESSION_STATUSES] }, description: "filtrar por estados" },
      limit: int("cuántas devolver", 20, 100),
      offset: int("saltar las primeras N (paginación)", 0, 100000),
      count_only: { type: "boolean", description: "solo devolver el total", default: false },
    }),
    annotations: READ,
    async run(a) {
      const opts = { search: a.search, status: a.status, limit: a.limit ?? 20, offset: a.offset ?? 0 };
      if (a.count_only) return { totalCount: await countConsultations(opts) };
      return (await listConsultations(opts)).map(consultationSummary);
    },
  },
  {
    name: "get_consultation",
    title: "Nota clínica de una consulta",
    description:
      "Nota clínica de una consulta en Markdown: secciones de la plantilla, códigos CIE y advertencias de verificación de la IA. " +
      "Con `include_transcript` añade la transcripción (puede ser larga).",
    inputSchema: obj({ id: str("id de la consulta"), include_transcript: { type: "boolean", default: false } }, ["id"]),
    annotations: READ,
    run: async (a) => sessionToMarkdown(await fetchSession(a.id), { transcript: Boolean(a.include_transcript) }),
  },
  {
    name: "get_transcript",
    title: "Transcripción de una consulta",
    description: "Transcripción de la consulta en texto plano (la versión anonimizada del servidor si es la única disponible).",
    inputSchema: obj({ id: str("id de la consulta") }, ["id"]),
    annotations: READ,
    async run(a) {
      const t = await getTranscript(await fetchSession(a.id));
      if (!t) throw new CliError("Esta consulta todavía no tiene transcripción.", EXIT.NOT_FOUND);
      return (t.anonymized ? "(transcripción anonimizada por Telepatia)\n\n" : "") + t.text;
    },
  },
  {
    name: "wait_consultation",
    title: "Esperar a que termine una consulta",
    description:
      "Espera a que una consulta termine de procesarse (transcripción + nota) y devuelve su estado. " +
      "Si se agota `timeout_seconds` devuelve un error `timeout`: vuelve a llamarla.",
    inputSchema: obj({ id: str("id de la consulta"), timeout_seconds: int("espera máxima", 100, 600) }, ["id"]),
    annotations: READ,
    async run(a) {
      const status = await waitForSession(a.id, (a.timeout_seconds ?? 100) / 60, () => {});
      return { id: a.id, status };
    },
  },
  {
    name: "create_consultation_from_audio",
    title: "Crear consulta desde un audio",
    description:
      "Crea una consulta subiendo un archivo de audio local (wav, flac, ogg, opus, aiff; mp3/m4a se convierten con ffmpeg; máx. 100 MB) " +
      "y Telepatia genera transcripción y nota. Devuelve el id enseguida; luego usa wait_consultation y get_consultation. " +
      "Requiere el consentimiento del paciente para procesar el audio.",
    inputSchema: obj(
      {
        file_path: str("ruta absoluta del audio"),
        template: str("id o nombre de la plantilla (ver list_templates); obligatoria si hay varias"),
        patient_id: str("id de un paciente existente (ver search_patients)"),
        telemedicine: { type: "boolean", default: false },
        external_id: str("id de la consulta en el sistema/EMR del usuario"),
      },
      ["file_path"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(a) {
      const template = await resolveTemplate(a.template);
      const id = await submitAudio({
        file: a.file_path,
        templateId: template.id,
        patientId: a.patient_id,
        telemedicine: a.telemedicine,
        externalId: a.external_id,
      });
      return { id, status: "processing", template: template.name, next: "wait_consultation" };
    },
  },
  {
    name: "regenerate_note",
    title: "Regenerar la nota",
    description: "Vuelve a generar la nota clínica de una consulta a partir de su transcripción (opcionalmente con otra plantilla). Sobrescribe la nota actual.",
    inputSchema: obj({ id: str("id de la consulta"), template_id: str("plantilla a usar") }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async run(a) {
      const r = await regenerateNote(a.id, a.template_id);
      return { id: a.id, status: r?.status ?? "requested", next: "wait_consultation" };
    },
  },
  {
    name: "recover_consultation",
    title: "Recuperar consulta atascada",
    description: "Pide al servidor finalizar una consulta que quedó atascada procesando (lo mismo que 'recuperar' en la web).",
    inputSchema: obj({ id: str("id de la consulta") }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: (a) => resolveSession(a.id),
  },
  {
    name: "search_patients",
    title: "Buscar pacientes",
    description: "Busca pacientes por nombre o número de identificación.",
    inputSchema: obj({ query: str("nombre o identificación"), limit: int("cuántos", 10, 50) }, ["query"]),
    annotations: READ,
    async run(a) {
      const { searchScribePatients } = await gql<{ searchScribePatients: Args[] }>(SEARCH_PATIENTS, { query: a.query, limit: a.limit ?? 10, offset: 0 });
      return searchScribePatients.map(patientSummary);
    },
  },
  {
    name: "list_patients",
    title: "Listar pacientes",
    description: "Pacientes del usuario. `sort: recent` ordena por última consulta pero omite a los pacientes sin consultas; sin `sort` se listan todos.",
    inputSchema: obj({
      limit: int("cuántos", 25, 100),
      offset: int("saltar N", 0, 100000),
      sort: { type: "string", enum: ["name", "recent"] },
    }),
    annotations: READ,
    async run(a) {
      const { getPatients } = await gql<{ getPatients: { patients: Args[]; totalCount: number } }>(GET_PATIENTS, {
        filter: { limit: a.limit ?? 25, offset: a.offset ?? 0, includeAnonymousPatients: false, ...sortFilter(a.sort) },
      });
      return { totalCount: getPatients.totalCount, patients: getPatients.patients.map(patientSummary) };
    },
  },
  {
    name: "get_patient",
    title: "Datos de un paciente",
    description: "Datos de contacto e identificación de un paciente.",
    inputSchema: obj({ id: str("id del paciente") }, ["id"]),
    annotations: READ,
    async run(a) {
      const { scribePatient } = await gql<{ scribePatient: Args | null }>(GET_PATIENT, { id: a.id });
      if (!scribePatient) throw new CliError(`No se encontró el paciente ${a.id}`, EXIT.NOT_FOUND);
      return scribePatient;
    },
  },
  {
    name: "patient_history",
    title: "Historial de un paciente",
    description: "Consultas previas de un paciente (más recientes primero) con el resumen de cada una. Usa get_consultation para la nota completa.",
    inputSchema: obj({ id: str("id del paciente"), limit: int("cuántas", 20, 100) }, ["id"]),
    annotations: READ,
    async run(a) {
      const { timelineByPatient } = await gql<{ timelineByPatient: { total: number; sessions: Args[] } }>(PATIENT_TIMELINE, {
        input: { patientDocumentId: a.id, limit: a.limit ?? 20, descending: true },
      });
      return {
        total: timelineByPatient.total,
        consultations: timelineByPatient.sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          status: s.status,
          doctor: s.account?.nameFull,
          summary: s.medicalRecordSummary,
        })),
      };
    },
  },
  {
    name: "list_templates",
    title: "Listar plantillas",
    description: "Plantillas de nota clínica disponibles (id y nombre). Se usan al crear o regenerar una consulta.",
    inputSchema: obj({}),
    annotations: READ,
    run: async () => (await listTemplates()).map((t) => ({ id: t.id, name: t.name, type: t.type, specialties: t.specialties })),
  },
  {
    name: "get_template",
    title: "Detalle de una plantilla",
    description: "Secciones de una plantilla y las instrucciones que sigue la IA para redactar cada una.",
    inputSchema: obj({ id: str("id de la plantilla"), lang: { type: "string", default: "es" } }, ["id"]),
    annotations: READ,
    async run(a) {
      const { scribeSessionConfiguration: t } = await gql<{ scribeSessionConfiguration: Args | null }>(GET_TEMPLATE, { id: a.id });
      if (!t) throw new CliError(`No existe la plantilla ${a.id}`, EXIT.NOT_FOUND);
      const lang = a.lang ?? "es";
      const nodes = [...(t.nodes ?? [])].filter((n: Args) => n.enabled !== false && !n.hidden).sort((x: Args, y: Args) => (x.order ?? 0) - (y.order ?? 0));
      const body = nodes.map((n: Args) => {
        const title = n.name?.[lang] ?? n.name?.default ?? n.key;
        const instr = n.instruction?.[lang] ?? n.instruction?.default;
        return `## ${title} (${n.key})${instr ? `\n\n${instr}` : ""}`;
      });
      return [`# ${t.name}${t.description ? ` — ${t.description}` : ""}`, ...body].join("\n\n");
    },
  },
];

const INSTRUCTIONS = `Telepatia Scribe: escriba médico con IA. Estas herramientas leen y crean consultas médicas del usuario autenticado (datos de salud sensibles: no los copies fuera de la conversación sin que te lo pidan).
Flujo típico: list_consultations → get_consultation (nota en Markdown). Para una consulta nueva: list_templates → create_consultation_from_audio → wait_consultation (repite si da timeout) → get_consultation.
Si una herramienta responde auth_required, pide al usuario ejecutar en su terminal: telepatia login (o telepatia login --otp <email> y luego --code).`;

function toolResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(prune(value) ?? null);
  return { content: [{ type: "text", text }] };
}

async function handle(method: string, params: Args): Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "telepatia", title: "Telepatia Scribe", version: VERSION },
        instructions: INSTRUCTIONS,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: tools.map(({ run: _run, ...t }) => t) };
    case "tools/call": {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) throw Object.assign(new Error(`Herramienta desconocida: ${params?.name}`), { rpcCode: -32602 });
      try {
        return toolResult(await tool.run(params.arguments ?? {}));
      } catch (err) {
        const e = describeError(err);
        return { ...toolResult({ error: e.code, message: e.message.split("\n")[0], hint: e.hint }), isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Método no soportado: ${method}`), { rpcCode: -32601 });
  }
}

export async function runMcpServer(): Promise<void> {
  const send = (msg: unknown): void => void process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  process.stderr.write(`telepatia mcp ${VERSION} listo (stdio)\n`);

  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: Args;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    if (msg.id === undefined || msg.id === null) continue; // notifications (initialized, cancelled…)
    const p = handle(msg.method, msg.params ?? {})
      .then((result) => send({ jsonrpc: "2.0", id: msg.id, result }))
      .catch((err) => send({ jsonrpc: "2.0", id: msg.id, error: { code: err.rpcCode ?? -32603, message: err.message } }))
      .finally(() => pending.delete(p));
    pending.add(p);
  }
  await Promise.all(pending);
}
