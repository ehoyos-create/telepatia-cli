/**
 * Stable exit codes. Agents and scripts branch on these, so never renumber them.
 * Documented in `telepatia schema` and skills/telepatia/SKILL.md.
 */
export const EXIT = {
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  TIMEOUT: 5,
  API: 6,
  NEEDS_INPUT: 7,
  CANCELLED: 130,
} as const;

const CODE_BY_EXIT: Record<number, string> = {
  1: "error",
  2: "usage",
  3: "auth_required",
  4: "not_found",
  5: "timeout",
  6: "api_error",
  7: "needs_input",
  130: "cancelled",
};

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = EXIT.ERROR,
    /** A command the caller can run next to fix the problem. */
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }

  get code(): string {
    return CODE_BY_EXIT[this.exitCode] ?? "error";
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly method: string,
    public readonly url: string,
  ) {
    super(`${method} ${url} → ${status}${detail(body) ? `: ${detail(body)}` : ""}`);
    this.name = "HttpError";
  }

  /** Server-provided error code, e.g. "email_not_verified". */
  get code(): string | undefined {
    const b = this.body as Record<string, unknown> | null;
    return b && typeof b === "object" && typeof b.code === "string" ? b.code : undefined;
  }
}

function detail(body: unknown): string | undefined {
  if (typeof body === "string") return body.slice(0, 200) || undefined;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    // GraphQL servers answer 400 with { errors: [{ message }] }
    if (Array.isArray(b.errors) && b.errors.length) {
      return (b.errors as { message?: string }[]).map((e) => e.message ?? "").join("; ").slice(0, 500);
    }
    for (const k of ["detail", "message", "error"]) {
      if (typeof b[k] === "string") return (b[k] as string).slice(0, 200);
    }
  }
  return undefined;
}

export interface ErrorInfo {
  code: string;
  message: string;
  hint?: string;
  status?: number;
  exitCode: number;
}

/** Normalizes any thrown value into `{ code, message, hint, exitCode }` for humans, JSON and MCP. */
export function describeError(err: unknown): ErrorInfo {
  if (err instanceof CliError) return { code: err.code, message: err.message, hint: err.hint, exitCode: err.exitCode };
  if (err instanceof HttpError) {
    const auth = err.status === 401 || err.status === 403;
    return {
      code: auth ? "auth_required" : err.status === 404 ? "not_found" : "api_error",
      message: `Error de la API: ${err.message}`,
      hint: auth ? "telepatia login" : undefined,
      status: err.status,
      exitCode: auth ? EXIT.AUTH : err.status === 404 ? EXIT.NOT_FOUND : EXIT.API,
    };
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return { code: "timeout", message: "La petición tardó demasiado. Revisa tu conexión.", exitCode: EXIT.TIMEOUT };
  }
  if (err instanceof SyntaxError) return { code: "usage", message: `JSON inválido: ${err.message}`, exitCode: EXIT.USAGE };
  return { code: "error", message: err instanceof Error ? (err.stack ?? err.message) : String(err), exitCode: EXIT.ERROR };
}
