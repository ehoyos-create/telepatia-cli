import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Service endpoints used by the official web app (scribe.telepatia.ai).
 * Every one can be overridden with an env var, e.g. to point at a staging stack.
 */
export const endpoints = {
  web: process.env.TELEPATIA_WEB_URL ?? "https://scribe.telepatia.ai",
  authcentral: process.env.TELEPATIA_AUTH_URL ?? "https://private.telepatia.ai/authcentral",
  aiBackend: process.env.TELEPATIA_AI_BACKEND_URL ?? "https://private.telepatia.ai/ai-backend",
  datalayer: process.env.TELEPATIA_DATALAYER_URL ?? "https://private.telepatia.ai/datalayer/graphql",
  scribeBff: process.env.TELEPATIA_SCRIBE_BFF_URL ?? "https://private.telepatia.ai/scribe-bff",
};

export type Service = "authcentral" | "ai-backend" | "datalayer" | "scribe-bff";

export function serviceUrl(service: Service): string {
  switch (service) {
    case "authcentral":
      return endpoints.authcentral;
    case "ai-backend":
      return endpoints.aiBackend;
    case "datalayer":
      return endpoints.datalayer;
    case "scribe-bff":
      return endpoints.scribeBff;
  }
}

export function configDir(): string {
  if (process.env.TELEPATIA_CONFIG_DIR) return process.env.TELEPATIA_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "telepatia");
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "telepatia");
}

export const credentialsPath = () => join(configDir(), "credentials.json");

/** Identifies CLI-created sessions in Telepatia's metadata (the web app sends "web"). */
export const APP_PLATFORM = "cli";
export const VERSION = "0.1.1";
