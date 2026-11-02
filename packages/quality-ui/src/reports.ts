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

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const fileName = (path: string) => path.split("/").pop() ?? path;

/** One line per metric for the overview, from its data; the analyzer's own summary when there is none. */
export function shortSummary(metric: MetricResult): string {
  if (metric.status === "unavailable") return metric.reason ?? "Not measured.";
  const data = (metric.data ?? {}) as Record<string, unknown>;
  const count = (key: string) => (Array.isArray(data[key]) ? (data[key] as unknown[]).length : 0);
  switch (metric.id) {
    case "hotspots": {
      const rows = (data.rows ?? []) as { file: string }[];
      return metric.findings.length === 0
        ? "No file is both often changed and complex."
        : `${plural(metric.findings.length, "hotspot")}; the hottest is ${fileName(rows[0]?.file ?? metric.findings[0]!.file)}.`;
    }
    case "architecture":
      return `${plural(count("features"), "feature")} · ${plural(metric.findings.filter((f) => f.severity === "medium").length, "deep import")} · ${plural(count("cycles"), "cycle")}`;
    case "dependencies": {
      const outdated = Array.isArray(data.outdated) ? (data.outdated as { major: boolean }[]).filter((row) => row.major).length : 0;
      return `${plural(count("vulnerabilities"), "vulnerable package")} · ${outdated} a major behind`;
    }
    case "coverage":
      return `${data.percent} % of lines covered · ${plural(Number(data.untested ?? 0), "file")} no test loads`;
    case "duplication":
      return `${data.percent} % of the code is copied · ${plural(count("clones"), "block")}`;
    case "lint": {
      const errors = metric.findings.filter((f) => f.severity === "medium").length;
      return `${plural(errors, "error")} · ${plural(metric.findings.length - errors, "warning")}`;
    }
    default:
      return metric.summary.split(/(?<=\.)\s/)[0] ?? metric.summary;
  }
}

/** Items of one page (1-based) and the page count. */
export function pageOf<T>(items: T[], page: number, size: number): { items: T[]; page: number; count: number } {
  const count = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), count);
  return { items: items.slice((current - 1) * size, current * size), page: current, count };
}

interface HotspotFacts {
  churn: number;
  complexity: number;
  hotspot: number;
}

interface CoverageFacts {
  lines: number;
  covered: number;
  percent: number;
  untested?: boolean;
}

interface Side {
  file: string;
  start: number;
  end: number;
}

export interface FileProfile {
  file: string;
  hotspot?: HotspotFacts & { windowMonths: number };
  coverage?: CoverageFacts;
  /** Blocks of this file copied elsewhere (or within it): here, and the other copy. */
  copies: { here: Side; there: Side; lines: number; tokens: number }[];
  /** Deep imports this file makes into other features, and the ones made into it. */
  imports: { file: string; imports: string; line?: number }[];
  importedBy: { file: string; imports: string; line?: number }[];
  findings: FindingRow[];
}

/** Everything a report knows about one file, across metrics. */
export function fileProfile(report: QualityReport, file: string): FileProfile {
  const data = (id: string) => report.metrics.find((metric) => metric.id === id && metric.status === "ok")?.data as Record<string, unknown> | undefined;
  const hotspots = data("hotspots") as { rows?: ({ file: string } & HotspotFacts)[]; windowMonths?: number } | undefined;
  const hot = hotspots?.rows?.find((row) => row.file === file);
  const coverage = (data("coverage") as { rows?: ({ file: string } & CoverageFacts)[] } | undefined)?.rows?.find((row) => row.file === file);
  const clones = ((data("duplication") as { clones?: { a: Side; b: Side; lines: number; tokens: number }[] } | undefined)?.clones ?? []).flatMap((clone) => [
    ...(clone.a.file === file ? [{ here: clone.a, there: clone.b, lines: clone.lines, tokens: clone.tokens }] : []),
    ...(clone.b.file === file ? [{ here: clone.b, there: clone.a, lines: clone.lines, tokens: clone.tokens }] : []),
  ]);
  const deep = ((data("architecture") as { violations?: { imports: { file: string; imports: string; line?: number }[] }[] } | undefined)?.violations ?? []).flatMap(
    (group) => group.imports,
  );
  return {
    file,
    ...(hot && hotspots ? { hotspot: { churn: hot.churn, complexity: hot.complexity, hotspot: hot.hotspot, windowMonths: hotspots.windowMonths ?? 12 } } : {}),
    ...(coverage ? { coverage: { lines: coverage.lines, covered: coverage.covered, percent: coverage.percent, ...(coverage.untested ? { untested: true } : {}) } } : {}),
    copies: clones,
    imports: deep.filter((item) => item.file === file),
    importedBy: deep.filter((item) => item.imports === file),
    findings: findingRows(report).filter((row) => row.file === file),
  };
}
