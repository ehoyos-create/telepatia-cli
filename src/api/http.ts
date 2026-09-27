import { canRefresh, getAccessToken, refreshSession } from "../auth/session.js";
import { HttpError } from "../errors.js";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Return the raw Response (for blobs/streams). */
  raw?: boolean;
}

/**
 * Authenticated fetch against any Telepatia service. Mirrors the web client:
 * Bearer token, JSON bodies, one refresh-and-retry on 401/403.
 */
export async function authedFetch(url: string, opts: RequestOptions = {}): Promise<unknown> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const isForm = opts.body instanceof FormData;

  const send = async (token: string) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });

  let res = await send(await getAccessToken());
  if ((res.status === 401 || res.status === 403) && canRefresh()) {
    res = await send((await refreshSession()).accessToken);
  }

  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    throw new HttpError(res.status, body, method, url);
  }
  if (opts.raw) return res;
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
