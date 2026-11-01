import { readFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { QualityConfig } from "./config.js";
import { codeFiles, git } from "./files.js";
import { ANALYZERS } from "./registry.js";
import { globalScore, unavailable } from "./score.js";
import type { Analyzer, MetricResult, QualityReport } from "./types.js";

function repoInfo(root: string): QualityReport["repo"] {
  const safe = (args: string[]) => {
    try {
      return git(root, args);
    } catch {
      return "";
    }
  };
  const manifest = join(root, "package.json");
  const name = existsSync(manifest) ? ((JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name ?? "") : "";
  const branch = safe(["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    path: resolve(root),
    name: name || basename(resolve(root)),
    commit: safe(["rev-parse", "HEAD"]) || "unknown",
    ...(branch && branch !== "HEAD" ? { branch } : {}),
    dirty: safe(["status", "--porcelain", "--", "."]) !== "",
  };
}

/** Runs every analyzer on the repository at `root` and assembles the report. Reads only. */
export async function analyzeQuality(root: string, config: QualityConfig, analyzers: Analyzer[] = ANALYZERS): Promise<QualityReport> {
  const files = codeFiles(root, config.ignore);
  const metrics: MetricResult[] = [];
  for (const analyzer of analyzers) {
    try {
      metrics.push(await analyzer.analyze({ root, config, codeFiles: files }));
    } catch (error) {
      // One broken metric must not lose the others.
      metrics.push(unavailable(analyzer.id, analyzer.name, `it failed: ${(error as Error).message.split("\n")[0]}`));
    }
  }
  const weights = Object.fromEntries(analyzers.map((analyzer) => [analyzer.id, config.weights[analyzer.id] ?? 1]));
  return {
    version: 1,
    repo: repoInfo(root),
    generatedAt: new Date().toISOString(),
    score: globalScore(metrics, weights),
    weights,
    metrics,
  };
}
