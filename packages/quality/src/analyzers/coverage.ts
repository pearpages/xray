import { statSync } from "node:fs";
import { join } from "node:path";
import { loadCoverage, type FileCoverage } from "@xray/core";
import { git } from "../files.js";
import { unavailable } from "../score.js";
import type { Analyzer, Finding, Severity } from "../types.js";

export interface CoverageRow {
  file: string;
  /** Instrumented lines. */
  lines: number;
  /** Lines that ran with every branch on them taken (ADR-0012). */
  covered: number;
  percent: number;
}

/** A line counts as covered when it ran and, if the report has branches, every branch on it was taken. */
export function fileCoverage(file: string, coverage: FileCoverage): CoverageRow {
  let covered = 0;
  for (const [line, hits] of coverage.lines) {
    const branch = coverage.branches.get(line);
    if (hits > 0 && (!branch || branch.taken === branch.total)) covered++;
  }
  const lines = coverage.lines.size;
  return { file, lines, covered, percent: lines === 0 ? 100 : Math.round((covered / lines) * 1000) / 10 };
}

export const coverage: Analyzer = {
  id: "coverage",
  name: "Coverage",
  phase: 2,
  async analyze({ root, config, codeFiles }) {
    const settings = config.coverage;
    const { coverage: report, files } = loadCoverage(root, settings.files);
    if (!report) {
      const where = settings.files?.join(", ") ?? "coverage/lcov.info (at the root or in a workspace package)";
      return unavailable("coverage", "Coverage", `no lcov report at ${where}; xray never runs the tests, run them with coverage first`);
    }

    const rows: CoverageRow[] = [];
    const missing: string[] = [];
    for (const file of codeFiles) {
      const entry = report.get(file);
      if (!entry) missing.push(file);
      else if (entry.lines.size > 0) rows.push(fileCoverage(file, entry));
    }
    if (rows.length === 0) return unavailable("coverage", "Coverage", `${files.join(", ")} covers none of the code files`);
    rows.sort((a, b) => a.percent - b.percent || b.lines - a.lines || a.file.localeCompare(b.file));

    const lines = rows.reduce((sum, row) => sum + row.lines, 0);
    const covered = rows.reduce((sum, row) => sum + row.covered, 0);
    const percent = Math.round((covered / lines) * 1000) / 10;

    const severityOf = (row: CoverageRow): Severity | undefined =>
      row.percent < settings.highThreshold ? "high" : row.percent < settings.fileThreshold ? "medium" : undefined;
    const findings: Finding[] = rows.flatMap((row) => {
      const severity = severityOf(row);
      return severity ? [{ file: row.file, severity, message: `${row.percent} % of ${row.lines} lines covered (${row.covered})` }] : [];
    });

    // A report older than the last commit may describe other code.
    const reportDate = Math.max(...files.map((file) => statSync(join(root, file)).mtimeMs));
    const lastCommit = Number(git(root, ["log", "-1", "--format=%ct"]) || 0) * 1000;
    const stale = reportDate < lastCommit;

    return {
      id: "coverage",
      name: "Coverage",
      score: Math.round(percent),
      summary:
        `${percent} % of ${lines} instrumented lines covered, ${findings.length} file(s) under ${settings.fileThreshold} %` +
        (missing.length ? `; ${missing.length} code file(s) not in the report` : "") +
        (stale ? "; the report is older than the last commit." : "."),
      findings,
      status: "ok",
      data: { files, percent, lines, covered, rows, missing, reportDate: new Date(reportDate).toISOString(), stale },
    };
  },
};
