#!/usr/bin/env node
import { Command } from "commander";
import { VERSION } from "./config.js";
import { registerApi } from "./commands/api.js";
import { registerAuth } from "./commands/auth.js";
import { registerConsultations } from "./commands/consultations.js";
import { registerPatients } from "./commands/patients.js";
import { registerRecord } from "./commands/record.js";
import { registerTemplates } from "./commands/templates.js";
import { registerUpload } from "./commands/upload.js";
import { CliError, HttpError } from "./errors.js";
import { runTui } from "./tui/app.js";
import { c } from "./ui.js";

const program = new Command()
  .name("telepatia")
  .description("CLI no oficial de Telepatia Scribe — consultas, notas, transcripciones y pacientes desde la terminal.")
  .version(VERSION)
  .showHelpAfterError();

registerAuth(program);
registerConsultations(program);
registerUpload(program);
registerRecord(program);
registerPatients(program);
registerTemplates(program);
registerApi(program);

program
  .command("menu", { isDefault: false })
  .description("Abre el menú interactivo (lo mismo que ejecutar `telepatia` sin argumentos)")
  .action(runTui);

const interactive = process.argv.length <= 2 && process.stdin.isTTY && process.stdout.isTTY;

(interactive ? runTui() : program.parseAsync()).catch((err: unknown) => {
  if (err instanceof CliError) {
    process.stderr.write(c.red(`Error: ${err.message}`) + "\n");
    process.exit(err.exitCode);
  }
  if (err instanceof HttpError) {
    process.stderr.write(c.red(`Error de la API: ${err.message}`) + "\n");
    if (err.status === 401 || err.status === 403) process.stderr.write("Prueba iniciar sesión de nuevo: telepatia login\n");
    process.exit(1);
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    process.stderr.write(c.red("Error: la petición tardó demasiado. Revisa tu conexión.") + "\n");
    process.exit(1);
  }
  process.stderr.write(c.red(`Error inesperado: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`) + "\n");
  process.exit(1);
});
