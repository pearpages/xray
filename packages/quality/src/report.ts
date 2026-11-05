import { readFileSync, existsSync } from "node:fs";
import { basename, join, matchesGlob, posix, resolve } from "node:path";
import { Cache } from "./cache.js";
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

export interface QualityOptions {
  /** `--files`: root-relative paths, folders or globs; findings are limited to them and scores are null. */
  files?: string[];
  /** `.xray/cache/` for repo-wide inputs; default on. */
  cache?: boolean;
}

/** `./src/a.ts` → `src/a.ts`, `src/cart/` → `src/cart`. */
export function normalizeScope(paths: string[]): string[] {
  return [...new Set(paths.map((path) => posix.normalize(path.split("\\").join("/")).replace(/^\.\//, "").replace(/\/$/, "")).filter((path) => path && path !== "."))];
}

/** A file is in scope when a pattern names it, a folder holding it, or a glob matching it. */
export function scopeMatcher(patterns: string[]): (file: string) => boolean {
  return (file) => patterns.some((pattern) => file === pattern || file.startsWith(`${pattern}/`) || matchesGlob(file, pattern));
}

/**
 * Runs the analyzers on the repository at `root` and assembles the report. Reads the repository;
 * writes only its own ignored `.xray/cache/` (ADR-0021).
 */
export async function analyzeQuality(
  root: string,
  config: QualityConfig,
  analyzers: Analyzer[] = ANALYZERS,
  options: QualityOptions = {},
): Promise<QualityReport> {
  const files = codeFiles(root, config.ignore);
  const patterns = options.files ? normalizeScope(options.files) : undefined;
  const scope = patterns ? scopeMatcher(patterns) : undefined;
  const cache = new Cache(root, options.cache ?? true);
  const metrics: MetricResult[] = [];
  for (const analyzer of analyzers) {
    const started = Date.now();
    let result: MetricResult;
    try {
      result = await analyzer.analyze({ root, config, codeFiles: files, ...(scope ? { scope } : {}), cache });
    } catch (error) {
      // One broken metric must not lose the others.
      result = unavailable(analyzer.id, analyzer.name, `it failed: ${(error as Error).message.split("\n")[0]}`);
    }
    // A slice's score would be read as the repository's.
    if (scope) result = { ...result, score: null, findings: result.findings.filter((finding) => scope(finding.file)) };
    metrics.push({ ...result, durationMs: Date.now() - started });
  }
  const weights = Object.fromEntries(analyzers.map((analyzer) => [analyzer.id, config.weights[analyzer.id] ?? 1]));
  return {
    version: 1,
    repo: repoInfo(root),
    generatedAt: new Date().toISOString(),
    score: scope ? null : globalScore(metrics, weights),
    weights,
    scoring: { codeFiles: files.length, severityPenalty: config.severityPenalty },
    metrics,
    ...(patterns ? { scope: { files: patterns } } : {}),
  };
}
