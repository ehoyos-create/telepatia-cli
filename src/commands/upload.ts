import type { Command } from "commander";
import { wantJson } from "../output.js";
import { existsSync } from "node:fs";
import { createSession, processAudio } from "../api/aiBackend.js";
import { prepareAudio } from "../audio.js";
import { CliError, EXIT } from "../errors.js";
import { fetchSession, resolveTemplate, sessionToMarkdown, waitForSession } from "../sessions.js";
import { agentMode } from "../output.js";
import { c, info, parseMinutes, printJson } from "../ui.js";

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
  if (!existsSync(input.file)) throw new CliError(`No existe el archivo ${input.file}`, EXIT.NOT_FOUND);
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

  // Agents default to not waiting: processing takes minutes, longer than a tool call should block.
  if (!(o.wait ?? !agentMode)) {
    info(`Consulta en proceso. Ver luego: telepatia consultations show ${sessionId}`);
    if (wantJson()) printJson({ ok: true, id: sessionId, status: "processing", next: `telepatia consultations wait ${sessionId} --timeout 100s` });
    else console.log(sessionId);
    return;
  }
  info("Procesando (transcripción + nota)…");
  const status = await waitForSession(sessionId, parseMinutes(o.timeout, 30));
  if (!status.startsWith("completed")) info(c.yellow(`La consulta terminó con estado: ${status}`));
  const s = await fetchSession(sessionId);
  if (wantJson("document")) return printJson(s);
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
    .option("--wait", "esperar la nota e imprimirla (por defecto en terminal)")
    .option("--no-wait", "devolver el id sin esperar (por defecto para agentes/scripts)")
    .option("--timeout <duración>", "espera máxima: 90s, 5m, 1h (número solo = minutos)", "30")
    .addHelpText(
      "after",
      `
Asegúrate de tener el consentimiento del paciente para grabar y procesar el audio.
Ejemplo:
  telepatia upload consulta.m4a --template "Medicina general" --patient 64f… > nota.md`,
    )
    .action(runUpload);
}
