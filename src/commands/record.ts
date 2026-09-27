import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { hasFfmpeg } from "../audio.js";
import { CliError } from "../errors.js";
import { c, info } from "../ui.js";
import { runUpload } from "./upload.js";

/** ffmpeg input args for the default microphone on each OS. */
function micInput(device?: string): string[] {
  switch (process.platform) {
    case "darwin":
      return ["-f", "avfoundation", "-i", `:${device ?? "default"}`];
    case "win32":
      if (!device)
        throw new CliError(
          'En Windows indica el micrófono: --device "Micrófono (Realtek…)". Lista: ffmpeg -list_devices true -f dshow -i dummy',
        );
      return ["-f", "dshow", "-i", `audio=${device}`];
    default:
      return ["-f", "pulse", "-i", device ?? "default"];
  }
}

/**
 * Records the microphone to a 16 kHz mono FLAC until the user presses Enter or Ctrl+C.
 * Returns the file path. Live streaming over the web app's audio WebSocket is intentionally
 * not used: its wire format is undocumented and flag-dependent (see docs/COBERTURA.md).
 */
export async function recordToFile(opts: { device?: string; out?: string } = {}): Promise<string> {
  if (!hasFfmpeg()) throw new CliError("Grabar necesita ffmpeg (brew install ffmpeg / apt install ffmpeg).");
  const file = opts.out ?? join(await mkdtemp(join(tmpdir(), "telepatia-")), "consulta.flac");
  const ff = spawn(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...micInput(opts.device), "-ac", "1", "-ar", "16000", "-c:a", "flac", file],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));

  const started = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    const dot = s % 2 === 0 ? c.red("●") : c.subtle("●");
    process.stderr.write(`\r  ${dot} ${c.bold("Grabando")} ${c.brand(`${mm}:${ss}`)}  ${c.muted("Enter para terminar")}   `);
  }, 500);

  const stop = () => ff.stdin.write("q"); // graceful: ffmpeg finalizes the FLAC header
  process.once("SIGINT", stop);
  const tty = process.stdin.isTTY;
  if (tty) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", stop);
  }

  const code: number = await new Promise((r) => ff.on("close", (x) => r(x ?? 0)));
  clearInterval(timer);
  process.off("SIGINT", stop);
  if (tty) {
    process.stdin.off("data", stop);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  process.stderr.write("\n");
  if (code !== 0 && code !== 255) throw new CliError(`No se pudo grabar:\n${stderr.slice(-600)}`);
  return file;
}

export function registerRecord(program: Command) {
  program
    .command("record")
    .description("Graba desde el micrófono y, al terminar (Enter o Ctrl+C), sube la consulta")
    .option("--template <id|nombre>", "plantilla de nota")
    .option("--patient <id>", "paciente existente")
    .option("--device <nombre>", "micrófono (por defecto el del sistema)")
    .option("-o, --out <archivo>", "guardar también el audio en este archivo .flac")
    .option("--no-upload", "solo grabar, no subir")
    .option("--no-wait", "no esperar a la nota")
    .action(async (o) => {
      info(c.yellow("Recuerda: necesitas el consentimiento del paciente para grabar."));
      const file = await recordToFile({ device: o.device, out: o.out });
      info(c.green(`✓ Audio guardado en ${file}`));
      if (!o.upload) return;
      await runUpload(file, { template: o.template, patient: o.patient, wait: o.wait });
    });
}
