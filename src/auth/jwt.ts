export interface TelepatiaClaims {
  uid: string;
  accountId: string;
  institutionalId?: string;
  roles?: string[];
  email?: string;
  country?: string;
  /** Expiry, seconds since epoch. */
  exp?: number;
}

/** Decodes a JWT payload without verifying it (the server verifies; we only read claims). */
export function decodeJwt(token: string): TelepatiaClaims {
  const part = token.split(".")[1];
  if (!part) throw new Error("Token JWT inválido");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as TelepatiaClaims;
}
