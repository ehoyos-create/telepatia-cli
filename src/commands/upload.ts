import type { Command } from "commander";
import { existsSync } from "node:fs";
import { createSession, processAudio } from "../api/aiBackend.js";
import { prepareAudio } from "../audio.js";
import { CliError } from "../errors.js";
import { fetchSession, resolveTemplate, sessionToMarkdown, waitForSession } from "../sessions.js";
import { c, info, printJson } from "../ui.js";

export interface SubmitAudioInput {
  file: string;
  templateId: string;
  patientId?: string;
  telemedicine?: boolean;
  externalId?: string;
  onProgress?: (msg: string) => void;
}

/** Creates a consultation and uploads its audio. Returns the new session id (processing continues server-side). */
export async function submitAudio(input: SubmitAudioInput): Promise<string> {
  const say = input.onProgress ?? (() => {});
  if (!existsSync(input.file)) throw new CliError(`No existe el archivo ${input.file}`);
  const audio = await prepareAudio(input.file);
  if (audio.converted) say("audio convertido a FLAC 16 kHz mono");
  say("creando consulta…");
  const sessionId = await createSession({
    configurationDocumentId: input.templateId,
    scribePatientDocumentId: input.patientId,
    isTelemedicine: Boolean(input.telemedicine),
    externalConsultationId: input.externalId,
  });
  say("subiendo audio…");
  await processAudio(sessionId, audio.path, audio.mime);
  return sessionId;
}

export interface UploadOptions {
  template?: string;
  patient?: string;
  telemedicine?: boolean;
  externalId?: string;
  wait?: boolean;
  timeout?: string;
  json?: boolean;
}

export async function runUpload(file: string, o: UploadOptions): Promise<void> {
  const template = await resolveTemplate(o.template);
  const sessionId = await submitAudio({
    file,
    templateId: template.id,
    patientId: o.patient,
    telemedicine: o.telemedicine,
    externalId: o.externalId,
    onProgress: (m) => info(c.dim(`  ${m}`)),
  });
  info(c.green(`✓ Consulta ${c.bold(sessionId)} creada (plantilla: ${template.name}).`));

  if (o.wait === false) {
    info(`Consulta en proceso. Ver luego: telepatia consultations show ${sessionId}`);
    if (o.json) printJson({ id: sessionId });
    else console.log(sessionId);
    return;
  }
  info("Procesando (transcripción + nota)…");
  const status = await waitForSession(sessionId, Number(o.timeout ?? 30));
  if (!status.startsWith("completed")) info(c.yellow(`La consulta terminó con estado: ${status}`));
  const s = await fetchSession(sessionId);
  if (o.json) return printJson(s);
  process.stdout.write(await sessionToMarkdown(s));
}

export function registerUpload(program: Command) {
  program
    .command("upload")
    .description("Crea una consulta a partir de un audio grabado y genera la nota")
    .argument("<audio>", "archivo de audio (wav, flac, ogg, opus, aiff; otros formatos se convierten con ffmpeg)")
    .option("--template <id|nombre>", "plantilla de nota (ver: telepatia templates)")
    .option("--patient <id>", "asociar a un paciente existente (ver: telepatia patients)")
    .option("--telemedicine", "marcar como teleconsulta")
    .option("--external-id <id>", "id de la consulta en tu sistema/EMR")
    .option("--no-wait", "no esperar a que se genere la nota")
    .option("--timeout <min>", "minutos máximos de espera", "30")
    .option("--json", "imprimir la consulta final en JSON")
    .addHelpText(
      "after",
      `
Asegúrate de tener el consentimiento del paciente para grabar y procesar el audio.
Ejemplo:
  telepatia upload consulta.m4a --template "Medicina general" --patient 64f… > nota.md`,
    )
    .action(runUpload);
}
