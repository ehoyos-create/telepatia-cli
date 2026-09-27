import type { Command } from "commander";
import { gql } from "../api/graphql.js";
import { toCountryName } from "../countries.js";
import { GET_PATIENT, GET_PATIENTS, PATIENT_TIMELINE, SEARCH_PATIENTS, UPSERT_PATIENT } from "../api/queries.js";
import { CliError } from "../errors.js";
import { fmtDate, info, printJson, table, c } from "../ui.js";

type Patient = Record<string, any>;

const idOf = (p: Patient) => p.identifications?.map((i: any) => `${i.idType ?? ""} ${i.idValue ?? ""}`.trim()).join(", ") ?? "";

/** `lastConsultation` often comes back null even when the patient has sessions; fall back to `lastSession`. */
export const lastVisitOf = (p: Patient): string | undefined => p.lastConsultation ?? p.lastSession?.createdAt ?? undefined;

/**
 * Maps --sort to the API's ordering. With no sort the server's default order is used, like the web
 * app: ordering by lastVisit silently drops patients who have no consultations yet.
 */
function sortFilter(sort?: string): Record<string, string> {
  if (!sort) return {};
  if (sort === "name" || sort === "fullName") return { orderBy: "fullName", orderDirection: "asc" };
  if (sort === "recent" || sort === "lastVisit") return { orderBy: "lastVisit", orderDirection: "desc" };
  throw new CliError(`--sort debe ser "name" o "recent" (recibido: "${sort}")`);
}

function printPatients(list: Patient[]) {
  table(
    list.map((p) => ({
      id: p.id,
      nombre: p.fullName ?? p.patientName ?? "—",
      identificación: idOf(p),
      "última consulta": fmtDate(lastVisitOf(p)),
    })),
    ["id", "nombre", "identificación", "última consulta"],
  );
}

export function registerPatients(program: Command) {
  const cmd = program.command("patients").alias("p").description("Pacientes");

  cmd
    .command("list", { isDefault: true })
    .description("Lista tus pacientes")
    .option("-n, --limit <n>", "cuántos", "25")
    .option("--offset <n>", "saltar N", "0")
    .option("--sort <orden>", "name (alfabético) | recent (última consulta; solo incluye pacientes con consultas)")
    .option("--json", "salida JSON")
    .action(async (o) => {
      const { getPatients } = await gql<{ getPatients: { patients: Patient[]; totalCount: number } }>(GET_PATIENTS, {
        filter: {
          limit: Number(o.limit),
          offset: Number(o.offset),
          includeAnonymousPatients: false,
          ...sortFilter(o.sort),
        },
      });
      if (o.json) return printJson(getPatients);
      printPatients(getPatients.patients);
      info(c.dim(`${getPatients.patients.length} de ${getPatients.totalCount}`));
    });

  cmd
    .command("search")
    .description("Busca pacientes por nombre o identificación")
    .argument("<texto>")
    .option("-n, --limit <n>", "cuántos", "25")
    .option("--json", "salida JSON")
    .action(async (q: string, o) => {
      const { searchScribePatients } = await gql<{ searchScribePatients: Patient[] }>(SEARCH_PATIENTS, {
        query: q,
        limit: Number(o.limit),
        offset: 0,
      });
      if (o.json) return printJson(searchScribePatients);
      printPatients(searchScribePatients);
    });

  cmd
    .command("show")
    .description("Datos de un paciente")
    .argument("<id>")
    .option("--json", "salida JSON")
    .action(async (id: string, o) => {
      const { scribePatient: p } = await gql<{ scribePatient: Patient | null }>(GET_PATIENT, { id });
      if (!p) throw new CliError(`No se encontró el paciente ${id}`);
      if (o.json) return printJson(p);
      const rows: [string, string][] = [
        ["Nombre", p.fullName ?? p.patientName ?? "—"],
        ["Identificación", idOf(p) || "—"],
        ["Teléfonos", p.phoneNumbers?.map((x: any) => `+${String(x.countryCode).replace(/^\+/, "")} ${x.phoneNumber}`).join(", ") || "—"],
        ["Emails", p.emails?.map((x: any) => x.email).join(", ") || "—"],
        ["Última consulta", fmtDate(lastVisitOf(p)) || "—"],
        ["Creado", fmtDate(p.createdAt)],
      ];
      for (const [k, v] of rows) console.log(`${c.dim(k.padEnd(16))} ${v}`);
    });

  cmd
    .command("history")
    .description("Historial de consultas de un paciente")
    .argument("<id>")
    .option("--json", "salida JSON")
    .action(async (id: string, o) => {
      const { timelineByPatient } = await gql<{ timelineByPatient: { total: number; sessions: Patient[] } }>(PATIENT_TIMELINE, {
        input: { patientDocumentId: id, limit: 50, descending: true },
      });
      if (o.json) return printJson(timelineByPatient);
      table(
        timelineByPatient.sessions.map((s) => ({
          id: s.id,
          fecha: fmtDate(s.createdAt),
          estado: s.status,
          médico: s.account?.nameFull ?? "",
          resumen: s.medicalRecordSummary ?? "",
        })),
        ["id", "fecha", "estado", "médico", "resumen"],
      );
    });

  cmd
    .command("create")
    .description("Crea (o actualiza) un paciente")
    .argument("<nombre>", "nombre completo")
    .option("--id-type <tipo>", "tipo de documento (p.ej. CC, CPF, DNI)")
    .option("--id-value <número>", "número de documento")
    .option("--country <país>", "país del documento: código (CO, BR, MX…) o nombre (COLOMBIA)")
    .option("--json", "salida JSON")
    .action(async (name: string, o) => {
      const identifications = o.idValue
        ? [{ idType: o.idType ?? null, idValue: o.idValue, country: o.country ? toCountryName(o.country) : null }]
        : [];
      const { updateOrCreateScribePatient: p } = await gql<{ updateOrCreateScribePatient: Patient }>(UPSERT_PATIENT, {
        input: { fullName: name, identifications },
      });
      if (o.json) return printJson(p);
      console.log(p.id);
    });
}
