import { CliError, HttpError } from "../errors.js";
import { authcentral, type TokenResponse } from "./authcentral.js";
import { decodeJwt, type TelepatiaClaims } from "./jwt.js";
import { clearSession, loadSession, saveSession, type AccountSummary, type StoredSession } from "./store.js";

/** Refresh when the access token has less than this left (the web app uses the same 5 min buffer). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let inflight: Promise<StoredSession> | null = null;

export function persistTokens(
  token: Pick<TokenResponse, "accessToken" | "refreshToken" | "expiresAt">,
  availableAccounts: AccountSummary[] = loadSession()?.availableAccounts ?? [],
): StoredSession {
  const session: StoredSession = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    availableAccounts,
  };
  saveSession(session);
  return session;
}

function requireSession(): StoredSession {
  const s = loadSession();
  if (!s) throw new CliError("No has iniciado sesión. Ejecuta: telepatia login");
  return s;
}

/** Forces a refresh-token rotation. Concurrent callers share one request. */
export async function refreshSession(): Promise<StoredSession> {
  if (inflight) return inflight;
  inflight = (async () => {
    const current = requireSession();
    try {
      const t = await authcentral.refresh(current.refreshToken);
      return persistTokens(t, current.availableAccounts);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        clearSession();
        throw new CliError("Tu sesión expiró. Ejecuta: telepatia login");
      }
      throw err;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Returns an access token valid for at least 5 more minutes.
 * `TELEPATIA_TOKEN` (a raw access token) bypasses the credential store — handy for CI or scripts.
 */
export async function getAccessToken(): Promise<string> {
  if (process.env.TELEPATIA_TOKEN) return process.env.TELEPATIA_TOKEN;
  const s = requireSession();
  if (Date.parse(s.expiresAt) - Date.now() > REFRESH_BUFFER_MS) return s.accessToken;
  return (await refreshSession()).accessToken;
}

export async function currentClaims(): Promise<TelepatiaClaims> {
  return decodeJwt(await getAccessToken());
}

export function canRefresh(): boolean {
  return !process.env.TELEPATIA_TOKEN && loadSession() !== null;
}
