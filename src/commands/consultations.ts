import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { getAnonymizedTranscript, regenerateNote, resolveSession } from "../api/aiBackend.js";
import { gql } from "../api/graphql.js";
import { COUNT_SESSIONS, DELETE_SESSION, LIST_SESSIONS, MEDICAL_RECORD_DOCUMENTS, SESSION_STATUSES } from "../api/queries.js";
import { currentClaims } from "../auth/session.js";
import { CliError } from "../errors.js";
import { fetchSession, getTranscript, sessionToMarkdown, waitForSession, type Session } from "../sessions.js";
import { c, confirm, fmtDate, info, printJson, table } from "../ui.js";

export function registerConsultations(program: Command) {
  const cmd = program.command("consultations").alias("c").description("Consultas: listar, ver notas, transcripciones, exportar");

  cmd
    .command("list", { isDefault: true })
    .description("Lista tus consultas (más recientes primero)")
    .option("-s, --search <texto>", "buscar por paciente u otros campos")
    .option("-n, --limit <n>", "cuántas mostrar", "20")
    .option("--offset <n>", "saltar las primeras N", "0")
    .option("--status <estados>", `filtrar por estado (coma): ${SESSION_STATUSES.join(",")}`)
    .option("--count", "solo mostrar el total")
    .option("--json", "salida JSON")
    .action(async (o) => {
      const { accountId } = await currentClaims();
      const filter: Record<string, unknown> = {
        accountId,
        status: o.status ? String(o.status).split(",") : [...SESSION_STATUSES],
        limit: Number(o.limit),
        offset: Number(o.offset),
        orderBy: "createdAt",
        orderDirection: "desc",
        ...(o.search ? { query: o.search } : {}),
      };
      if (o.count) {
        const { limit, offset, ...countFilter } = filter;
        const { scribeSessionsPage } = await gql<{ scribeSessionsPage: { totalCount: number } }>(COUNT_SESSIONS, { filter: countFilter });
        return o.json ? printJson(scribeSessionsPage) : console.log(scribeSessionsPage.totalCount);
      }
      const { scribeSessions } = await gql<{ scribeSessions: Session[] }>(LIST_SESSIONS, { filter });
      if (o.json) return printJson(scribeSessions);
      table(
        scribeSessions.map((s) => ({
          id: s.id,
          fecha: fmtDate(s.createdAt),
          paciente: s.patient?.fullName ?? s.patientName ?? "—",
          estado: s.status,
          plantilla: s.selectedTemplates?.find((t: any) => t.isPrimary)?.nameSnapshot ?? s.scribeSessionConfiguration?.name ?? "",
        })),
        ["id", "fecha", "paciente", "estado", "plantilla"],
      );
    });

  cmd
    .command("show")
    .description("Muestra la nota clínica de una consulta")
    .argument("<id>")
    .option("-t, --transcript", "incluir la transcripción")
    .option("--json", "salida JSON cruda (incluye todos los campos)")
    .action(async (id: string, o) => {
      const s = await fetchSession(id);
      if (o.json) return printJson(s);
      process.stdout.write(await sessionToMarkdown(s, { transcript: o.transcript }));
    });

  cmd
    .command("transcript")
    .description("Imprime la transcripción de una consulta")
    .argument("<id>")
    .option("--anonymized", "forzar la versión anonimizada del servidor")
    .action(async (id: string, o) => {
      if (o.anonymized) {
        const t = await getAnonymizedTranscript(id);
        if (t == null) throw new CliError("Esta consulta no tiene transcripción anonimizada.");
        return console.log(t);
      }
      const t = await getTranscript(await fetchSession(id));
      if (!t) throw new CliError("Esta consulta todavía no tiene transcripción.");
      if (t.anonymized) info(c.dim("(transcripción anonimizada por Telepatia)"));
      console.log(t.text);
    });

  cmd
    .command("export")
    .description("Exporta una o varias consultas a Markdown o JSON")
    .argument("<ids...>")
    .option("-f, --format <fmt>", "md | json", "md")
    .option("-o, --out <archivo>", "archivo de salida (si hay varios ids se usa como prefijo)")
    .option("-t, --transcript", "incluir la transcripción (md)")
    .action(async (ids: string[], o) => {
      for (const id of ids) {
        const s = await fetchSession(id);
        const body = o.format === "json" ? JSON.stringify(s, null, 2) + "\n" : await sessionToMarkdown(s, { transcript: o.transcript });
        if (!o.out) {
          process.stdout.write(body + (ids.length > 1 ? "\n---\n\n" : ""));
          continue;
        }
        const file = ids.length > 1 ? `${o.out}-${id}.${o.format}` : o.out;
        await writeFile(file, body, { mode: 0o600 });
        info(c.green(`✓ ${file}`));
      }
    });

  cmd
    .command("documents")
    .description("Documentos generados para una consulta (notas por plantilla, reportes)")
    .argument("<id>")
    .option("--json", "salida JSON")
    .action(async (id: string, o) => {
      const { medicalRecordDocuments } = await gql<{ medicalRecordDocuments: { medicalRecordDocuments: Session[] } }>(
        MEDICAL_RECORD_DOCUMENTS,
        {
          scribeSessionId: id,
        },
      );
      const docs = medicalRecordDocuments.medicalRecordDocuments;
      if (o.json) return printJson(docs);
      table(
        docs.map((d) => ({
          id: d.id,
          propósito: d.purpose,
          especialidad: d.specialty,
          idioma: d.language,
          actualizado: fmtDate(d.updatedAt),
        })),
        ["id", "propósito", "especialidad", "idioma", "actualizado"],
      );
    });

  cmd
    .command("wait")
    .description("Espera a que una consulta termine de procesarse")
    .argument("<id>")
    .option("--timeout <min>", "minutos máximos", "30")
    .action(async (id: string, o) => {
      const status = await waitForSession(id, Number(o.timeout));
      info(status.startsWith("completed") ? c.green(`✓ ${status}`) : c.yellow(status));
    });

  cmd
    .command("regenerate")
    .description("Vuelve a generar la nota clínica a partir de la transcripción")
    .argument("<id>")
    .option("--template <id>", "plantilla a usar")
    .action(async (id: string, o) => {
      const r = await regenerateNote(id, o.template);
      info(`Solicitud enviada (${r?.status ?? "ok"}). Espera con: telepatia consultations wait ${id}`);
    });

  cmd
    .command("recover")
    .description("Pide al servidor finalizar una consulta atascada (equivale a 'recuperar' en la web)")
    .argument("<id>")
    .action(async (id: string) => {
      const r = await resolveSession(id);
      info(
        `finalizada: ${r.finalized ?? "?"} · estado: ${r.newStatus ?? "?"} · acciones: ${(r.actionsTaken ?? []).join(", ") || "ninguna"}`,
      );
    });

  cmd
    .command("delete")
    .description("Elimina una consulta (igual que en la web: la marca como eliminada)")
    .argument("<id>")
    .option("-y, --yes", "no pedir confirmación")
    .action(async (id: string, o) => {
      if (!o.yes) {
        const s = await fetchSession(id);
        const ok = await confirm(
          `¿Eliminar la consulta de ${s.patient?.fullName ?? s.patientName ?? "paciente sin nombre"} (${fmtDate(s.createdAt)})?`,
        );
        if (!ok) return info("Cancelado.");
      }
      await gql(DELETE_SESSION, { id, input: { status: "deleted" }, updateMode: "merge" });
      info(c.green("✓ Consulta eliminada."));
    });
}
