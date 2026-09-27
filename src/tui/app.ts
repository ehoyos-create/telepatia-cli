import * as p from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { regenerateNote, resolveSession } from "../api/aiBackend.js";
import { gql } from "../api/graphql.js";
import {
  DELETE_SESSION,
  GET_PATIENT,
  GET_TEMPLATE,
  LIST_SESSIONS,
  PATIENT_TIMELINE,
  SEARCH_PATIENTS,
  GET_PATIENTS,
  SESSION_STATUSES,
  UPSERT_PATIENT,
} from "../api/queries.js";
import { authcentral, type LoginResult } from "../auth/authcentral.js";
import { decodeJwt } from "../auth/jwt.js";
import { currentClaims, getAccessToken, persistTokens } from "../auth/session.js";
import { clearSession, loadSession, type AccountSummary } from "../auth/store.js";
import { lastVisitOf } from "../commands/patients.js";
import { recordToFile } from "../commands/record.js";
import { submitAudio } from "../commands/upload.js";
import { endpoints } from "../config.js";
import { CliError, HttpError } from "../errors.js";
import { fetchSession, getTranscript, listTemplates, sessionToMarkdown, waitForSession, type Session, type Template } from "../sessions.js";
import { c } from "../theme.js";
import { fmtDate, sleep } from "../ui.js";
import { banner, miniHeader } from "./banner.js";
import { renderMarkdown, statusBadge, statusLabel } from "./render.js";

/** Thrown to unwind back to the main menu when the user presses Esc/Ctrl+C in a prompt. */
class Back extends Error {}

/** Unwraps a clack result; a cancelled prompt navigates back. */
function ok<T>(v: T): Exclude<T, symbol> {
  if (p.isCancel(v)) throw new Back();
  return v as Exclude<T, symbol>;
}

const BACK = "__back__";
const errorMessage = (err: unknown) => {
  if (err instanceof CliError) return err.message;
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return "No tienes permiso para esto (o tu sesión expiró).";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
};

/** Runs an action with a spinner; errors are shown and swallowed so the menu keeps working. */
async function withSpinner<T>(label: string, fn: (update: (m: string) => void) => Promise<T>): Promise<T | undefined> {
  const s = p.spinner();
  s.start(label);
  try {
    const r = await fn((m) => s.message(m));
    s.stop(c.green("✓ ") + label.replace(/…$/, ""));
    return r;
  } catch (err) {
    s.error(c.red("✗ ") + errorMessage(err));
    return undefined;
  }
}

// ─── Login ────────────────────────────────────────────────────────────────

async function finishLogin(result: LoginResult): Promise<void> {
  for (;;) {
    if (result.mfaChallenge) {
      const code = ok(
        await p.text({
          message: `Código de verificación${result.mfaChallenge.emailHint ? ` (enviado a ${result.mfaChallenge.emailHint})` : ""}`,
          placeholder: "123456",
          validate: (v = "") => (/^\d{6}$/.test(v) ? undefined : "Son 6 dígitos"),
        }),
      );
      result = await authcentral.verify2fa(result.mfaChallenge.challengeToken, code);
      continue;
    }
    if (result.requiresInstitutionSelection && result.preAuthToken && result.accounts?.length) {
      const acc = ok(
        await p.select({
          message: "¿Con qué institución quieres entrar?",
          options: result.accounts.map((a) => ({ value: a.accountId, label: a.institutionName, hint: a.roles.join(", ") })),
        }),
      );
      result = await authcentral.selectAccount(result.preAuthToken, acc);
      continue;
    }
    if (result.token) {
      persistTokens(result.token, result.availableAccounts ?? result.accounts ?? []);
      return;
    }
    throw new CliError("Respuesta de login inesperada.");
  }
}

async function loginScreen(): Promise<boolean> {
  p.log.message(c.muted("Inicia sesión con tu cuenta de Telepatia Scribe."));
  const method = ok(
    await p.select({
      message: "¿Cómo quieres entrar?",
      options: [
        { value: "password", label: "Email y contraseña" },
        { value: "otp", label: "Código por email o WhatsApp", hint: "sin contraseña" },
        { value: "device", label: "Aprobar desde la app móvil" },
        { value: "exit", label: "Salir" },
      ],
    }),
  );
  if (method === "exit") return false;

  try {
    if (method === "device") {
      const start = await authcentral.deviceStart();
      p.note(
        `${c.bold(c.brandLight(start.user_code))}\n\n${c.muted("Abre la app de Telepatia en tu celular y aprueba el inicio de sesión.")}\n${c.subtle(`${endpoints.web}/device-login?code=${start.user_code}`)}`,
        "Código",
      );
      const s = p.spinner();
      s.start("Esperando aprobación…");
      let interval = Math.max(1, start.interval) * 1000;
      const deadline = Date.now() + start.expires_in * 1000;
      while (Date.now() < deadline) {
        await sleep(interval);
        const r = await authcentral.devicePoll(start.device_code);
        if (r.state === "ok") {
          persistTokens(r);
          s.stop(c.green("✓ Aprobado"));
          return true;
        }
        if (r.state === "expired") break;
        if (r.state === "slow_down") interval = Math.min(interval * 2, 20_000);
      }
      s.error(c.red("El código expiró"));
      return loginScreen();
    }

    const email = ok(
      await p.text({ message: "Email", placeholder: "tu@correo.com", validate: (v = "") => (/\S+@\S+/.test(v) ? undefined : "Email inválido") }),
    );

    if (method === "otp") {
      const ch = await authcentral.passwordlessStart(email, "auto");
      p.log.info(`Te enviamos un código por ${ch.channel}${ch.hint ? ` a ${ch.hint}` : ""}.`);
      for (let i = 0; i < 5; i++) {
        const code = ok(await p.text({ message: "Código", placeholder: "123456" }));
        try {
          await finishLogin(await authcentral.passwordlessVerify(ch.challengeToken, code.trim()));
          return true;
        } catch (err) {
          if (err instanceof HttpError && [400, 401, 422].includes(err.status)) {
            p.log.error("Código incorrecto, intenta de nuevo.");
            continue;
          }
          throw err;
        }
      }
      throw new CliError("Demasiados intentos.");
    }

    const password = ok(await p.password({ message: "Contraseña", mask: "•" }));
    await finishLogin(await authcentral.login(email, password));
    return true;
  } catch (err) {
    if (err instanceof Back) throw err;
    if (err instanceof HttpError && err.status === 401) p.log.error("Email o contraseña incorrectos.");
    else if (err instanceof HttpError && err.code === "email_not_verified") p.log.error("Tu email no está verificado.");
    else p.log.error(errorMessage(err));
    return loginScreen();
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────

function sessionOption(s: Session) {
  const who = s.patient?.fullName ?? s.patientName ?? "Sin paciente";
  const tpl = s.selectedTemplates?.find((t: any) => t.isPrimary)?.nameSnapshot ?? s.scribeSessionConfiguration?.name ?? "";
  return {
    value: s.id as string,
    label: `${who}  ${c.subtle(fmtDate(s.createdAt))}`,
    hint: `${statusLabel(s.status)}${tpl ? ` · ${tpl}` : ""}`,
  };
}

async function consultationsScreen(initialQuery?: string): Promise<void> {
  const { accountId } = await currentClaims();
  let query = initialQuery;
  let offset = 0;
  const pageSize = 15;
  for (;;) {
    const list = await withSpinner(query ? `Buscando "${query}"…` : "Cargando consultas…", async () => {
      const { scribeSessions } = await gql<{ scribeSessions: Session[] }>(LIST_SESSIONS, {
        filter: {
          accountId,
          status: [...SESSION_STATUSES],
          limit: pageSize,
          offset,
          orderBy: "createdAt",
          orderDirection: "desc",
          ...(query ? { query } : {}),
        },
      });
      return scribeSessions;
    });
    if (!list) return;
    const options: { value: string; label: string; hint?: string }[] = list.map(sessionOption);
    if (!list.length) p.log.warn(query ? "No hay consultas que coincidan." : "Todavía no tienes consultas.");
    options.push({ value: "__search", label: c.brand("⌕ Buscar…"), hint: query ? `actual: "${query}"` : undefined });
    if (list.length === pageSize) options.push({ value: "__next", label: c.brand("→ Más antiguas") });
    if (offset > 0) options.push({ value: "__prev", label: c.brand("← Más recientes") });
    options.push({ value: BACK, label: "← Menú principal" });

    const choice = ok(await p.select({ message: query ? `Consultas · "${query}"` : "Tus consultas", options, maxItems: 12 }));
    if (choice === BACK) return;
    if (choice === "__search") {
      const q = ok(await p.text({ message: "Buscar (paciente, texto…)", placeholder: "vacío = ver todas", defaultValue: "" }));
      query = q.trim() || undefined;
      offset = 0;
      continue;
    }
    if (choice === "__next") {
      offset += pageSize;
      continue;
    }
    if (choice === "__prev") {
      offset = Math.max(0, offset - pageSize);
      continue;
    }
    await consultationDetail(choice);
  }
}

function copyToClipboard(text: string): boolean {
  const cmds: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];
  for (const [cmd, args] of cmds) {
    const r = spawnSync(cmd, args, { input: text });
    if (r.status === 0) return true;
  }
  return false;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

async function consultationDetail(id: string): Promise<void> {
  let s = await withSpinner("Abriendo consulta…", () => fetchSession(id));
  if (!s) return;
  let md = await sessionToMarkdown(s);
  process.stdout.write(renderMarkdown(md));

  for (;;) {
    const done = ["completed", "completedWithErrors", "reviewed"].includes(s.status);
    const action = ok(
      await p.select({
        message: `${s.patient?.fullName ?? s.patientName ?? "Consulta"} · ${statusBadge(s.status)}`,
        options: [
          { value: "note", label: "Ver nota clínica" },
          { value: "transcript", label: "Ver transcripción" },
          { value: "copy", label: "Copiar nota al portapapeles" },
          { value: "export", label: "Guardar como archivo", hint: "Markdown" },
          ...(done ? [] : [{ value: "recover", label: "Destrabar consulta", hint: "si quedó procesando" }]),
          { value: "regenerate", label: "Regenerar nota" },
          { value: "delete", label: c.red("Eliminar consulta") },
          { value: BACK, label: "← Volver" },
        ],
      }),
    );
    try {
      switch (action) {
        case BACK:
          return;
        case "note":
          process.stdout.write(renderMarkdown(md));
          break;
        case "transcript": {
          const cur = s;
          const t = await withSpinner("Cargando transcripción…", () => getTranscript(cur));
          if (t === null) p.log.warn("Esta consulta todavía no tiene transcripción.");
          else if (t) process.stdout.write(renderMarkdown(`## Transcripción${t.anonymized ? " (anonimizada)" : ""}\n\n${t.text}`));
          break;
        }
        case "copy":
          if (copyToClipboard(md)) p.log.success("Nota copiada al portapapeles.");
          else p.log.warn("No encontré una herramienta de portapapeles (pbcopy, clip, wl-copy o xclip).");
          break;
        case "export": {
          const name = `${slug(s.patient?.fullName ?? s.patientName ?? "consulta")}-${(s.createdAt ?? "").slice(0, 10)}.md`;
          const includeT = ok(await p.confirm({ message: "¿Incluir la transcripción?", initialValue: false }));
          const path = ok(await p.text({ message: "Guardar en", initialValue: resolve(name) }));
          const body = includeT ? await sessionToMarkdown(s, { transcript: true }) : md;
          await writeFile(path.replace(/^~/, homedir()), body, { mode: 0o600 });
          p.log.success(`Guardado en ${path}`);
          break;
        }
        case "regenerate": {
          if (!ok(await p.confirm({ message: "¿Regenerar la nota? Reemplaza la versión actual.", initialValue: false }))) break;
          await withSpinner("Regenerando nota…", async (update) => {
            await regenerateNote(id);
            await sleep(3000);
            await waitForSession(id, 30, (st) => update(`Regenerando nota… (${statusLabel(st)})`));
          });
          s = (await fetchSession(id)) ?? s;
          md = await sessionToMarkdown(s);
          process.stdout.write(renderMarkdown(md));
          break;
        }
        case "recover": {
          const r = await withSpinner("Pidiendo al servidor que finalice la consulta…", () => resolveSession(id));
          if (r) p.log.info(`Nuevo estado: ${r.newStatus ?? "?"}${r.actionsTaken?.length ? ` · ${r.actionsTaken.join(", ")}` : ""}`);
          s = (await fetchSession(id)) ?? s;
          md = await sessionToMarkdown(s);
          break;
        }
        case "delete": {
          const sure = ok(
            await p.confirm({ message: c.red("¿Eliminar esta consulta? No se puede deshacer desde aquí."), initialValue: false }),
          );
          if (!sure) break;
          await gql(DELETE_SESSION, { id, input: { status: "deleted" }, updateMode: "merge" });
          p.log.success("Consulta eliminada.");
          return;
        }
      }
    } catch (err) {
      if (err instanceof Back) continue;
      p.log.error(errorMessage(err));
    }
  }
}

// ─── Nueva consulta ───────────────────────────────────────────────────────

async function pickTemplate(): Promise<Template> {
  const templates = await withSpinner("Cargando plantillas…", () => listTemplates());
  if (!templates?.length) throw new CliError("Tu cuenta no tiene plantillas. Crea una en scribe.telepatia.ai/templates.");
  if (templates.length === 1) return templates[0];
  const id = ok(
    await p.select({
      message: "Plantilla de la nota",
      options: templates.map((t) => ({ value: t.id, label: t.name, hint: (t.specialties ?? []).join(", ") || undefined })),
      maxItems: 10,
    }),
  );
  return templates.find((t) => t.id === id)!;
}

async function pickPatient(): Promise<{ id: string; name: string } | undefined> {
  const how = ok(
    await p.select({
      message: "Paciente",
      options: [
        { value: "search", label: "Buscar paciente existente" },
        { value: "new", label: "Crear paciente nuevo" },
        { value: "none", label: "Sin paciente", hint: "puedes asignarlo luego en la web" },
      ],
    }),
  );
  if (how === "none") return undefined;
  if (how === "new") {
    const name = ok(await p.text({ message: "Nombre completo", validate: (v = "") => (v.trim() ? undefined : "Requerido") }));
    const idValue = ok(await p.text({ message: "Número de documento", placeholder: "opcional", defaultValue: "" }));
    const idType = idValue ? ok(await p.text({ message: "Tipo de documento", placeholder: "CC, CPF, DNI…", defaultValue: "" })) : "";
    const r = await gql<{ updateOrCreateScribePatient: { id: string; fullName: string } }>(UPSERT_PATIENT, {
      input: { fullName: name.trim(), identifications: idValue ? [{ idType: idType || null, idValue }] : [] },
    });
    p.log.success(`Paciente creado: ${r.updateOrCreateScribePatient.fullName}`);
    return { id: r.updateOrCreateScribePatient.id, name: r.updateOrCreateScribePatient.fullName };
  }
  for (;;) {
    const q = ok(
      await p.text({
        message: "Buscar paciente",
        placeholder: "nombre o documento",
        validate: (v = "") => (v.trim() ? undefined : "Escribe algo"),
      }),
    );
    const r = await gql<{ searchScribePatients: any[] }>(SEARCH_PATIENTS, { query: q.trim(), limit: 15, offset: 0 });
    if (!r.searchScribePatients.length) {
      p.log.warn("Sin resultados.");
      continue;
    }
    const id = ok(
      await p.select({
        message: "Elige el paciente",
        options: [
          ...r.searchScribePatients.map((x) => ({
            value: x.id as string,
            label: x.fullName ?? x.patientName ?? "—",
            hint:
              x.identifications
                ?.map((i: any) => i.idValue)
                .filter(Boolean)
                .join(", ") || undefined,
          })),
          { value: "__again", label: c.brand("⌕ Buscar otra vez") },
        ],
      }),
    );
    if (id === "__again") continue;
    const x = r.searchScribePatients.find((y) => y.id === id);
    return { id, name: x?.fullName ?? x?.patientName ?? "" };
  }
}

const cleanPath = (v: string) =>
  v
    .trim()
    .replace(/^['"]|['"]$/g, "") // drag & drop may quote
    .replace(/\\ /g, " ") // or escape spaces
    .replace(/^~/, homedir());

async function newConsultation(): Promise<void> {
  const source = ok(
    await p.select({
      message: "Nueva consulta",
      options: [
        { value: "record", label: "Grabar ahora con el micrófono" },
        { value: "upload", label: "Subir un audio que ya tengo", hint: "wav, mp3, m4a, flac…" },
        { value: BACK, label: "← Volver" },
      ],
    }),
  );
  if (source === BACK) return;

  let file: string;
  if (source === "upload") {
    file = cleanPath(
      ok(
        await p.text({
          message: "Ruta del audio",
          placeholder: "arrastra el archivo aquí",
          validate: (v = "") => (existsSync(cleanPath(v)) ? undefined : "No encuentro ese archivo"),
        }),
      ),
    );
  }
  const template = await pickTemplate();
  const patient = await pickPatient();

  if (source === "record") {
    p.log.warn("Asegúrate de tener el consentimiento del paciente para grabar.");
    if (!ok(await p.confirm({ message: "¿Empezar a grabar?", initialValue: true }))) return;
    file = await recordToFile();
    p.log.success("Grabación terminada.");
  }

  const id = await withSpinner("Enviando a Telepatia…", async (update) => {
    const sessionId = await submitAudio({ file, templateId: template.id, patientId: patient?.id, onProgress: (m) => update(m) });
    update("Transcribiendo y redactando la nota…");
    await waitForSession(sessionId, 30, (st) => update(`Transcribiendo y redactando la nota… (${statusLabel(st)})`));
    return sessionId;
  });
  if (!id) {
    if (source === "record") p.log.info(c.muted(`El audio sigue guardado en ${file!}`));
    return;
  }
  await consultationDetail(id);
}

// ─── Pacientes ────────────────────────────────────────────────────────────

async function patientsScreen(): Promise<void> {
  for (;;) {
    const q = ok(await p.text({ message: "Buscar paciente", placeholder: "vacío = ver todos", defaultValue: "" }));
    const list = await withSpinner("Buscando…", async () => {
      if (q.trim())
        return (await gql<{ searchScribePatients: any[] }>(SEARCH_PATIENTS, { query: q.trim(), limit: 20, offset: 0 }))
          .searchScribePatients;
      return (
        await gql<{ getPatients: { patients: any[] } }>(GET_PATIENTS, {
          filter: { limit: 20, offset: 0, includeAnonymousPatients: false },
        })
      ).getPatients.patients;
    });
    if (!list) return;
    const id = ok(
      await p.select({
        message: q.trim() ? `Pacientes · "${q.trim()}"` : "Tus pacientes",
        options: [
          ...list.map((x) => ({
            value: x.id as string,
            label: x.fullName ?? x.patientName ?? "—",
            hint: lastVisitOf(x) ? `última: ${fmtDate(lastVisitOf(x))}` : undefined,
          })),
          { value: "__again", label: c.brand("⌕ Buscar otra vez") },
          { value: BACK, label: "← Menú principal" },
        ],
        maxItems: 12,
      }),
    );
    if (id === BACK) return;
    if (id === "__again") continue;
    await patientDetail(id);
  }
}

async function patientDetail(id: string): Promise<void> {
  const data = await withSpinner("Abriendo paciente…", async () => {
    const [{ scribePatient }, { timelineByPatient }] = await Promise.all([
      gql<{ scribePatient: any }>(GET_PATIENT, { id }),
      gql<{ timelineByPatient: { sessions: any[] } }>(PATIENT_TIMELINE, { input: { patientDocumentId: id, limit: 50, descending: true } }),
    ]);
    return { pt: scribePatient, sessions: timelineByPatient.sessions };
  });
  if (!data?.pt) return;
  const { pt, sessions } = data;
  const lines = [
    `${c.muted("Documento")}   ${pt.identifications?.map((i: any) => `${i.idType ?? ""} ${i.idValue ?? ""}`.trim()).join(", ") || "—"}`,
    `${c.muted("Teléfono")}    ${pt.phoneNumbers?.map((x: any) => `+${String(x.countryCode).replace(/^\+/, "")} ${x.phoneNumber}`).join(", ") || "—"}`,
    `${c.muted("Email")}       ${pt.emails?.map((x: any) => x.email).join(", ") || "—"}`,
    `${c.muted("Consultas")}   ${sessions.length}`,
  ];
  p.note(lines.join("\n"), pt.fullName ?? pt.patientName ?? "Paciente");
  for (;;) {
    const choice = ok(
      await p.select({
        message: "Historial",
        options: [
          ...sessions.map((s) => ({
            value: s.id as string,
            label: fmtDate(s.createdAt),
            hint: [statusLabel(s.status), s.account?.nameFull].filter(Boolean).join(" · "),
          })),
          { value: BACK, label: "← Volver" },
        ],
        maxItems: 12,
      }),
    );
    if (choice === BACK) return;
    await consultationDetail(choice);
  }
}

// ─── Plantillas ───────────────────────────────────────────────────────────

async function templatesScreen(): Promise<void> {
  const templates = await withSpinner("Cargando plantillas…", () => listTemplates());
  if (!templates) return;
  for (;;) {
    const id = ok(
      await p.select({
        message: "Tus plantillas",
        options: [...templates.map((t) => ({ value: t.id, label: t.name, hint: t.type })), { value: BACK, label: "← Menú principal" }],
        maxItems: 12,
      }),
    );
    if (id === BACK) return;
    const t = await withSpinner(
      "Cargando secciones…",
      async () => (await gql<{ scribeSessionConfiguration: any }>(GET_TEMPLATE, { id })).scribeSessionConfiguration,
    );
    if (!t) continue;
    const md = [`# ${t.name}`, t.description ?? "", ""];
    for (const n of [...(t.nodes ?? [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))) {
      if (n.enabled === false || n.hidden) continue;
      md.push(
        `## ${n.name?.es ?? n.name?.default ?? n.key}`,
        "",
        n.instruction?.es ?? n.instruction?.default ?? "_(sin instrucciones)_",
        "",
      );
    }
    process.stdout.write(renderMarkdown(md.join("\n")));
  }
}

// ─── Cuenta ───────────────────────────────────────────────────────────────

async function accountScreen(): Promise<"logout" | void> {
  const claims = await currentClaims();
  const session = loadSession();
  const token = await getAccessToken();
  const accounts: AccountSummary[] =
    (await authcentral.availableAccounts(token).catch(() => null))?.accounts ?? session?.availableAccounts ?? [];
  const current = accounts.find((a) => a.accountId === claims.accountId);
  p.note(
    [
      `${c.muted("Email")}        ${claims.email ?? "—"}`,
      `${c.muted("Institución")}  ${current?.institutionName ?? "—"}`,
      `${c.muted("Roles")}        ${(claims.roles ?? []).join(", ") || "—"}`,
    ].join("\n"),
    "Tu cuenta",
  );
  const action = ok(
    await p.select({
      message: "Cuenta",
      options: [
        ...(accounts.length > 1 ? [{ value: "switch", label: "Cambiar de institución" }] : []),
        { value: "logout", label: "Cerrar sesión" },
        { value: BACK, label: "← Menú principal" },
      ],
    }),
  );
  if (action === "switch") {
    const id = ok(
      await p.select({
        message: "Institución",
        options: accounts.map((a) => ({
          value: a.accountId,
          label: a.institutionName,
          hint: a.accountId === claims.accountId ? "actual" : undefined,
        })),
      }),
    );
    const r = await authcentral.switchAccount(token, id);
    if (r.token) persistTokens(r.token, r.availableAccounts ?? accounts);
    p.log.success(`Ahora estás en ${accounts.find((a) => a.accountId === id)?.institutionName}.`);
  }
  if (action === "logout") {
    if (session) await authcentral.logout(session.refreshToken);
    clearSession();
    p.log.success("Sesión cerrada.");
    return "logout";
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function statusLine(): Promise<string> {
  try {
    const claims = await currentClaims();
    const inst = loadSession()?.availableAccounts.find((a) => a.accountId === claims.accountId)?.institutionName;
    return `${c.green("●")} ${c.text(claims.email ?? claims.uid)}${inst ? c.subtle(` · ${inst}`) : ""}`;
  } catch {
    return `${c.subtle("○ sin sesión")}`;
  }
}

const hasSession = () => Boolean(process.env.TELEPATIA_TOKEN || loadSession());

export async function runTui(): Promise<void> {
  process.stdout.write(banner(await statusLine()) + "\n");
  p.intro(miniHeader("inicio"));

  try {
    if (!hasSession()) {
      if (!(await loginScreen())) return void p.outro(c.muted("¡Hasta luego!"));
      p.log.success(`Bienvenido/a, ${c.bold(decodeJwt(await getAccessToken()).email ?? "")}`);
    }

    for (;;) {
      let choice: string;
      try {
        choice = ok(
          await p.select({
            message: "¿Qué quieres hacer?",
            options: [
              { value: "new", label: "Nueva consulta", hint: "grabar o subir audio" },
              { value: "list", label: "Mis consultas", hint: "ver notas y transcripciones" },
              { value: "search", label: "Buscar consulta" },
              { value: "patients", label: "Pacientes" },
              { value: "templates", label: "Plantillas" },
              { value: "account", label: "Mi cuenta", hint: "institución, cerrar sesión" },
              { value: "exit", label: "Salir" },
            ],
          }),
        );
      } catch (err) {
        if (err instanceof Back) break; // Esc/Ctrl+C on the main menu exits
        throw err;
      }
      if (choice === "exit") break;
      try {
        if (choice === "new") await newConsultation();
        if (choice === "list") await consultationsScreen();
        if (choice === "search") {
          const q = ok(await p.text({ message: "Buscar consulta", placeholder: "nombre del paciente, texto…" }));
          await consultationsScreen(q.trim() || undefined);
        }
        if (choice === "patients") await patientsScreen();
        if (choice === "templates") await templatesScreen();
        if (choice === "account" && (await accountScreen()) === "logout") {
          if (!(await loginScreen())) break;
        }
      } catch (err) {
        if (err instanceof Back) continue;
        if (err instanceof CliError && /sesión/.test(err.message)) {
          p.log.error(err.message);
          if (!(await loginScreen())) break;
          continue;
        }
        p.log.error(errorMessage(err));
      }
    }
    p.outro(c.muted("¡Hasta luego! ") + c.brand("▀█▀"));
  } catch (err) {
    if (err instanceof Back) return void p.outro(c.muted("¡Hasta luego!"));
    throw err;
  }
}
