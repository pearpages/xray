#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { loadQualityConfig } from "./config.js";
import { analyzeQuality } from "./report.js";

interface Options {
  cwd: string;
  out?: string;
  config?: string;
}

const program = new Command()
  .name("xray-quality")
  .description("Score the quality of a whole repository and write a JSON report. Reads the repository, never changes it.")
  .option("-C, --cwd <dir>", "root of the repository to analyse", process.cwd())
  .option("-o, --out <file>", "write the report to a file instead of stdout")
  .option("-c, --config <file>", "config with a `quality` section (default: xray.config.json in --cwd)")
  .action(async (options: Options) => {
    const root = resolve(options.cwd);
    const report = await analyzeQuality(root, loadQualityConfig(root, options.config));
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.out) writeFileSync(options.out, json);
    else process.stdout.write(json);
    if (options.out) {
      const scores = report.metrics.map((metric) => `${metric.name} ${metric.score ?? "n/a"}`).join(" · ");
      console.error(`xray-quality: ${report.score ?? "n/a"}/100 (${scores}) → ${options.out}`);
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`xray-quality: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
