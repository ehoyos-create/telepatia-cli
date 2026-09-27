import { createInterface } from "node:readline";
import { CliError, EXIT } from "./errors.js";
import { agentMode, formatJson, quiet, wantJson } from "./output.js";

import { c } from "./theme.js";

export { c };

/** Status/progress messages go to stderr so stdout stays clean for piping. */
export const info = (msg: string): void => void (quiet || process.stderr.write(`${msg}\n`));

export function printJson(v: unknown): void {
  process.stdout.write(formatJson(v) + "\n");
}

/**
 * Reports the outcome of an action command: a JSON object on stdout for agents/scripts,
 * a friendly line on stderr for humans. `next` tells an agent what to run afterwards.
 */
export function done(data: Record<string, unknown>, human: string): void {
  if (wantJson()) printJson({ ok: true, ...data });
  else info(human);
}

export function table(rows: Record<string, unknown>[], columns: string[]): void {
  if (!rows.length) {
    info(c.dim("(sin resultados)"));
    return;
  }
  const cell = (v: unknown) => (v == null ? "" : String(v)).replace(/\s+/g, " ");
  const widths = columns.map((col) => Math.min(48, Math.max(col.length, ...rows.map((r) => cell(r[col]).length))));
  const fmt = (vals: string[]) =>
    vals.map((v, i) => (v.length > widths[i] ? v.slice(0, widths[i] - 1) + "…" : v.padEnd(widths[i]))).join("  ");
  process.stdout.write(c.bold(fmt(columns.map((x) => x.toUpperCase()))) + "\n");
  for (const r of rows) process.stdout.write(fmt(columns.map((col) => cell(r[col]))) + "\n");
}

export function fmtDate(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Agents get an unambiguous, locale-free timestamp; people get their locale's short format.
  if (agentMode) return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
  return d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}

function requireTty(what: string) {
  if (!process.stdin.isTTY)
    throw new CliError(
      `Falta ${what} y no hay una terminal interactiva para pedirlo. Pásalo con flags o variables de entorno.`,
      EXIT.NEEDS_INPUT,
      "telepatia <comando> --help",
    );
}

export async function prompt(question: string): Promise<string> {
  requireTty(`"${question.replace(/\s*(\[[^\]]*\])?[\s:?]*$/, "")}"`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise<string>((resolve) => rl.question(question, (a) => resolve(a.trim())));
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it (passwords). */
export async function promptHidden(question: string): Promise<string> {
  requireTty("la contraseña (usa TELEPATIA_PASSWORD o --password-stdin)");
  process.stderr.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const onData = (ch: string) => {
      for (const k of ch) {
        if (k === "\r" || k === "\n" || k === "\u0004") {
          done();
          resolve(value);
          return;
        }
        if (k === "\u0003") {
          done();
          reject(new CliError("Cancelado", EXIT.CANCELLED));
          return;
        }
        if (k === "\u007f" || k === "\b") value = value.slice(0, -1);
        else value += k;
      }
    };
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    stdin.on("data", onData);
  });
}

export async function confirm(question: string): Promise<boolean> {
  const a = (await prompt(`${question} [s/N] `)).toLowerCase();
  return a === "s" || a === "si" || a === "sí" || a === "y" || a === "yes";
}

export async function choose<T>(question: string, items: T[], label: (t: T) => string): Promise<T> {
  items.forEach((it, i) => info(`  ${c.cyan(String(i + 1))}. ${label(it)}`));
  for (;;) {
    const n = Number(await prompt(`${question} [1-${items.length}]: `));
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
  }
}

/** Parses "90s", "5m", "1h" or a bare number of minutes into minutes. */
export function parseMinutes(v: string | number | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|min|h)?$/i.exec(String(v).trim());
  if (!m) throw new CliError(`Duración inválida: ${v} (usa p.ej. 90s, 5m, 1h)`, EXIT.USAGE);
  const n = Number(m[1]);
  const unit = (m[2] ?? "m").toLowerCase();
  return unit === "s" ? n / 60 : unit === "h" ? n * 60 : n;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
