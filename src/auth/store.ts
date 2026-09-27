import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { credentialsPath } from "../config.js";

export interface AccountSummary {
  accountId: string;
  institutionId: string;
  institutionName: string;
  nameFull: string | null;
  roles: string[];
  accountType?: string;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp of access-token expiry. */
  expiresAt: string;
  availableAccounts: AccountSummary[];
}

export function loadSession(): StoredSession | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies on create; enforce on overwrite too.
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

export function clearSession(): void {
  rmSync(credentialsPath(), { force: true });
}

/**
 * A login waiting on the user (a code, an institution, a phone approval). Saved so a
 * non-interactive caller — an agent — can finish it in a second invocation:
 * `telepatia login --otp me@x.com` → `telepatia login --code 123456`.
 */
export type PendingLogin =
  | { kind: "mfa" | "otp"; challengeToken: string; account?: string }
  | { kind: "account"; preAuthToken: string; accounts: AccountSummary[] }
  | { kind: "device"; deviceCode: string; userCode: string; interval: number; expiresAt: number };

const pendingPath = () => join(dirname(credentialsPath()), "pending-login.json");

export function savePending(p: PendingLogin): void {
  mkdirSync(dirname(pendingPath()), { recursive: true, mode: 0o700 });
  writeFileSync(pendingPath(), JSON.stringify(p), { mode: 0o600 });
}

export function loadPending(): PendingLogin | null {
  try {
    return JSON.parse(readFileSync(pendingPath(), "utf8")) as PendingLogin;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  rmSync(pendingPath(), { force: true });
}
