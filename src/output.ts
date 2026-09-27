/**
 * Output mode. The CLI is agent-first: when it is driven by an AI agent (CLAUDECODE,
 * TELEPATIA_AGENT=1, TELEPATIA_OUTPUT=json, or no terminal on stdin nor stdout) data commands
 * print compact JSON with empty fields dropped, and errors are one JSON line on stderr.
 * Humans at a terminal get tables and colors. `--json` / `--human` force either mode.
 *
 * Resolved from argv/env at startup so it is known before commander parses anything
 * (error formatting needs it even when parsing fails).
 */

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);

function flagValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

const envMode = (process.env.TELEPATIA_OUTPUT ?? "").toLowerCase();
const forceHuman = has("--human") || envMode === "human";
const explicitJson = !forceHuman && (has("--json") || envMode === "json");

/**
 * Driven by an agent rather than a person. Claude Code sets CLAUDECODE; other agents and
 * CI run with neither stdin nor stdout attached to a terminal. A person's shell script
 * (`telepatia upload a.m4a > nota.md`) keeps a terminal on stdin, so it keeps human behavior.
 */
export const agentMode =
  !forceHuman &&
  (explicitJson || Boolean(process.env.CLAUDECODE) || process.env.TELEPATIA_AGENT === "1" || (!process.stdout.isTTY && !process.stdin.isTTY));

export const quiet = has("-q") || has("--quiet");

const fields = flagValue("--fields")
  ?.split(",")
  .map((f) => f.trim())
  .filter(Boolean);

/**
 * Whether a command should print JSON. Data commands (lists, records) follow agent mode.
 * Document commands (a note in Markdown) stay Markdown unless JSON was asked for explicitly:
 * Markdown is what an LLM reads best and it is a fraction of the raw record's size.
 */
export function wantJson(kind: "data" | "document" = "data"): boolean {
  return kind === "document" ? explicitJson : agentMode;
}

/** Drops null/undefined/empty values recursively — they cost tokens and carry no information. */
export function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p == null || p === "") continue;
      if (typeof p === "object" && !Object.keys(p as object).length) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}

/** Keeps only the requested dot-paths (`--fields id,status,patient.fullName`). */
export function pick(v: unknown, paths: string[]): unknown {
  if (Array.isArray(v)) return v.map((x) => pick(x, paths));
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const keys = path.split(".");
    let src: any = v;
    for (const k of keys) src = src?.[k];
    if (src === undefined) continue;
    let dst = out;
    for (const k of keys.slice(0, -1)) dst = (dst[k] ??= {}) as Record<string, unknown>;
    dst[keys[keys.length - 1]] = src;
  }
  return out;
}

export function formatJson(v: unknown): string {
  const data = fields?.length ? pick(v, fields) : v;
  if (agentMode) return JSON.stringify(prune(data) ?? null);
  return JSON.stringify(data, null, 2);
}
