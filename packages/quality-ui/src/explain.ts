import type { MetricResult, QualityReport, Severity } from "./reports";

/** How a score reads: 80 and up good, 50 to 79 fair, under 50 poor. */
export type Band = "good" | "fair" | "poor" | "none";

export function band(score: number | null): Band {
  if (score === null) return "none";
  return score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
}

export const BAND_LABEL: Record<Band, string> = { good: "Good", fair: "Fair", poor: "Poor", none: "Not measured" };

/** One sentence per metric: what it looks at, and why it matters. */
export const MEASURES: Record<string, string> = {
  hotspots: "Where change is risky: files that change often and are hard to change, so where a refactor pays back first.",
  architecture: "Whether features stay apart: a feature imports another only through its public API, and no two features import each other.",
  dependencies: "Known vulnerabilities in the packages you ship, and direct dependencies a major version behind.",
  coverage: "The share of your code your tests run, from the lcov report your test runner wrote. xray never runs the tests.",
  duplication: "Blocks of code copied between files, or within one, which then have to be changed in step.",
  lint: "Errors from your project's own ESLint and TypeScript, with its own configs.",
};

const DEFAULT_PENALTY: Record<Severity, number> = { high: 10, medium: 3, low: 1 };
const penalty = (report: QualityReport) => report.scoring?.severityPenalty ?? DEFAULT_PENALTY;
/** The findings formula's divisor: penalty points count per 100 files of code. */
const size = (report: QualityReport) => Math.max(1, (report.scoring?.codeFiles ?? 100) / 100);
const round1 = (value: number) => Math.round(value * 10) / 10;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const count = (metric: MetricResult, severity: Severity) => metric.findings.filter((finding) => finding.severity === severity).length;

export interface Explanation {
  paragraphs: string[];
  /** What the metric can't see. */
  caveat: string;
}

/** The (i): how a metric becomes a score, in the report's own numbers where it has them. */
export function howScored(id: string, report: QualityReport): Explanation {
  const p = penalty(report);
  const files = report.scoring ? ` (this repository has ${report.scoring.codeFiles})` : "";
  const formula = (what: string) => `Score: 100 minus ${p.high} per high, ${p.medium} per medium and ${p.low} per low ${what}, for every 100 files of code${files}.`;
  switch (id) {
    case "hotspots":
      return {
        paragraphs: [
          "A hotspot is the commits that touched a file in the window × the cyclomatic complexity of its functions, added up.",
          "Files with 2 or more commits and complexity 10 or more are graded: high from 1000, medium from 300, low from 100 (xray's defaults).",
          formula("hotspot"),
        ],
        caveat: "From git history and the code itself: it can't tell a careful refactor from churn.",
      };
    case "architecture":
      return {
        paragraphs: [
          "Features come from xray.features.json when it lists their files, otherwise from folders such as features/*.",
          "Importing another feature's internals instead of its public API is a deep import (medium); two features importing each other is a cycle (high).",
          formula("finding"),
        ],
        caveat: "It sees static imports, resolved as your tsconfig resolves them.",
      };
    case "dependencies":
      return {
        paragraphs: [
          "Your package manager's audit of the dependencies you ship: critical and high advisories are high, moderate medium, low low. Each package counts once, at its worst.",
          "Direct dependencies a major version behind are low.",
          "Score: 100 minus 15 per high, 5 per medium and 1 per low, whatever the size of the repository: one critical vulnerability matters anywhere.",
        ],
        caveat: "It needs the registry: offline it isn't measured.",
      };
    case "coverage":
      return {
        paragraphs: [
          "A line counts as covered when it ran and every branch on it was taken.",
          "A file of a project that has a report, but isn't in it, was loaded by no test: it counts as 0 %, its lines estimated from its code.",
          "Score: the percentage of instrumented lines covered. Files under 50 % are medium findings, under 20 % high.",
        ],
        caveat: "Projects without a report aren't counted: run their tests with coverage first.",
      };
    case "duplication":
      return {
        paragraphs: [
          "jscpd finds blocks of 50 tokens or more that appear twice; 200 tokens or more is medium, the rest low.",
          "Score: 100 minus 4 per percent of the code's lines that are copies, so 5 % copied is 80 and 25 % is 0.",
        ],
        caveat: "Tests aren't checked, and similar code written differently isn't found.",
      };
    case "lint":
      return {
        paragraphs: [
          "Each folder with an ESLint config is linted with your installed ESLint, and each tsconfig.json is checked with your installed tsc (or the config your typecheck script names).",
          "A file's TypeScript errors count from its nearest tsconfig. Errors are medium, warnings low.",
          formula("finding"),
        ],
        caveat: "xray installs nothing: without node_modules it isn't measured.",
      };
    default:
      return { paragraphs: [], caveat: "" };
  }
}

type Data = Record<string, unknown>;
const dataOf = (metric: MetricResult) => (metric.data ?? {}) as Data;
const list = <T,>(data: Data, key: string) => (Array.isArray(data[key]) ? (data[key] as T[]) : []);

/** The one-sentence reading of a metric, for the top of its tab. */
export function verdict(metric: MetricResult): string {
  if (metric.status === "unavailable") return `Not measured: ${metric.reason ?? "it couldn't run"}.`;
  const data = dataOf(metric);
  const high = count(metric, "high");
  const medium = count(metric, "medium");
  const low = count(metric, "low");
  switch (metric.id) {
    case "hotspots":
      if (metric.findings.length === 0) return "No file is both often changed and complex.";
      if (high > 0) return `${plural(high, "file is", "files are")} both changed very often and very complex.`;
      return `No file is both changed very often and very complex; ${plural(metric.findings.length, "file is", "files are")} worth watching: ${medium} medium, ${low} low.`;
    case "architecture": {
      const deep = medium;
      const cycles = list<unknown>(data, "cycles").length;
      if (deep + cycles === 0) return `${plural(list(data, "features").length, "feature")}, each imported only through its public API.`;
      return `${plural(list(data, "features").length, "feature")}, with ${plural(deep, "deep import")} and ${plural(cycles, "cycle")} between them.`;
    }
    case "dependencies": {
      const vulnerable = list<unknown>(data, "vulnerabilities").length;
      const majors = list<{ major: boolean }>(data, "outdated").filter((row) => row.major).length;
      if (vulnerable === 0) return `No known vulnerability in the dependencies you ship; ${majors} ${majors === 1 ? "is" : "are"} a major version behind.`;
      return `${plural(vulnerable, "vulnerable package")}, ${high} of them high or critical; ${majors} a major version behind.`;
    }
    case "coverage":
      return `${data.percent} % of lines run under a test; ${plural(Number(data.untested ?? 0), "file is", "files are")} loaded by no test.`;
    case "duplication":
      return `${data.percent} % of the code is a copy, in ${plural(list(data, "clones").length, "block")}.`;
    case "lint": {
      const runs = list<{ status: string }>(data, "runs").filter((run) => run.status === "ok").length;
      if (metric.findings.length === 0) return `No ESLint or TypeScript errors in ${plural(runs, "run")}.`;
      return `${plural(medium, "error")} and ${plural(low, "warning")} in ${plural(runs, "run")}.`;
    }
    default:
      return metric.summary;
  }
}

const clampScore = (score: number) => Math.min(100, Math.max(0, Math.round(score)));

/** What it would take to raise the score, in points. */
export function moves(metric: MetricResult, report: QualityReport): string {
  if (metric.status === "unavailable") return "";
  const p = penalty(report);
  const s = size(report);
  const high = count(metric, "high");
  const medium = count(metric, "medium");
  const low = count(metric, "low");
  const costs = () => {
    // A report made before `scoring` was recorded doesn't say how many files of code there were.
    if (!report.scoring) return `Each high costs ${p.high} points, each medium ${p.medium} and each low ${p.low}, per 100 files of code.`;
    const parts = (["high", "medium", "low"] as Severity[])
      .map((severity) => ({ severity, n: count(metric, severity) }))
      .filter((item) => item.n > 0)
      .map((item) => `the ${item.n} ${item.severity} ${round1((item.n * p[item.severity]) / s)}`);
    if (parts.length === 0) return "Nothing costs points.";
    const last = parts.pop()!;
    return `Points lost: ${parts.length ? `${parts.join(", ")} and ${last}` : last}.`;
  };
  switch (metric.id) {
    case "hotspots":
      return `${costs()} A file drops a grade when it changes less or gets simpler.`;
    case "architecture": {
      const cycles = list<unknown>(dataOf(metric), "cycles").length;
      const without = clampScore(100 - (medium * p.medium + low * p.low) / s);
      return cycles > 0 && report.scoring ? `${costs()} Breaking the ${plural(cycles, "cycle")} brings it to ${without}.` : costs();
    }
    case "dependencies": {
      if (metric.findings.length === 0) return "Nothing costs points.";
      const withoutHigh = clampScore(100 - (5 * medium + low));
      const withoutBoth = clampScore(100 - low);
      return high > 0
        ? `Fixing the ${high} high or critical brings it to ${withoutHigh}; the ${medium} moderate too, ${withoutBoth}.`
        : `Fixing the ${medium} moderate brings it to ${withoutBoth}.`;
    }
    case "coverage": {
      const lines = Number(dataOf(metric).lines ?? 0);
      return lines > 0 ? `Every ${Math.max(1, Math.round(lines / 100))} lines a test starts running add 1 point.` : "";
    }
    case "duplication":
      return "Each percent of copied code removed adds 4 points.";
    case "lint":
      return metric.findings.length ? `${costs()} Errors cost ${p.medium} each and warnings ${p.low}, per 100 files.` : "Nothing costs points.";
    default:
      return "";
  }
}

export interface Step {
  text: string;
  /** A file the step is about, to open its profile. */
  file?: string;
  /** Points the score would win. */
  gain?: number;
}

const THRESHOLDS: [Severity, number][] = [["high", 1000], ["medium", 300], ["low", 100]];
const RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

/** Up to three things to do, the most useful first. */
export function nextSteps(metric: MetricResult, report: QualityReport): Step[] {
  if (metric.status === "unavailable") return [];
  const data = dataOf(metric);
  switch (metric.id) {
    case "hotspots": {
      const rows = list<{ file: string; churn: number; complexity: number; hotspot: number }>(data, "rows")
        .filter((row) => row.churn >= 2 && row.complexity >= 10 && row.hotspot >= 100)
        .sort((a, b) => b.hotspot - a.hotspot)
        .slice(0, 3);
      return rows.map((row) => {
        const [grade, threshold] = THRESHOLDS.find(([, at]) => row.hotspot >= at)!;
        const under = Math.ceil(threshold / row.churn);
        return { file: row.file, text: `${row.churn} commits × complexity ${row.complexity} = ${row.hotspot}, ${grade}. Under complexity ${under} it drops a grade.` };
      });
    }
    case "architecture": {
      const features = list<{ id: string; name: string }>(data, "features");
      const name = (id: string) => features.find((feature) => feature.id === id)?.name ?? id;
      const cycles = list<[string, string]>(data, "cycles").map(([a, b]) => ({ text: `Break the cycle between ${name(a)} and ${name(b)}: one of them must stop importing the other.` }));
      const byFeature = new Map<string, number>();
      for (const group of list<{ from: string; imports: unknown[] }>(data, "violations")) byFeature.set(group.from, (byFeature.get(group.from) ?? 0) + group.imports.length);
      const deep = [...byFeature]
        .sort(([, a], [, b]) => b - a)
        .map(([from, n]) => ({ text: `Route ${name(from)}'s ${plural(n, "deep import")} through the other features' public APIs.` }));
      return [...cycles, ...deep].slice(0, 3);
    }
    case "dependencies":
      return list<{ package: string; severity: string; title: string }>(data, "vulnerabilities")
        .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9))
        .slice(0, 3)
        .map((row) => ({ text: `Update ${row.package} (${row.severity}): ${row.title.split("; ")[0]}.` }));
    case "coverage": {
      const lines = Number(data.lines ?? 0);
      if (!lines) return [];
      return list<{ file: string; lines: number; covered: number; untested?: boolean }>(data, "rows")
        .map((row) => ({ row, missing: row.lines - row.covered }))
        .filter((item) => item.missing > 0)
        .sort((a, b) => b.missing - a.missing)
        .slice(0, 3)
        .map(({ row, missing }) => ({
          file: row.file,
          gain: round1((missing / lines) * 100),
          text: row.untested ? `Loaded by no test: about ${missing} lines to cover.` : `${missing} of its ${row.lines} lines run under no test.`,
        }));
    }
    case "duplication":
      return list<{ tokens: number; lines: number; a: { file: string; start: number; end: number }; b: { file: string; start: number; end: number } }>(data, "clones")
        .slice(0, 3)
        .map((clone) => ({
          file: clone.a.file,
          text: `Lines ${clone.a.start}–${clone.a.end} are also in ${clone.b.file}:${clone.b.start}–${clone.b.end} (${clone.tokens} tokens): keep one copy.`,
        }));
    case "lint":
      return list<{ rule: string; count: number }>(data, "rules")
        .slice(0, 3)
        .map((rule) => ({ text: `Fix the ${plural(rule.count, "report")} of ${rule.rule.replace(/^eslint:/, "")}.` }));
    default:
      return [];
  }
}

/** The change since the report before this one of the same repository, or null without one. */
export function delta(history: QualityReport[], report: QualityReport, id?: string): number | null {
  const index = history.indexOf(report);
  const previous = index > 0 ? history[index - 1] : undefined;
  if (!previous) return null;
  const score = (item: QualityReport) => (id ? (item.metrics.find((metric) => metric.id === id)?.score ?? null) : item.score);
  const now = score(report);
  const before = score(previous);
  return now === null || before === null ? null : now - before;
}

/** How to get a metric that wasn't measured. */
export const HOW_TO_MEASURE: Record<string, string> = {
  hotspots: "It needs the repository's git history: run xray-quality on a clone, not on an export.",
  architecture: "Define features: folders such as src/features/<name>, or an xray.features.json that lists each feature's files.",
  dependencies: "It needs a lockfile (package-lock.json or pnpm-lock.yaml) and the registry: run xray-quality online.",
  coverage: "Run your tests with coverage first (Vitest: vitest run --coverage --coverage.reporter=lcov), then run xray-quality again.",
  duplication: "It needs code files: check the quality.ignore globs.",
  lint: "Install the project's dependencies (npm ci or pnpm install), so its ESLint and TypeScript are there, then run xray-quality again.",
};
