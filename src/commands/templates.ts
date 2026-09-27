import type { Command } from "commander";
import { wantJson } from "../output.js";
import { gql } from "../api/graphql.js";
import { GET_TEMPLATE } from "../api/queries.js";
import { CliError, EXIT } from "../errors.js";
import { listTemplates } from "../sessions.js";
import { c, printJson, table } from "../ui.js";

export function registerTemplates(program: Command) {
  const cmd = program.command("templates").alias("t").description("Plantillas de nota clínica");

  cmd
    .command("list", { isDefault: true })
    .description("Lista tus plantillas")
    .action(async (o) => {
      const list = await listTemplates();
      if (wantJson()) return printJson(list);
      table(
        list.map((t) => ({ id: t.id, nombre: t.name, tipo: t.type ?? "", especialidades: (t.specialties ?? []).join(", ") })),
        ["id", "nombre", "tipo", "especialidades"],
      );
    });

  cmd
    .command("show")
    .description("Secciones e instrucciones de una plantilla")
    .argument("<id>")
    .option("--lang <código>", "idioma de los títulos", "es")
    .action(async (id: string, o) => {
      const { scribeSessionConfiguration: t } = await gql<{ scribeSessionConfiguration: any }>(GET_TEMPLATE, { id });
      if (!t) throw new CliError(`No existe la plantilla ${id}`, EXIT.NOT_FOUND, "telepatia templates");
      if (wantJson()) return printJson(t);
      console.log(c.bold(t.name) + (t.description ? ` — ${t.description}` : ""));
      const nodes = [...(t.nodes ?? [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
      for (const n of nodes) {
        if (n.enabled === false || n.hidden) continue;
        const title = n.name?.[o.lang] ?? n.name?.default ?? n.key;
        const instr = n.instruction?.[o.lang] ?? n.instruction?.default;
        console.log(`\n${c.cyan("•")} ${c.bold(title)} ${c.dim(`(${n.key})`)}`);
        if (instr) console.log(c.dim("  " + instr.replace(/\n/g, "\n  ")));
      }
    });
}
