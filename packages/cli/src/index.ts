#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { analyzePullRequest, inventory, loadConfig, renderMarkdown } from "@xray/core";

interface CliOptions {
  cwd: string;
  format: "markdown" | "json";
  out?: string;
  config?: string;
  head?: string;
  inventory?: boolean;
}

const program = new Command()
  .name("xray")
  .description("Analyse the current branch against the base branch and produce the PR report.")
  .argument("[base]", "base branch of the PR", "main")
  .option("-C, --cwd <dir>", "root of the repository to analyse", process.cwd())
  .option("-f, --format <format>", "markdown | json", "markdown")
  .option("-o, --out <file>", "write the report to a file instead of stdout")
  .option("-c, --config <file>", "config path, relative to --cwd (default xray.config.json)")
  .option("--head <sha>", "commit to report as the PR head (default HEAD)")
  .option(
    "--inventory",
    "print entry point candidates and feature map checks as JSON (for the feature map skill; ignores base)",
  )
  .action(async (base: string, options: CliOptions) => {
    if (options.format !== "markdown" && options.format !== "json") {
      program.error(`Unknown format: ${options.format}`);
    }
    const cwd = resolve(options.cwd);
    if (options.inventory) {
      const output = `${JSON.stringify(inventory(cwd, loadConfig(cwd, options.config)), null, 2)}\n`;
      if (options.out) writeFileSync(options.out, output);
      else process.stdout.write(output);
      return;
    }
    const result = await analyzePullRequest({
      cwd,
      base,
      config: loadConfig(cwd, options.config),
      head: options.head,
    });
    const output =
      options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result);
    if (options.out) writeFileSync(options.out, output);
    else process.stdout.write(output);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`xray: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
