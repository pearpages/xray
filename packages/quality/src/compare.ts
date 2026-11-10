// Two quality reports in, what changed out (ADR-0027). Pure: no file, clock or git access.
import type { Finding, QualityReport, Severity } from "./types.js";

/** A score before and after; `change` is null when either side has no score. */
export interface ScoreChange {
  before: number | null;
  after: number | null;
  change: number | null;
}

/** One metric's change. Not comparable when it's missing or unavailable in either report. */
export interface MetricChange extends ScoreChange {
  id: string;
  name: string;
  comparable: boolean;
}

/** A finding, with the metric that made it. */
export interface ComparedFinding extends Finding {
  metric: string;
}

export interface QualityComparison {
  version: 1;
  previous: { commit: string; generatedAt: string };
  current: { commit: string; generatedAt: string };
  score: ScoreChange;
  /** Every metric in either report: the current report's order, then those only the previous one has. */
  metrics: MetricChange[];
  /** Problems the current report has and the previous didn't, worst first. Comparable metrics only. */
  added: ComparedFinding[];
  /** Problems the previous report had and the current doesn't, worst first. Comparable metrics only. */
  fixed: ComparedFinding[];
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * What makes two findings the same problem: the metric, the file and the message with every number
 * removed. A hotspot whose churn grew, or a lint error that moved line, is the same finding.
 * @example findingIdentity("hotspots", { file: "src/a.ts", severity: "high", message: "4 commits × complexity 30 = 120" })
 *   // → "hotspots\u0000src/a.ts\u0000# commits × complexity # = #"
 */
export function findingIdentity(metric: string, finding: Finding): string {
  return `${metric}\u0000${finding.file}\u0000${finding.message.replace(/\d+(\.\d+)?/g, "#")}`;
}

const scoreChange = (before: number | null, after: number | null): ScoreChange => ({
  before,
  after,
  change: before === null || after === null ? null : after - before,
});

/** Findings of `from` whose identity `other` doesn't have as many times. One pass over each list. */
function missingFrom(from: ComparedFinding[], other: ComparedFinding[]): ComparedFinding[] {
  const counts = new Map<string, number>();
  for (const finding of other) {
    const id = findingIdentity(finding.metric, finding);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const missing: ComparedFinding[] = [];
  for (const finding of from) {
    const id = findingIdentity(finding.metric, finding);
    const left = counts.get(id) ?? 0;
    if (left > 0) counts.set(id, left - 1);
    else missing.push(finding);
  }
  return missing.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.metric.localeCompare(b.metric) || a.file.localeCompare(b.file));
}

/**
 * What changed from `previous` to `current`: the global and per-metric scores, and the problems
 * added and fixed, matched by {@link findingIdentity}. A metric missing or unavailable in either
 * report is not comparable: its score change is null and its findings are in neither list, so a
 * metric that ran for the first time doesn't read as dozens of new problems.
 * @example compareReports(lastWeek, today).added // → the new problems, high severity first
 */
export function compareReports(previous: QualityReport, current: QualityReport): QualityComparison {
  const before = new Map(previous.metrics.map((metric) => [metric.id, metric]));
  const after = new Map(current.metrics.map((metric) => [metric.id, metric]));
  const ids = [...after.keys(), ...[...before.keys()].filter((id) => !after.has(id))];
  const metrics: MetricChange[] = [];
  const old: ComparedFinding[] = [];
  const now: ComparedFinding[] = [];
  for (const id of ids) {
    const a = before.get(id);
    const b = after.get(id);
    const comparable = a?.status === "ok" && b?.status === "ok";
    metrics.push({ id, name: (b ?? a)!.name, comparable, ...scoreChange(a?.score ?? null, b?.score ?? null), ...(comparable ? {} : { change: null }) });
    if (!comparable) continue;
    for (const finding of a.findings) old.push({ metric: id, ...finding });
    for (const finding of b.findings) now.push({ metric: id, ...finding });
  }
  return {
    version: 1,
    previous: { commit: previous.repo.commit, generatedAt: previous.generatedAt },
    current: { commit: current.repo.commit, generatedAt: current.generatedAt },
    score: scoreChange(previous.score, current.score),
    metrics,
    added: missingFrom(now, old),
    fixed: missingFrom(old, now),
  };
}
