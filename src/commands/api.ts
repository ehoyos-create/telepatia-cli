import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { gql } from "../api/graphql.js";
import { authedFetch } from "../api/http.js";
import { serviceUrl, type Service } from "../config.js";
import { CliError } from "../errors.js";
import { printJson } from "../ui.js";

const readArg = async (v: string) => (v.startsWith("@") ? readFile(v.slice(1), "utf8") : v);

export function registerApi(program: Command) {
  const cmd = program.command("api").description("Acceso directo a la API (para lo que el CLI aún no cubre). Ver docs/API.md");

  cmd
    .command("graphql")
    .alias("gql")
    .description("Ejecuta una consulta GraphQL contra el datalayer")
    .argument("<query>", "documento GraphQL, o @archivo.graphql")
    .option("-v, --vars <json>", "variables en JSON, o @archivo.json")
    .action(async (q: string, o) => {
      const vars = o.vars ? JSON.parse(await readArg(o.vars)) : undefined;
      printJson(await gql(await readArg(q), vars));
    });

  cmd
    .command("rest")
    .description("Petición REST autenticada")
    .argument("<method>", "GET, POST, PATCH, DELETE…")
    .argument("<service>", "ai-backend | scribe-bff | authcentral")
    .argument("<path>", "p.ej. /v1/intelligence/scales?language=es")
    .option("-d, --data <json>", "cuerpo JSON, o @archivo.json")
    .action(async (method: string, service: string, path: string, o) => {
      if (!["ai-backend", "scribe-bff", "authcentral"].includes(service)) throw new CliError(`Servicio desconocido: ${service}`);
      const body = o.data ? JSON.parse(await readArg(o.data)) : undefined;
      const res = await authedFetch(serviceUrl(service as Service) + path, { method: method.toUpperCase(), body });
      typeof res === "string" ? console.log(res) : printJson(res);
    });
}
