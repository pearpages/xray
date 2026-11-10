#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { agentReport, buildDependencyGraph, isSeverity, SEVERITIES, type AgentSeverity } from "@xray/core";
import { compareReports } from "./compare.js";
import { loadQualityConfig } from "./config.js";
import { git } from "./files.js";
import { writeReport } from "./output.js";
import { ANALYZERS } from "./registry.js";
import { analyzeQuality } from "./report.js";
import type { QualityReport } from "./types.js";

interface Options {
  cwd: string;
  out?: string;
  config?: string;
  only?: string[];
  files?: string[];
  cache: boolean;
  format: "json" | "agent" | "graph";
  minSeverity?: AgentSeverity;
  top?: number;
}

const IDS = ANALYZERS.map((analyzer) => analyzer.id);

function parseOnly(value: string): string[] {
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !IDS.includes(id))) {
    throw new InvalidArgumentError(`expected a comma-separated list of ${IDS.join(", ")}`);
  }
  return ids;
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

/** Reads a saved report: the one place a compared file is parsed. Throws a message naming the file. */
function readReport(file: string): QualityReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} can't be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = parsed as Partial<QualityReport> | null;
  if (report?.version !== 1 || !Array.isArray(report.metrics) || typeof report.repo?.commit !== "string") {
    throw new Error(`${file} is not a quality report (version 1)`);
  }
  return report as QualityReport;
}

const program = new Command()
  .name("xray-quality")
  .enablePositionalOptions()
  .description(
    "Score the quality of a whole repository and write a JSON report. Reads the repository; writes only its own ignored .xray/cache/.",
  )
  .option("-C, --cwd <dir>", "root of the repository to analyse", process.cwd())
  .option("-o, --out <file>", "write the report to a file instead of stdout")
  .option("-c, --config <file>", "config with a `quality` section (default: xray.config.json in --cwd)")
  .option("-f, --format <format>", "json | agent (findings only, for tools) | graph (the import graph)", "json")
  .option("--only <ids>", `run only these metrics, comma separated: ${IDS.join(", ")}`, parseOnly)
  .option("--files <paths...>", "report findings for these files, folders or globs only (scores become null)")
  .option("--no-cache", "don't read or write .xray/cache/ (git churn by commit)")
  .option("--min-severity <level>", "agent format: lowest severity kept, high | medium | low (default medium)", parseSeverity)
  .option("--top <n>", "agent format: most findings kept (default 10)", parseTop)
  .exitOverride()
  .action(async (options: Options) => {
    if (options.format !== "json" && options.format !== "agent" && options.format !== "graph") {
      program.error(`Unknown format: ${options.format}`, { exitCode: 2 });
    }
    const root = resolve(options.cwd);
    if (options.format === "graph") {
      // The whole repository's imports for other tools (ADR-0023): no metric runs.
      const graph = await buildDependencyGraph(root, loadQualityConfig(root, options.config).xray);
      let commit = "unknown";
      try {
        commit = git(root, ["rev-parse", "HEAD"]);
      } catch {
        // Not a git repository: the graph is still valid.
      }
      const output = { version: 1, tool: "xray-quality", commit, modules: [...graph.modules].sort(), edges: graph.edges };
      const json = `${JSON.stringify(output, null, 2)}\n`;
      if (options.out) writeReport(options.out, json);
      else process.stdout.write(json);
      return;
    }
    const analyzers = options.only ? ANALYZERS.filter((analyzer) => options.only!.includes(analyzer.id)) : ANALYZERS;
    const report = await analyzeQuality(root, loadQualityConfig(root, options.config), analyzers, {
      ...(options.files ? { files: options.files } : {}),
      cache: options.cache,
    });
    const output =
      options.format === "agent"
        ? agentReport(
            "xray-quality",
            report.repo.commit,
            report.metrics.map((metric) => ({
              analyzer: metric.id,
              status: metric.status,
              summary: metric.summary,
              findings: metric.findings.map((finding) => ({ analyzer: metric.id, ...finding })),
            })),
            { minSeverity: options.minSeverity, top: options.top },
          )
        : report;
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (options.out) writeReport(options.out, json);
    else process.stdout.write(json);
    if (options.out && options.format === "json") {
      const scores = report.metrics.map((metric) => `${metric.name} ${metric.score ?? "n/a"}`).join(" · ");
      console.error(`xray-quality: ${report.score ?? "n/a"}/100 (${scores}) → ${options.out}`);
    }
  });

program
  .command("compare")
  .description("Say what changed between two saved reports: scores per metric, new and fixed problems (ADR-0027).")
  .argument("<previous>", "the older report (JSON)")
  .argument("<current>", "the newer report (JSON)")
  .option("-f, --format <format>", "json | agent (the new problems only, for tools)", "json")
  .option("-o, --out <file>", "write the comparison to a file instead of stdout")
  .option("--min-severity <level>", "agent format: lowest severity kept, high | medium | low (default medium)", parseSeverity)
  .option("--top <n>", "agent format: most findings kept (default 10)", parseTop)
  .action((previous: string, current: string, options: Pick<Options, "out" | "minSeverity" | "top"> & { format: string }) => {
    if (options.format !== "json" && options.format !== "agent") program.error(`Unknown format: ${options.format}`, { exitCode: 2 });
    const comparison = compareReports(readReport(previous), readReport(current));
    const output =
      options.format === "agent"
        ? agentReport(
            "xray-quality",
            comparison.current.commit,
            [...new Set(comparison.added.map((finding) => finding.metric))].map((analyzer) => ({
              analyzer,
              status: "ok" as const,
              summary: "new since the previous report",
              findings: comparison.added
                .filter((finding) => finding.metric === analyzer)
                .map(({ metric, ...finding }) => ({ analyzer: metric, ...finding })),
            })),
            { minSeverity: options.minSeverity, top: options.top },
          )
        : comparison;
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (options.out) writeReport(options.out, json);
    else process.stdout.write(json);
  });

// Exit codes (ADR-0021): 0 when the report was made, whatever it found; 1 when it failed; 2 for usage errors.
program.parseAsync().catch((error: unknown) => {
  if (error instanceof CommanderError) process.exit(error.exitCode === 0 ? 0 : 2);
  console.error(`xray-quality: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
