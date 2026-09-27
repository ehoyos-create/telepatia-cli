import { endpoints } from "../config.js";
import { HttpError } from "../errors.js";
import type { AccountSummary } from "./store.js";

/** Token pair as returned by authcentral (`w4` schema in the web bundle). */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  expiresIn: number;
  expiresAt: string;
  payload?: {
    uid: string;
    accountId: string;
    institutionalId: string;
    roles: string[];
    email?: string;
    country?: string;
  };
}

export interface MfaChallenge {
  challengeToken: string;
  expiresAt: string;
  emailHint?: string;
}

/** Result of any login step (`ax` schema). Exactly one "next step" field is meaningful. */
export interface LoginResult {
  token?: TokenResponse | null;
  requiresInstitutionSelection?: boolean | null;
  accounts?: AccountSummary[] | null;
  availableAccounts?: AccountSummary[] | null;
  preAuthToken?: string | null;
  mfaChallenge?: MfaChallenge | null;
}

export interface PasswordlessChallenge {
  challengeToken: string;
  expiresAt: string;
  channel: string;
  hint?: string;
}

export interface DeviceAuthStart {
  device_code: string;
  user_code: string;
  expires_in: number;
  interval: number;
}

export type DevicePoll =
  | { state: "pending" }
  | { state: "slow_down" }
  | { state: "expired" }
  | { state: "ok"; accessToken: string; refreshToken: string; expiresAt: string };

async function post<T>(path: string, body: unknown, bearer?: string, timeoutMs = 20_000): Promise<T> {
  const url = `${endpoints.authcentral}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new HttpError(res.status, parsed, "POST", url);
  return parsed as T;
}

export const authcentral = {
  login: (email: string, password: string) => post<LoginResult>("/login", { email, password }),

  verify2fa: (challengeToken: string, code: string) => post<LoginResult>("/2fa/verify", { challengeToken, code }),

  resend2fa: (challengeToken: string) => post<MfaChallenge>("/2fa/resend", { challengeToken }),

  passwordlessStart: (identifier: string, channel: "auto" | "email" | "whatsapp" = "auto") =>
    post<PasswordlessChallenge>("/passwordless/start", { identifier, channel, purpose: "login" }),

  passwordlessVerify: (challengeToken: string, code: string) => post<LoginResult>("/passwordless/verify", { challengeToken, code }),

  passwordlessResend: (challengeToken: string) => post<Omit<PasswordlessChallenge, "channel">>("/passwordless/resend", { challengeToken }),

  selectAccount: (preAuthToken: string, accountId: string) => post<LoginResult>("/account/select", { preAuthToken, accountId }),

  switchAccount: (accessToken: string, accountId: string) => post<LoginResult>("/account/switch", { accountId }, accessToken),

  availableAccounts: (accessToken: string) => post<{ accounts: AccountSummary[] }>("/account/available", {}, accessToken),

  refresh: (refreshToken: string) => post<TokenResponse>("/token/refresh", { refresh_token: refreshToken }, undefined, 8_000),

  validate: (token: string) => post<{ valid: boolean }>("/token/validate", { token }, undefined, 4_000),

  /** Exchanges an institution API key for a session. Present in authcentral; not used by the web UI. */
  apiKeyExchange: (apiKey: string) => post<LoginResult>("/apikey/exchange", {}, apiKey),

  logout: (refreshToken: string) => post<unknown>("/logout", { refresh_token: refreshToken }).catch(() => undefined),

  deviceStart: () => post<DeviceAuthStart>("/device-auth/start", {}),

  async devicePoll(deviceCode: string): Promise<DevicePoll> {
    const url = `${endpoints.authcentral}/device-auth/token`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    if (res.status === 200 && body.accessToken) {
      return { state: "ok", accessToken: body.accessToken, refreshToken: body.refreshToken, expiresAt: body.expiresAt };
    }
    if (res.status === 429 || body.error === "slow_down") return { state: "slow_down" };
    if (res.status === 202) return { state: "pending" };
    if (res.status === 410) return { state: "expired" };
    throw new HttpError(res.status, body, "POST", url);
  },
};
