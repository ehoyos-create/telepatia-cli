import { getAnonymizedTranscript } from "./api/aiBackend.js";
import { gql } from "./api/graphql.js";
import { GET_SESSION, GET_SESSION_STATUS, GET_TEMPLATE, LIST_TEMPLATES, TERMINAL_STATUSES } from "./api/queries.js";
import { currentClaims } from "./auth/session.js";
import { CliError } from "./errors.js";
import { noteSections, sectionsToMarkdown, transcriptToText, type TemplateNode } from "./note.js";
import { c, choose, fmtDate, info, sleep } from "./ui.js";

export type Session = Record<string, any>;

export async function fetchSession(id: string): Promise<Session> {
  const { scribeSession } = await gql<{ scribeSession: Session | null }>(GET_SESSION, { id });
  if (!scribeSession) throw new CliError(`No se encontró la consulta ${id}`);
  return scribeSession;
}

async function templateNodes(templateId: string | null | undefined): Promise<TemplateNode[]> {
  if (!templateId) return [];
  try {
    const { scribeSessionConfiguration } = await gql<{ scribeSessionConfiguration: { nodes?: TemplateNode[] } | null }>(GET_TEMPLATE, {
      id: templateId,
    });
    return scribeSessionConfiguration?.nodes ?? [];
  } catch {
    return []; // titles fall back to defaults
  }
}

export async function sessionToMarkdown(s: Session, opts: { transcript?: boolean } = {}): Promise<string> {
  const nodes = await templateNodes(s.scribeSessionConfigurationId ?? s.scribeSessionConfiguration?.id);
  const sections = noteSections(s.medicalRecordMutable, s.medicalRecordOrder, { nodes, locale: s.language ?? "es" });
  const patient = s.patient?.fullName ?? s.patientName ?? "Sin paciente";
  const head = [
    `# ${patient}`,
    "",
    `- **Consulta:** ${s.id}`,
    `- **Fecha:** ${fmtDate(s.createdAt)}`,
    `- **Estado:** ${s.status}`,
    ...(s.selectedTemplates?.length
      ? [
          `- **Plantilla:** ${s.selectedTemplates
            .map((t: any) => t.nameSnapshot)
            .filter(Boolean)
            .join(", ")}`,
        ]
      : []),
  ];
  const codes = s.effectiveDiagnosisCodes;
  const dx = [codes?.primary, ...(codes?.secondary ?? [])].filter(Boolean);
  const parts = [head.join("\n")];
  parts.push(sections.length ? sectionsToMarkdown(sections) : "_La nota todavía no está disponible._");
  if (dx.length) parts.push("## Códigos diagnósticos\n\n" + dx.map((d: any) => `- ${d.code} — ${d.description}`).join("\n"));
  if (s.hallucinationWarnings?.length) {
    parts.push(
      "## ⚠️ Advertencias de verificación\n\n" +
        s.hallucinationWarnings.map((w: any) => `- [${w.sectionKey}] "${w.quotedText}" — ${w.reason}`).join("\n"),
    );
  }
  if (opts.transcript) {
    const t = await getTranscript(s);
    parts.push(`## Transcripción${t?.anonymized ? " (anonimizada)" : ""}\n\n` + (t?.text || "_(sin transcripción)_"));
  }
  return parts.join("\n\n") + "\n";
}

/**
 * The transcript. The datalayer's `transcript` field is usually empty; like the web app,
 * fall back to the server's anonymized transcript (the only version the web UI shows).
 */
export async function getTranscript(s: Session): Promise<{ text: string; anonymized: boolean } | null> {
  const direct = transcriptToText(s.transcript);
  if (direct) return { text: direct, anonymized: false };
  const anon = await getAnonymizedTranscript(s.id);
  return anon ? { text: anon, anonymized: true } : null;
}

/** Polls until the session reaches a terminal status. */
export async function waitForSession(
  id: string,
  timeoutMin = 30,
  onStatus: (status: string) => void = (st) => info(c.dim(`  estado: ${st}`)),
): Promise<string> {
  const deadline = Date.now() + timeoutMin * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const { scribeSession } = await gql<{ scribeSession: { status: string; error?: unknown } | null }>(GET_SESSION_STATUS, { id });
    const status = scribeSession?.status ?? "unknown";
    if (status !== last) {
      onStatus(status);
      last = status;
    }
    if (TERMINAL_STATUSES.has(status)) return status;
    await sleep(5000);
  }
  throw new CliError(`Tiempo de espera agotado (${timeoutMin} min). Revisa luego con: telepatia consultations show ${id}`);
}

export interface Template {
  id: string;
  name: string;
  type?: string;
  order?: number;
  specialties?: string[];
  deletedAt?: string | null;
}

export async function listTemplates(): Promise<Template[]> {
  const { accountId } = await currentClaims();
  const { scribeSessionConfigurations } = await gql<{ scribeSessionConfigurations: Template[] }>(LIST_TEMPLATES, {
    filter: { accountIds: [accountId] },
  });
  return scribeSessionConfigurations.filter((t) => !t.deletedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Resolves --template (id or case-insensitive name) or asks interactively. */
export async function resolveTemplate(arg?: string): Promise<Template> {
  const templates = await listTemplates();
  if (!templates.length) throw new CliError("Tu cuenta no tiene plantillas. Crea una en scribe.telepatia.ai/templates.");
  if (arg) {
    const t = templates.find((x) => x.id === arg) ?? templates.find((x) => x.name.toLowerCase() === arg.toLowerCase());
    if (!t) throw new CliError(`No existe la plantilla "${arg}". Ver: telepatia templates`);
    return t;
  }
  if (templates.length === 1) return templates[0];
  if (!process.stdin.isTTY) throw new CliError("Indica la plantilla con --template <id|nombre>. Ver: telepatia templates");
  return choose("Plantilla", templates, (t) => t.name);
}
