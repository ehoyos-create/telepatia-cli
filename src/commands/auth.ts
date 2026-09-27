import type { Command } from "commander";
import { authcentral, type LoginResult } from "../auth/authcentral.js";
import { decodeJwt } from "../auth/jwt.js";
import { currentClaims, getAccessToken, persistTokens } from "../auth/session.js";
import { clearSession, loadSession, type AccountSummary } from "../auth/store.js";
import { credentialsPath, endpoints } from "../config.js";
import { CliError, HttpError } from "../errors.js";
import { c, choose, info, printJson, prompt, promptHidden, sleep, table } from "../ui.js";

const accountLabel = (a: AccountSummary) =>
  `${a.institutionName}${a.nameFull ? ` — ${a.nameFull}` : ""} ${c.dim(`(${a.roles.join(", ") || "sin rol"}, ${a.accountId})`)}`;

/**
 * Drives a LoginResult to completion: 2FA code → institution picker → tokens.
 * Mirrors the web store's result handler.
 */
async function completeLogin(result: LoginResult, preferredAccountId?: string): Promise<void> {
  for (;;) {
    if (result.mfaChallenge) {
      const hint = result.mfaChallenge.emailHint ? ` (enviado a ${result.mfaChallenge.emailHint})` : "";
      const code = await prompt(`Código de verificación de 6 dígitos${hint}: `);
      if (!/^\d{6}$/.test(code)) {
        info(c.red("El código debe tener 6 dígitos."));
        continue;
      }
      result = await authcentral.verify2fa(result.mfaChallenge.challengeToken, code);
      continue;
    }
    if (result.requiresInstitutionSelection && result.preAuthToken && result.accounts?.length) {
      const accounts = result.accounts;
      const picked =
        accounts.find((a) => a.accountId === preferredAccountId) ??
        (await choose("Tienes varias cuentas/instituciones. Elige una", accounts, accountLabel));
      result = await authcentral.selectAccount(result.preAuthToken, picked.accountId);
      continue;
    }
    if (result.token) {
      persistTokens(result.token, result.availableAccounts ?? result.accounts ?? []);
      const claims = decodeJwt(result.token.accessToken);
      info(c.green(`✓ Sesión iniciada${claims.email ? ` como ${claims.email}` : ""}.`));
      info(c.dim(`  Credenciales guardadas en ${credentialsPath()} (permisos 600).`));
      return;
    }
    throw new CliError("Respuesta de login inesperada del servidor.");
  }
}

async function loginPassword(emailArg?: string, account?: string) {
  const email = emailArg ?? process.env.TELEPATIA_EMAIL ?? (await prompt("Email: "));
  const password = process.env.TELEPATIA_PASSWORD ?? (await promptHidden("Contraseña: "));
  try {
    await completeLogin(await authcentral.login(email, password), account);
  } catch (err) {
    if (err instanceof HttpError && err.code === "email_not_verified") {
      throw new CliError("Tu email no está verificado. Revisa tu bandeja de entrada y confirma la cuenta.");
    }
    if (err instanceof HttpError && err.status === 401) throw new CliError("Email o contraseña incorrectos.");
    if (err instanceof HttpError && err.status === 429) throw new CliError("Demasiados intentos. Espera un momento.");
    throw err;
  }
}

async function loginOtp(emailArg: string | undefined, channel: "auto" | "email" | "whatsapp", account?: string) {
  const identifier = emailArg ?? (await prompt("Email: "));
  let challenge = await authcentral.passwordlessStart(identifier, channel);
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
  throw new CliError("Demasiados intentos fallidos.");
}

async function loginDevice() {
  const start = await authcentral.deviceStart();
  const url = `${endpoints.web}/device-login?code=${encodeURIComponent(start.user_code)}`;
  info(`\n  Código: ${c.bold(start.user_code)}`);
  info(`  Aprueba el inicio de sesión desde la app móvil de Telepatia Scribe.`);
  info(c.dim(`  (${url})\n`));
  let interval = Math.max(1, start.interval) * 1000;
  let backoff = 1;
  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const r = await authcentral.devicePoll(start.device_code);
    if (r.state === "ok") {
      const claims = decodeJwt(r.accessToken);
      if (!claims.uid || !claims.accountId) throw new CliError("El token recibido no es válido.");
      persistTokens(r);
      info(c.green(`✓ Sesión iniciada${claims.email ? ` como ${claims.email}` : ""}.`));
      return;
    }
    if (r.state === "expired") break;
    if (r.state === "slow_down") {
      backoff = Math.min(4, backoff + 1);
      interval = Math.max(1, start.interval) * 1000 * backoff;
    }
  }
  throw new CliError("El código expiró. Vuelve a ejecutar: telepatia login --device");
}

async function loginApiKey(apiKey: string, account?: string) {
  await completeLogin(await authcentral.apiKeyExchange(apiKey), account);
}

export function registerAuth(program: Command) {
  program
    .command("login")
    .description("Inicia sesión (email+contraseña por defecto)")
    .argument("[email]", "tu email")
    .option("--otp", "sin contraseña: recibe un código por email/WhatsApp")
    .option("--channel <canal>", "canal del código con --otp: auto | email | whatsapp", "auto")
    .option("--device", "aprueba desde la app móvil (flujo de dispositivo)")
    .option("--api-key <key>", "intercambia una API key institucional (o usa TELEPATIA_API_KEY)")
    .option("--account <accountId>", "cuenta/institución a usar si tienes varias")
    .addHelpText(
      "after",
      `
Variables de entorno: TELEPATIA_EMAIL, TELEPATIA_PASSWORD, TELEPATIA_API_KEY.
Para scripts puedes saltarte el login con TELEPATIA_TOKEN=<access token>.`,
    )
    .action(async (email: string | undefined, o) => {
      const apiKey = o.apiKey ?? process.env.TELEPATIA_API_KEY;
      if (o.device) return loginDevice();
      if (apiKey) return loginApiKey(apiKey, o.account);
      if (o.otp) return loginOtp(email, o.channel, o.account);
      return loginPassword(email, o.account);
    });

  program
    .command("logout")
    .description("Cierra la sesión y borra las credenciales locales")
    .action(async () => {
      const s = loadSession();
      if (s) await authcentral.logout(s.refreshToken);
      clearSession();
      info("Sesión cerrada.");
    });

  program
    .command("whoami")
    .description("Muestra con qué cuenta estás autenticado")
    .option("--json", "salida JSON")
    .action(async (o) => {
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
      if (o.json) return printJson(out);
      for (const [k, v] of Object.entries(out)) info(`${c.dim(k.padEnd(15))} ${Array.isArray(v) ? v.join(", ") : (v ?? "—")}`);
    });

  const accounts = program.command("accounts").description("Cuentas/instituciones disponibles");

  accounts
    .command("list", { isDefault: true })
    .description("Lista tus cuentas")
    .option("--json", "salida JSON")
    .action(async (o) => {
      const token = await getAccessToken();
      const { accounts: list } = await authcentral.availableAccounts(token);
      const active = decodeJwt(token).accountId;
      if (o.json) return printJson(list);
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
      if (!res.token) throw new CliError("El servidor no devolvió un token para esa cuenta.");
      persistTokens(res.token, res.availableAccounts ?? res.accounts ?? loadSession()?.availableAccounts ?? []);
      info(c.green(`✓ Cuenta activa: ${accountId}`));
    });
}
