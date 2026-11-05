import type { Cache } from "./cache.js";
import type { QualityConfig } from "./config.js";

export type Severity = "high" | "medium" | "low";

export interface Finding {
  /** Root-relative POSIX path; `package.json` for dependency findings. */
  file: string;
  line?: number;
  severity: Severity;
  message: string;
}

export interface MetricResult {
  id: string;
  name: string;
  /** 0–100; null when the metric couldn't run. */
  score: number | null;
  /** One sentence. */
  summary: string;
  findings: Finding[];
  status: "ok" | "unavailable";
  /** Why the metric couldn't run. */
  reason?: string;
  /** Metric-specific detail for the UI (hotspot rows, violations by feature). */
  data?: unknown;
  /** How long the metric took. */
  durationMs?: number;
}

/** What every analyzer gets: the analysed root, the resolved config and shared facts. */
export interface AnalyzerContext {
  root: string;
  config: QualityConfig;
  /** Code files under the root (tracked, not tests, stories, generated or ignored). */
  codeFiles: string[];
  /**
   * `--files`: the files whose findings are reported. An analyzer may limit its work to them;
   * the report drops other findings either way. Undefined: the whole repository.
   */
  scope?: (file: string) => boolean;
  /** Repo-wide inputs keyed by commit (`.xray/cache/`); a disabled cache always computes. */
  cache?: Cache;
}

export interface Analyzer {
  id: string;
  name: string;
  phase: 1 | 2;
  analyze(context: AnalyzerContext): Promise<MetricResult>;
}

export interface QualityReport {
  version: 1;
  repo: { path: string; name: string; commit: string; branch?: string; dirty: boolean };
  /** ISO date. */
  generatedAt: string;
  /** Weighted average of the available metrics, 0–100; null when none ran. */
  score: number | null;
  weights: Record<string, number>;
  /** What the findings formula used, so a reader can say what a finding costs (ADR-0014). */
  scoring?: { codeFiles: number; severityPenalty: Record<Severity, number> };
  metrics: MetricResult[];
  /** `--files`: findings are limited to these, and every score is null (a slice is not the repository). */
  scope?: { files: string[] };
}
