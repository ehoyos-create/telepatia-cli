export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
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
