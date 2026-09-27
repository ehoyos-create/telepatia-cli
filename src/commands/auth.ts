import type { Command } from "commander";
import { authcentral, type LoginResult } from "../auth/authcentral.js";
import { decodeJwt } from "../auth/jwt.js";
import { currentClaims, getAccessToken, persistTokens } from "../auth/session.js";
import { clearPending, clearSession, loadPending, loadSession, savePending, type AccountSummary, type PendingLogin } from "../auth/store.js";
import { credentialsPath, endpoints } from "../config.js";
import { CliError, EXIT, HttpError } from "../errors.js";
import { wantJson } from "../output.js";
import { c, choose, done, info, parseMinutes, printJson, prompt, promptHidden, sleep, table } from "../ui.js";

const accountLabel = (a: AccountSummary) =>
  `${a.institutionName}${a.nameFull ? ` — ${a.nameFull}` : ""} ${c.dim(`(${a.roles.join(", ") || "sin rol"}, ${a.accountId})`)}`;

/** Whether we can ask the person at the keyboard. Agents and scripts get a resumable step instead. */
const interactive = () => Boolean(process.stdin.isTTY);

/** Reports a login that needs something from the user, and the exact command that continues it. */
function pendingStep(status: string, data: Record<string, unknown>, next: string, human: string): void {
  if (wantJson()) printJson({ ok: true, status, ...data, next });
  else info(`${human}\nContinúa con: ${c.bold(next)}`);
}

function loggedIn(accessToken: string): void {
  clearPending();
  const claims = decodeJwt(accessToken);
  done(
    { status: "logged_in", email: claims.email ?? null, accountId: claims.accountId },
    c.green(`✓ Sesión iniciada${claims.email ? ` como ${claims.email}` : ""}.`) +
      "\n" +
      c.dim(`  Credenciales guardadas en ${credentialsPath()} (permisos 600).`),
  );
}

/**
 * Drives a LoginResult to completion: 2FA code → institution picker → tokens.
 * Mirrors the web store's result handler. Without a terminal it saves the step and
 * returns, so `telepatia login --code …` / `--account …` can resume it.
 */
async function completeLogin(result: LoginResult, preferredAccountId?: string): Promise<void> {
  for (;;) {
    if (result.mfaChallenge) {
      const hint = result.mfaChallenge.emailHint;
      if (!interactive()) {
        savePending({ kind: "mfa", challengeToken: result.mfaChallenge.challengeToken, account: preferredAccountId });
        return pendingStep(
          "code_required",
          { sentTo: hint ?? null },
          "telepatia login --code <6 dígitos>",
          `Te enviamos un código de verificación${hint ? ` a ${hint}` : ""}.`,
        );
      }
      const code = await prompt(`Código de verificación de 6 dígitos${hint ? ` (enviado a ${hint})` : ""}: `);
      if (!/^\d{6}$/.test(code)) {
        info(c.red("El código debe tener 6 dígitos."));
        continue;
      }
      result = await authcentral.verify2fa(result.mfaChallenge.challengeToken, code);
      continue;
    }
    if (result.requiresInstitutionSelection && result.preAuthToken && result.accounts?.length) {
      const accounts = result.accounts;
      let picked = accounts.find((a) => a.accountId === preferredAccountId);
      if (!picked && !interactive()) {
        savePending({ kind: "account", preAuthToken: result.preAuthToken, accounts });
        return pendingStep(
          "account_required",
          { accounts: accounts.map((a) => ({ accountId: a.accountId, institution: a.institutionName, name: a.nameFull, roles: a.roles })) },
          "telepatia login --account <accountId>",
          `Tienes varias cuentas:\n${accounts.map((a) => `  ${accountLabel(a)}`).join("\n")}`,
        );
      }
      picked ??= await choose("Tienes varias cuentas/instituciones. Elige una", accounts, accountLabel);
      result = await authcentral.selectAccount(result.preAuthToken, picked.accountId);
      continue;
    }
    if (result.token) {
      persistTokens(result.token, result.availableAccounts ?? result.accounts ?? []);
      return loggedIn(result.token.accessToken);
    }
    throw new CliError("Respuesta de login inesperada del servidor.", EXIT.AUTH);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function loginPassword(emailArg: string | undefined, account: string | undefined, passwordStdin: boolean) {
  const email = emailArg ?? process.env.TELEPATIA_EMAIL ?? (await prompt("Email: "));
  const password = passwordStdin ? await readStdin() : (process.env.TELEPATIA_PASSWORD ?? (await promptHidden("Contraseña: ")));
  try {
    await completeLogin(await authcentral.login(email, password), account);
  } catch (err) {
    if (err instanceof HttpError && err.code === "email_not_verified") {
      throw new CliError("Tu email no está verificado. Revisa tu bandeja de entrada y confirma la cuenta.", EXIT.AUTH);
    }
    if (err instanceof HttpError && err.status === 401) throw new CliError("Email o contraseña incorrectos.", EXIT.AUTH);
    if (err instanceof HttpError && err.status === 429) throw new CliError("Demasiados intentos. Espera un momento.", EXIT.AUTH);
    throw err;
  }
}

async function loginOtp(emailArg: string | undefined, channel: "auto" | "email" | "whatsapp", account?: string) {
  const identifier = emailArg ?? process.env.TELEPATIA_EMAIL ?? (await prompt("Email: "));
  let challenge = await authcentral.passwordlessStart(identifier, channel);
  if (!interactive()) {
    savePending({ kind: "otp", challengeToken: challenge.challengeToken, account });
    return pendingStep(
      "code_required",
      { channel: challenge.channel, sentTo: challenge.hint ?? null },
      "telepatia login --code <código>",
      `Código enviado por ${challenge.channel}${challenge.hint ? ` a ${challenge.hint}` : ""}.`,
    );
  }
  info(`Código enviado por ${challenge.channel}${challenge.hint ? ` a ${challenge.hint}` : ""}. Escribe "r" para reenviar.`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await prompt("Código: ");
    if (code === "r") {
      challenge = { ...challenge, ...(await authcentral.passwordlessResend(challenge.challengeToken)) };
      info("Código reenviado.");
      attempt--;
      continue;
    }
    try {
      return await completeLogin(await authcentral.passwordlessVerify(challenge.challengeToken, code), account);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 400 || err.status === 422)) {
        info(c.red("Código incorrecto."));
        continue;
      }
      throw err;
    }
  }
  throw new CliError("Demasiados intentos fallidos.", EXIT.AUTH);
}

/** Second step of a non-interactive OTP/2FA login. */
async function loginWithCode(code: string, account?: string) {
  const p = loadPending();
  if (p?.kind !== "otp" && p?.kind !== "mfa")
    throw new CliError("No hay un login esperando código.", EXIT.USAGE, "telepatia login --otp <email>");
  let result: LoginResult;
  try {
    result = p.kind === "mfa" ? await authcentral.verify2fa(p.challengeToken, code) : await authcentral.passwordlessVerify(p.challengeToken, code);
  } catch (err) {
    if (err instanceof HttpError && [400, 401, 422].includes(err.status))
      throw new CliError("Código incorrecto o vencido.", EXIT.AUTH, "telepatia login --code <código>  (o pide otro: telepatia login --otp <email>)");
    throw err;
  }
  await completeLogin(result, account ?? p.account);
}

/** Second step of a non-interactive login with several institutions. Returns false when nothing was pending. */
async function loginWithAccount(accountId: string): Promise<boolean> {
  const p = loadPending();
  if (p?.kind !== "account") return false;
  if (!p.accounts.some((a) => a.accountId === accountId))
    throw new CliError(`La cuenta ${accountId} no está entre las disponibles.`, EXIT.USAGE, "telepatia login --account <accountId>");
  await completeLogin(await authcentral.selectAccount(p.preAuthToken, accountId));
  return true;
}

/** Polls a device login until approved, expired, or `maxMs` elapses. */
async function pollDevice(p: Extract<PendingLogin, { kind: "device" }>, maxMs: number): Promise<void> {
  let interval = Math.max(1, p.interval) * 1000;
  let backoff = 1;
  const stopAt = Math.min(p.expiresAt, Date.now() + maxMs);
  while (Date.now() < stopAt) {
    await sleep(Math.min(interval, Math.max(0, stopAt - Date.now())));
    const r = await authcentral.devicePoll(p.deviceCode);
    if (r.state === "ok") {
      const claims = decodeJwt(r.accessToken);
      if (!claims.uid || !claims.accountId) throw new CliError("El token recibido no es válido.", EXIT.AUTH);
      persistTokens(r);
      return loggedIn(r.accessToken);
    }
    if (r.state === "expired") break;
    if (r.state === "slow_down") {
      backoff = Math.min(4, backoff + 1);
      interval = Math.max(1, p.interval) * 1000 * backoff;
    }
  }
  if (Date.now() >= p.expiresAt) {
    clearPending();
    throw new CliError("El código de dispositivo expiró.", EXIT.AUTH, "telepatia login --device");
  }
  throw new CliError(`Aún no aprueban el código ${p.userCode} en la app móvil.`, EXIT.TIMEOUT, "telepatia login --wait --timeout 100s");
}

async function loginDevice() {
  const start = await authcentral.deviceStart();
  const url = `${endpoints.web}/device-login?code=${encodeURIComponent(start.user_code)}`;
  const pending = {
    kind: "device" as const,
    deviceCode: start.device_code,
    userCode: start.user_code,
    interval: start.interval,
    expiresAt: Date.now() + start.expires_in * 1000,
  };
  savePending(pending);
  if (!interactive()) {
    return pendingStep(
      "approval_required",
      { userCode: start.user_code, url, expiresInSeconds: start.expires_in },
      "telepatia login --wait --timeout 100s",
      `Aprueba el código ${start.user_code} desde la app móvil de Telepatia Scribe (${url}).`,
    );
  }
  info(`\n  Código: ${c.bold(start.user_code)}`);
  info(`  Aprueba el inicio de sesión desde la app móvil de Telepatia Scribe.`);
  info(c.dim(`  (${url})\n`));
  await pollDevice(pending, Number.POSITIVE_INFINITY);
}

async function loginApiKey(apiKey: string, account?: string) {
  await completeLogin(await authcentral.apiKeyExchange(apiKey), account);
}

export function registerAuth(program: Command) {
  program
    .command("login")
    .description("Inicia sesión (email+contraseña por defecto). Sin terminal funciona en dos pasos.")
    .argument("[email]", "tu email")
    .option("--otp", "sin contraseña: recibe un código por email/WhatsApp")
    .option("--channel <canal>", "canal del código con --otp: auto | email | whatsapp", "auto")
    .option("--code <código>", "paso 2: el código recibido (OTP o 2FA)")
    .option("--device", "aprueba desde la app móvil (flujo de dispositivo)")
    .option("--wait", "paso 2 de --device: espera la aprobación")
    .option("--timeout <duración>", "con --wait: espera máxima (90s, 5m)", "100s")
    .option("--api-key <key>", "intercambia una API key institucional (o usa TELEPATIA_API_KEY)")
    .option("--password-stdin", "lee la contraseña de stdin (o usa TELEPATIA_PASSWORD)")
    .option("--account <accountId>", "cuenta/institución a usar si tienes varias (también paso 2)")
    .addHelpText(
      "after",
      `
Sin terminal (agentes, scripts) el login se hace en dos pasos; cada paso imprime "next":
  telepatia login --otp medico@x.com      → {"status":"code_required",...}
  telepatia login --code 123456           → {"status":"logged_in",...}
  telepatia login --device                → {"status":"approval_required","userCode":"…"}
  telepatia login --wait                  → espera la aprobación en la app móvil
  telepatia login --account <accountId>   → si hay varias instituciones

Variables de entorno: TELEPATIA_EMAIL, TELEPATIA_PASSWORD, TELEPATIA_API_KEY.
Para scripts puedes saltarte el login con TELEPATIA_TOKEN=<access token>.`,
    )
    .action(async (email: string | undefined, o) => {
      if (o.code) return loginWithCode(String(o.code).trim(), o.account);
      if (o.wait) {
        const p = loadPending();
        if (p?.kind !== "device") throw new CliError("No hay un login de dispositivo pendiente.", EXIT.USAGE, "telepatia login --device");
        return pollDevice(p, parseMinutes(o.timeout, 100 / 60) * 60_000);
      }
      if (o.account && !email && !o.otp && !o.device && (await loginWithAccount(o.account))) return;
      const apiKey = o.apiKey ?? process.env.TELEPATIA_API_KEY;
      if (o.device) return loginDevice();
      if (apiKey) return loginApiKey(apiKey, o.account);
      if (o.otp) return loginOtp(email, o.channel, o.account);
      if (!interactive() && !o.passwordStdin && !process.env.TELEPATIA_PASSWORD)
        throw new CliError(
          "Sin terminal no puedo pedir la contraseña. Usa un código (OTP) o la app móvil.",
          EXIT.NEEDS_INPUT,
          "telepatia login --otp <email>   ó   telepatia login --device",
        );
      return loginPassword(email, o.account, Boolean(o.passwordStdin));
    });

  program
    .command("logout")
    .description("Cierra la sesión y borra las credenciales locales")
    .action(async () => {
      const s = loadSession();
      if (s) await authcentral.logout(s.refreshToken);
      clearSession();
      clearPending();
      done({ status: "logged_out" }, "Sesión cerrada.");
    });

  program
    .command("whoami")
    .description("Muestra con qué cuenta estás autenticado (sale con código 3 si no hay sesión)")
    .action(async () => {
      const claims = await currentClaims();
      const s = loadSession();
      const acct = s?.availableAccounts.find((a) => a.accountId === claims.accountId);
      const out = {
        email: claims.email ?? null,
        uid: claims.uid,
        accountId: claims.accountId,
        institutionId: claims.institutionalId ?? null,
        institution: acct?.institutionName ?? null,
        roles: claims.roles ?? [],
        country: claims.country ?? null,
        tokenExpiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
      };
      if (wantJson()) return printJson(out);
      for (const [k, v] of Object.entries(out)) info(`${c.dim(k.padEnd(15))} ${Array.isArray(v) ? v.join(", ") : (v ?? "—")}`);
    });

  const accounts = program.command("accounts").description("Cuentas/instituciones disponibles");

  accounts
    .command("list", { isDefault: true })
    .description("Lista tus cuentas")
    .action(async () => {
      const token = await getAccessToken();
      const { accounts: list } = await authcentral.availableAccounts(token);
      const active = decodeJwt(token).accountId;
      if (wantJson()) return printJson(list.map((a) => ({ ...a, active: a.accountId === active })));
      table(
        list.map((a) => ({
          "": a.accountId === active ? "*" : "",
          id: a.accountId,
          institución: a.institutionName,
          nombre: a.nameFull,
          roles: a.roles.join(","),
        })),
        ["", "id", "institución", "nombre", "roles"],
      );
    });

  accounts
    .command("switch")
    .description("Cambia de cuenta/institución activa")
    .argument("<accountId>")
    .action(async (accountId: string) => {
      const res = await authcentral.switchAccount(await getAccessToken(), accountId);
      if (!res.token) throw new CliError("El servidor no devolvió un token para esa cuenta.", EXIT.API);
      persistTokens(res.token, res.availableAccounts ?? res.accounts ?? loadSession()?.availableAccounts ?? []);
      done({ accountId }, c.green(`✓ Cuenta activa: ${accountId}`));
    });
}
