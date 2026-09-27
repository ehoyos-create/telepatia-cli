import { createInterface } from "node:readline";
import { CliError } from "./errors.js";

import { c } from "./theme.js";

export { c };

/** Status/progress messages go to stderr so stdout stays clean for piping. */
export const info = (msg: string): void => void process.stderr.write(`${msg}\n`);

export function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
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
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}

function requireTty() {
  if (!process.stdin.isTTY) throw new CliError("Se necesita una terminal interactiva (o pasa los valores con flags/variables de entorno).");
}

export async function prompt(question: string): Promise<string> {
  requireTty();
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise<string>((resolve) => rl.question(question, (a) => resolve(a.trim())));
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it (passwords). */
export async function promptHidden(question: string): Promise<string> {
  requireTty();
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
          reject(new CliError("Cancelado", 130));
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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
