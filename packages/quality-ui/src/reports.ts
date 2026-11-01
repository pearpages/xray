import type { Finding, MetricResult, QualityReport, Severity } from "@xray/quality";

export type { Finding, MetricResult, QualityReport, Severity };

/** Reads a file's text as a report, or explains why it isn't one. */
export function parseReport(text: string, fileName: string): QualityReport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} isn't JSON.`);
  }
  const report = json as Partial<QualityReport>;
  if (report.version !== 1 || !report.repo || !Array.isArray(report.metrics)) {
    throw new Error(`${fileName} isn't an xray-quality report (version 1).`);
  }
  return report as QualityReport;
}

/** Reports by repository name, oldest first, without loading the same commit twice. */
export function byRepo(reports: QualityReport[]): Map<string, QualityReport[]> {
  const groups = new Map<string, QualityReport[]>();
  for (const report of reports) {
    const list = groups.get(report.repo.name) ?? [];
    if (!list.some((other) => other.repo.commit === report.repo.commit && other.generatedAt === report.generatedAt)) list.push(report);
    groups.set(report.repo.name, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  return groups;
}

export interface EvolutionPoint {
  commit: string;
  date: string;
  score: number | null;
  metrics: Record<string, number | null>;
}

export function evolution(reports: QualityReport[]): EvolutionPoint[] {
  return reports.map((report) => ({
    commit: report.repo.commit.slice(0, 7),
    date: report.generatedAt.slice(0, 10),
    score: report.score,
    metrics: Object.fromEntries(report.metrics.map((metric) => [metric.id, metric.score])),
  }));
}

export interface FindingRow extends Finding {
  id: string;
  metric: string;
  metricName: string;
}

export function findingRows(report: QualityReport): FindingRow[] {
  return report.metrics.flatMap((metric) =>
    metric.findings.map((finding, index) => ({ ...finding, id: `${metric.id}-${index}`, metric: metric.id, metricName: metric.name })),
  );
}

export function filterFindings(rows: FindingRow[], severities: Severity[], metric: string): FindingRow[] {
  return rows.filter((row) => severities.includes(row.severity) && (metric === "all" || row.metric === metric));
}

/** Score bands shared by every view. */
export function tone(score: number | null): "success" | "warning" | "error" | "neutral" {
  if (score === null) return "neutral";
  return score >= 80 ? "success" : score >= 50 ? "warning" : "error";
}
