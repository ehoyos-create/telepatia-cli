import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { CliError } from "./errors.js";

/** Formats the backend accepts for /process-audio (from the web app's upload validator). */
export const ACCEPTED: Record<string, string> = {
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
};
export const MIN_BYTES = 1024;
export const MAX_BYTES = 100 * 1024 * 1024;

export function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new CliError(`ffmpeg falló:\n${err.slice(-800)}`))));
  });
}

/**
 * Ensures the file is in an accepted format and size. Unsupported formats (mp3, m4a, webm, mp4…)
 * are converted with ffmpeg to 16 kHz mono FLAC, which is lossless and small.
 */
export async function prepareAudio(path: string): Promise<{ path: string; mime: string; converted: boolean }> {
  const ext = extname(path).toLowerCase();
  let out = path;
  let mime = ACCEPTED[ext];
  let converted = false;

  if (!mime) {
    if (!hasFfmpeg()) {
      throw new CliError(
        `Formato ${ext || "desconocido"} no soportado por Telepatia (acepta: ${Object.keys(ACCEPTED).join(", ")}).\n` +
          "Instala ffmpeg para convertirlo automáticamente (brew install ffmpeg / apt install ffmpeg).",
      );
    }
    const dir = await mkdtemp(join(tmpdir(), "telepatia-"));
    out = join(dir, "audio.flac");
    await run("ffmpeg", ["-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", out]);
    mime = ACCEPTED[".flac"];
    converted = true;
  }

  const { size } = await stat(out);
  if (size < MIN_BYTES) throw new CliError("El archivo de audio es demasiado pequeño (mínimo 1 KB).");
  if (size > MAX_BYTES) {
    throw new CliError(`El archivo pesa ${(size / 1024 / 1024).toFixed(1)} MB; el máximo de Telepatia es 100 MB.`);
  }
  return { path: out, mime, converted };
}
