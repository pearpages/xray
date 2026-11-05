import type { AgentAnalyzerSummary, AgentFinding, AgentReport, AgentSeverity } from "./types.js";

export const SEVERITIES: readonly AgentSeverity[] = ["high", "medium", "low"];

const RANK: Record<AgentSeverity, number> = { high: 0, medium: 1, low: 2 };

export function isSeverity(value: string): value is AgentSeverity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/** One analyzer's contribution: its summary line and every finding it made. */
export interface AgentAnalyzerResult {
  analyzer: string;
  status: "ok" | "unavailable";
  summary: string;
  findings: AgentFinding[];
}

export interface AgentFilters {
  /** Default `medium`. */
  minSeverity?: AgentSeverity;
  /** Default 10. */
  top?: number;
}

export const DEFAULT_MIN_SEVERITY: AgentSeverity = "medium";
export const DEFAULT_TOP = 10;

/** Sorts, filters and caps the findings of every analyzer into one agent report. */
export function agentReport(
  tool: AgentReport["tool"],
  commit: string,
  results: AgentAnalyzerResult[],
  filters: AgentFilters = {},
): AgentReport {
  const min = RANK[filters.minSeverity ?? DEFAULT_MIN_SEVERITY];
  const top = filters.top ?? DEFAULT_TOP;
  const kept = results
    .flatMap((result) => result.findings)
    .filter((finding) => RANK[finding.severity] <= min)
    .sort(
      (a, b) =>
        RANK[a.severity] - RANK[b.severity] ||
        a.file.localeCompare(b.file) ||
        (a.line ?? 0) - (b.line ?? 0) ||
        a.analyzer.localeCompare(b.analyzer) ||
        a.message.localeCompare(b.message),
    );
  const analyzers: AgentAnalyzerSummary[] = results.map((result) => ({
    analyzer: result.analyzer,
    status: result.status,
    summary: result.summary,
    findings: result.findings.length,
  }));
  return { version: 1, tool, commit, analyzers, findings: kept.slice(0, top), truncated: Math.max(0, kept.length - top) };
}
