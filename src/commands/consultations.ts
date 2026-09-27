import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { wantJson } from "../output.js";
import { getAnonymizedTranscript, regenerateNote, resolveSession } from "../api/aiBackend.js";
import { gql } from "../api/graphql.js";
import { DELETE_SESSION, MEDICAL_RECORD_DOCUMENTS, SESSION_STATUSES } from "../api/queries.js";
import { CliError, EXIT } from "../errors.js";
import {
  countConsultations,
  fetchSession,
  getTranscript,
  listConsultations,
  sessionToMarkdown,
  templateNameOf,
  waitForSession,
  type Session,
} from "../sessions.js";
import { c, confirm, done, fmtDate, info, parseMinutes, printJson, table } from "../ui.js";

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
    .action(async (o) => {
      const opts = {
        search: o.search,
        status: o.status ? String(o.status).split(",") : undefined,
        limit: Number(o.limit),
        offset: Number(o.offset),
      };
      if (o.count) {
        const totalCount = await countConsultations(opts);
        return wantJson() ? printJson({ totalCount }) : console.log(totalCount);
      }
      const scribeSessions = await listConsultations(opts);
      if (wantJson()) return printJson(scribeSessions);
      table(
        scribeSessions.map((s) => ({
          id: s.id,
          fecha: fmtDate(s.createdAt),
          paciente: s.patient?.fullName ?? s.patientName ?? "—",
          estado: s.status,
          plantilla: templateNameOf(s) ?? "",
        })),
        ["id", "fecha", "paciente", "estado", "plantilla"],
      );
    });

  cmd
    .command("show")
    .description("Muestra la nota clínica de una consulta")
    .argument("<id>")
    .option("-t, --transcript", "incluir la transcripción")
    .action(async (id: string, o) => {
      const s = await fetchSession(id);
      if (wantJson("document")) return printJson(s);
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
        if (t == null) throw new CliError("Esta consulta no tiene transcripción anonimizada.", EXIT.NOT_FOUND);
        return console.log(t);
      }
      const t = await getTranscript(await fetchSession(id));
      if (!t) throw new CliError("Esta consulta todavía no tiene transcripción.", EXIT.NOT_FOUND, `telepatia consultations wait ${id}`);
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
        done({ id, file }, c.green(`✓ ${file}`));
      }
    });

  cmd
    .command("documents")
    .description("Documentos generados para una consulta (notas por plantilla, reportes)")
    .argument("<id>")
    .action(async (id: string, o) => {
      const { medicalRecordDocuments } = await gql<{ medicalRecordDocuments: { medicalRecordDocuments: Session[] } }>(
        MEDICAL_RECORD_DOCUMENTS,
        {
          scribeSessionId: id,
        },
      );
      const docs = medicalRecordDocuments.medicalRecordDocuments;
      if (wantJson()) return printJson(docs);
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
    .option("--timeout <duración>", "tiempo máximo: 90s, 5m, 1h (número solo = minutos)", "30")
    .addHelpText("after", "\nAgentes: usa un timeout menor al de tu herramienta (p.ej. --timeout 100s) y repite si sale con código 5.")
    .action(async (id: string, o) => {
      const status = await waitForSession(id, parseMinutes(o.timeout, 30));
      const ok = status.startsWith("completed") || status === "reviewed";
      done(
        { id, status, ...(ok ? { next: `telepatia consultations show ${id}` } : {}) },
        ok ? c.green(`✓ ${status}`) : c.yellow(status),
      );
    });

  cmd
    .command("regenerate")
    .description("Vuelve a generar la nota clínica a partir de la transcripción")
    .argument("<id>")
    .option("--template <id>", "plantilla a usar")
    .action(async (id: string, o) => {
      const r = await regenerateNote(id, o.template);
      done(
        { id, status: r?.status ?? "requested", next: `telepatia consultations wait ${id} --timeout 100s` },
        `Solicitud enviada (${r?.status ?? "ok"}). Espera con: telepatia consultations wait ${id}`,
      );
    });

  cmd
    .command("recover")
    .description("Pide al servidor finalizar una consulta atascada (equivale a 'recuperar' en la web)")
    .argument("<id>")
    .action(async (id: string) => {
      const r = await resolveSession(id);
      done(
        { id, finalized: r.finalized ?? null, status: r.newStatus ?? null, actionsTaken: r.actionsTaken ?? [] },
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
        if (!process.stdin.isTTY)
          throw new CliError("Eliminar requiere confirmación explícita.", EXIT.NEEDS_INPUT, `telepatia consultations delete ${id} --yes`);
        const s = await fetchSession(id);
        const ok = await confirm(
          `¿Eliminar la consulta de ${s.patient?.fullName ?? s.patientName ?? "paciente sin nombre"} (${fmtDate(s.createdAt)})?`,
        );
        if (!ok) return info("Cancelado.");
      }
      await gql(DELETE_SESSION, { id, input: { status: "deleted" }, updateMode: "merge" });
      done({ id, status: "deleted" }, c.green("✓ Consulta eliminada."));
    });
}
