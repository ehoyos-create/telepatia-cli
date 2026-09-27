#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { VERSION } from "./config.js";
import { registerAgent } from "./commands/agent.js";
import { registerApi } from "./commands/api.js";
import { registerAuth } from "./commands/auth.js";
import { registerConsultations } from "./commands/consultations.js";
import { registerPatients } from "./commands/patients.js";
import { registerRecord } from "./commands/record.js";
import { registerTemplates } from "./commands/templates.js";
import { registerUpload } from "./commands/upload.js";
import { describeError, EXIT } from "./errors.js";
import { agentMode } from "./output.js";
import { runTui } from "./tui/app.js";
import { c } from "./ui.js";

const program = new Command()
  .name("telepatia")
  .description("CLI no oficial de Telepatia Scribe — consultas, notas, transcripciones y pacientes desde la terminal.")
  .version(VERSION)
  .option("--json", "salida JSON (por defecto cuando no hay terminal: agentes, pipes)")
  .option("--human", "salida para personas (tablas y colores) aunque no haya terminal")
  .option("--fields <campos>", "con JSON: solo estos campos, p.ej. id,status,patient.fullName")
  .option("-q, --quiet", "sin mensajes de progreso en stderr")
  .configureHelp({ showGlobalOptions: true })
  .exitOverride()
  .addHelpText(
    "after",
    `
Agentes y scripts (Claude Code, pipes): la salida es JSON compacto, las notas son Markdown,
los errores son JSON en stderr con "code" y "hint", y nada se queda esperando input.
  telepatia schema          todos los comandos en JSON
  telepatia skill install   skill para Claude Code
  telepatia mcp             servidor MCP: claude mcp add telepatia -- telepatia mcp
Códigos de salida: 0 ok · 2 uso · 3 sin sesión · 4 no encontrado · 5 timeout · 6 API · 7 falta input`,
  );

// Agents pay for every token: skip the full help dump after a usage error, the hint is enough.
if (agentMode) program.configureOutput({ outputError: () => {} });
else program.showHelpAfterError();

registerAuth(program);
registerConsultations(program);
registerUpload(program);
registerRecord(program);
registerPatients(program);
registerTemplates(program);
registerApi(program);
registerAgent(program);

program
  .command("menu", { isDefault: false })
  .description("Abre el menú interactivo (lo mismo que ejecutar `telepatia` sin argumentos)")
  .action(runTui);

// Subcommands inherit exitOverride only if set before they are added; apply it to all of them.
const walk = (cmd: Command): void => {
  cmd.exitOverride();
  if (agentMode) cmd.configureOutput({ outputError: () => {} });
  cmd.commands.forEach(walk);
};
program.commands.forEach(walk);

const noArgs = process.argv.length <= 2;
const interactive = noArgs && process.stdin.isTTY && process.stdout.isTTY;

function fail(err: unknown): never {
  if (err instanceof CommanderError) {
    // --help / --version, or a group command with no subcommand (which prints its help)
    if (err.exitCode === 0 || err.code === "commander.help" || err.code === "commander.helpDisplayed" || err.code === "commander.version")
      process.exit(0);
    if (err.code === "commander.executeSubCommandAsync") process.exit(err.exitCode);
    const message = err.message.replace(/^error: /, "");
    if (agentMode) {
      process.stderr.write(JSON.stringify({ error: { code: "usage", message, hint: "telepatia schema" } }) + "\n");
    }
    process.exit(EXIT.USAGE);
  }
  const e = describeError(err);
  if (agentMode) {
    const { exitCode: _x, ...error } = e;
    process.stderr.write(JSON.stringify({ error }) + "\n");
  } else {
    process.stderr.write(c.red(`Error: ${e.message}`) + "\n");
    if (e.hint) process.stderr.write(`Prueba: ${c.bold(e.hint)}\n`);
  }
  process.exit(e.exitCode);
}

if (interactive) runTui().catch(fail);
else if (noArgs) {
  // An agent calling `telepatia` bare wants orientation, not an error.
  process.stdout.write(program.helpInformation());
} else program.parseAsync().catch(fail);
