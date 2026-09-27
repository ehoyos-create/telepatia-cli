import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
