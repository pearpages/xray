#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
// The lean entry: ts-morph loads only when a selected analysis needs it (ADR-0021).
import {
  agentReport,
  analyzePullRequest,
  isPrAnalyzer,
  isSeverity,
  loadConfig,
  PR_ANALYZERS,
  prAgentResults,
  renderMarkdown,
  SEVERITIES,
  type AgentSeverity,
  type PrAnalyzerId,
} from "@xray/core/pr";

interface CliOptions {
  cwd: string;
  format: "markdown" | "json" | "agent";
  out?: string;
  config?: string;
  head?: string;
  inventory?: boolean;
  bundle?: boolean;
  only?: PrAnalyzerId[];
  minSeverity?: AgentSeverity;
  top?: number;
}

function parseOnly(value: string): PrAnalyzerId[] {
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !isPrAnalyzer(id));
  if (ids.length === 0 || unknown.length > 0) {
    throw new InvalidArgumentError(`expected a comma-separated list of ${PR_ANALYZERS.join(", ")}`);
  }
  return ids as PrAnalyzerId[];
}

function parseSeverity(value: string): AgentSeverity {
  if (!isSeverity(value)) throw new InvalidArgumentError(`expected one of ${SEVERITIES.join(", ")}`);
  return value;
}

function parseTop(value: string): number {
  const top = Number(value);
  if (!Number.isInteger(top) || top < 0) throw new InvalidArgumentError("expected a whole number, 0 or more");
  return top;
}

const program = new Command()
  .name("xray")
  .description("Analyse the current branch against the base branch and produce the PR report.")
  .argument("[base]", "base branch of the PR", "main")
  .option("-C, --cwd <dir>", "root of the repository to analyse", process.cwd())
  .option("-f, --format <format>", "markdown | json | agent (findings only, for tools)", "markdown")
  .option("-o, --out <file>", "write the report to a file instead of stdout")
  .option("-c, --config <file>", "config path, relative to --cwd (default xray.config.json)")
  .option("--head <sha>", "commit to report as the PR head (default HEAD)")
  .option("--only <ids>", `run only these analyses, comma separated: ${PR_ANALYZERS.join(", ")}`, parseOnly)
  .option("--min-severity <level>", "agent format: lowest severity kept, high | medium | low (default medium)", parseSeverity)
  .option("--top <n>", "agent format: most findings kept (default 10)", parseTop)
  .option("--bundle", "also install and build the base and the PR to compare bundle sizes (runs the project's scripts)")
  .option(
    "--inventory",
    "print entry point candidates and feature map checks as JSON (for the feature map skill; ignores base)",
  )
  .exitOverride()
  .action(async (base: string, options: CliOptions) => {
    if (!["markdown", "json", "agent"].includes(options.format)) {
      program.error(`Unknown format: ${options.format}`, { exitCode: 2 });
    }
    const cwd = resolve(options.cwd);
    const write = (output: string) => (options.out ? writeFileSync(options.out, output) : process.stdout.write(output));
    if (options.inventory) {
      const { inventory } = await import("@xray/core");
      write(`${JSON.stringify(inventory(cwd, loadConfig(cwd, options.config)), null, 2)}\n`);
      return;
    }
    const config = loadConfig(cwd, options.config);
    if (options.bundle) config.bundle.enabled = true;
    const result = await analyzePullRequest({ cwd, base, config, head: options.head, only: options.only });
    if (options.format === "agent") {
      const report = agentReport("xray", result.meta.head, prAgentResults(result), {
        minSeverity: options.minSeverity,
        top: options.top,
      });
      write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));
    }
  });

// Exit codes (ADR-0021): 0 when the analysis ran, whatever it found; 1 when xray failed; 2 for usage errors.
program.parseAsync().catch((error: unknown) => {
  if (error instanceof CommanderError) process.exit(error.exitCode === 0 ? 0 : 2);
  console.error(`xray: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
