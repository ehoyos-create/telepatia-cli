import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../config.js";
import { EXIT } from "../errors.js";
import { runMcpServer } from "../mcp.js";
import { c, done, printJson } from "../ui.js";

const EXIT_CODES = {
  0: "ok",
  [EXIT.ERROR]: "error",
  [EXIT.USAGE]: "usage: argumentos u opciones inválidos",
  [EXIT.AUTH]: "auth_required: no hay sesión o expiró → telepatia login",
  [EXIT.NOT_FOUND]: "not_found",
  [EXIT.TIMEOUT]: "timeout: la operación sigue en curso, repite el comando",
  [EXIT.API]: "api_error",
  [EXIT.NEEDS_INPUT]: "needs_input: falta un dato que no se puede pedir sin terminal; ver hint",
  [EXIT.CANCELLED]: "cancelled",
};

function describeCommand(cmd: Command, parents: string[] = []): Record<string, unknown>[] {
  const path = [...parents, cmd.name()];
  const own = {
    command: path.join(" "),
    aliases: cmd.aliases().length ? cmd.aliases() : undefined,
    description: cmd.description(),
    arguments: cmd.registeredArguments.map((a) => ({
      name: a.name(),
      required: a.required,
      variadic: a.variadic || undefined,
      description: a.description || undefined,
    })),
    options: cmd.options
      .filter((o) => !o.hidden)
      .map((o) => ({
        flags: o.flags,
        description: o.description,
        default: o.defaultValue,
      })),
  };
  const children = cmd.commands.flatMap((sub) => describeCommand(sub, path));
  const isGroup = cmd.commands.length > 0 && !(cmd as unknown as { _actionHandler?: unknown })._actionHandler;
  return isGroup ? children : [own, ...children];
}

/** Path of the bundled skill, whether running from src/ (tsx) or dist/. */
const skillSource = () => fileURLToPath(new URL("../../skills/telepatia/SKILL.md", import.meta.url));

export function registerAgent(program: Command) {
  program
    .command("schema")
    .description("Describe todos los comandos, argumentos, opciones y códigos de salida en JSON (para agentes)")
    .action(() => {
      printJson({
        name: "telepatia",
        version: VERSION,
        globalOptions: program.options.filter((o) => !o.hidden).map((o) => ({ flags: o.flags, description: o.description })),
        outputModes:
          "Modo agente (stdout no es TTY, CLAUDECODE o TELEPATIA_OUTPUT=json): datos en JSON compacto sin campos vacíos; notas en Markdown; " +
          "errores como {error:{code,message,hint}} en stderr. --human fuerza tablas; --json fuerza JSON también en notas.",
        exitCodes: EXIT_CODES,
        env: {
          TELEPATIA_TOKEN: "access token; salta el login",
          TELEPATIA_OUTPUT: "json | human",
          TELEPATIA_EMAIL: "email para login",
          TELEPATIA_API_KEY: "API key institucional",
          TELEPATIA_CONFIG_DIR: "carpeta de credenciales",
        },
        commands: program.commands.filter((x) => !["schema", "menu"].includes(x.name())).flatMap((x) => describeCommand(x)),
      });
    });

  const skill = program.command("skill").description("Skill de Claude Code para usar este CLI");

  skill
    .command("show", { isDefault: true })
    .description("Imprime el SKILL.md (guía compacta del CLI para agentes)")
    .action(() => void process.stdout.write(readFileSync(skillSource(), "utf8")));

  skill
    .command("install")
    .description("Instala la skill en ~/.claude/skills/telepatia (o en el proyecto con --project)")
    .option("--project", "instalar en ./.claude/skills/telepatia del directorio actual")
    .action((o) => {
      const dir = join(o.project ? process.cwd() : homedir(), ".claude", "skills", "telepatia");
      const file = join(dir, "SKILL.md");
      const existed = existsSync(file);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, readFileSync(skillSource(), "utf8"));
      done(
        { file, updated: existed },
        c.green(`✓ Skill ${existed ? "actualizada" : "instalada"} en ${file}`) + "\n" + c.dim("  Claude Code la cargará en la próxima sesión."),
      );
    });

  program
    .command("mcp")
    .description("Servidor MCP por stdio para Claude y otros clientes: claude mcp add telepatia -- telepatia mcp")
    .action(runMcpServer);
}
