#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { analyzePullRequest, loadConfig, renderMarkdown } from "@xray/core";

interface CliOptions {
  cwd: string;
  format: "markdown" | "json";
  out?: string;
  config?: string;
}

const program = new Command()
  .name("xray")
  .description("Analiza la rama actual frente a la rama base y genera el informe del PR.")
  .argument("[base]", "rama base del PR", "main")
  .option("-C, --cwd <dir>", "raíz del repositorio a analizar", process.cwd())
  .option("-f, --format <format>", "markdown | json", "markdown")
  .option("-o, --out <file>", "escribe el informe en un archivo en vez de stdout")
  .option("-c, --config <file>", "ruta al config, relativa a --cwd (por defecto xray.config.json)")
  .action(async (base: string, options: CliOptions) => {
    if (options.format !== "markdown" && options.format !== "json") {
      program.error(`Formato desconocido: ${options.format}`);
    }
    const cwd = resolve(options.cwd);
    const result = await analyzePullRequest({ cwd, base, config: loadConfig(cwd, options.config) });
    const output =
      options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result);
    if (options.out) writeFileSync(options.out, output);
    else process.stdout.write(output);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`xray: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
