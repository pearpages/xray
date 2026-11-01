import type { Finding, MetricResult, Severity } from "./types.js";

/**
 * The shared findings formula (ADR-0014): penalty points per 100 files of code.
 * One high finding per 100 files costs `penalty.high` points.
 */
export function findingsScore(findings: Finding[], codeFiles: number, penalty: Record<Severity, number>): number {
  const points = findings.reduce((sum, finding) => sum + penalty[finding.severity], 0);
  const size = Math.max(1, codeFiles / 100);
  return clamp(Math.round(100 - points / size));
}

export function clamp(score: number): number {
  return Math.min(100, Math.max(0, score));
}

/** Weighted average of the metrics that ran, weights renormalised over them; null when none ran. */
export function globalScore(metrics: MetricResult[], weights: Record<string, number>): number | null {
  const ran = metrics.filter((metric) => metric.score !== null);
  const total = ran.reduce((sum, metric) => sum + (weights[metric.id] ?? 1), 0);
  if (ran.length === 0 || total === 0) return null;
  return Math.round(ran.reduce((sum, metric) => sum + (weights[metric.id] ?? 1) * metric.score!, 0) / total);
}

export function unavailable(id: string, name: string, reason: string): MetricResult {
  return { id, name, score: null, summary: `Not measured: ${reason}`, findings: [], status: "unavailable", reason };
}
