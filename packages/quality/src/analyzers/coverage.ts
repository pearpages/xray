import { readFileSync, statSync } from "node:fs";
import { join, matchesGlob, posix } from "node:path";
import { loadCoverage, type FileCoverage } from "@xray/core";
import { ts } from "ts-morph";
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
  /** A file no test loaded: absent from its project's report, its lines estimated (ADR-0018). */
  untested?: boolean;
}

/** Non-blank lines outside comments: the base for estimating a file's instrumented lines. */
export function sourceLines(text: string): number {
  let count = 0;
  let inComment = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (inComment) {
      if (line.includes("*/")) inComment = false;
      continue;
    }
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      inComment = !line.includes("*/");
      continue;
    }
    count++;
  }
  return count;
}

/** Lines of the JavaScript a file becomes: types erased, as the test runner sees it. */
export function runtimeLines(file: string, text: string): number {
  const { outputText } = ts.transpileModule(text, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, removeComments: true },
  });
  // Imports and re-exports run nothing a test could cover: a barrel or a types-only file counts 0.
  const statements = outputText
    .split("\n")
    .filter((line) => !/^\s*(import\b|export\s*(\*|\{[^}]*\})\s*(from\b|;|$))/.test(line))
    .join("\n");
  return sourceLines(statements);
}

/** The project a report describes: the folder holding its `coverage/` folder ("." at the root). */
const projectOf = (report: string) => posix.dirname(posix.dirname(report));

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
  async analyze({ root, config, codeFiles: all, scope }) {
    const settings = config.coverage;
    // Scoped: only those files are read and rated (the report drops the rest anyway).
    const codeFiles = scope ? all.filter(scope) : all;
    const { coverage: report, files } = loadCoverage(root, settings.files);
    if (!report) {
      const where = settings.files?.join(", ") ?? "coverage/lcov.info (at the root or in a workspace package)";
      return unavailable("coverage", "Coverage", `no lcov report at ${where}; xray never runs the tests, run them with coverage first`);
    }

    const rows: CoverageRow[] = [];
    const absent: string[] = [];
    for (const file of codeFiles.filter((file) => !settings.exclude.some((glob) => matchesGlob(file, glob)))) {
      const entry = report.get(file);
      if (!entry) absent.push(file);
      else if (entry.lines.size > 0) rows.push(fileCoverage(file, entry));
    }
    if (rows.length === 0 && !all.some((file) => (report.get(file)?.lines.size ?? 0) > 0)) return unavailable("coverage", "Coverage", `${files.join(", ")} covers none of the code files`);

    // A file inside a project that has a report, but absent from it, was loaded by no test: 0 %.
    // Its instrumented lines are estimated with the report's own ratio to source lines (ADR-0018).
    // A file of a project without a report is unknown, not untested: listed, not counted.
    const projects = files.map(projectOf);
    const inProject = (file: string) => projects.some((project) => project === "." || file.startsWith(`${project}/`));
    const read = (file: string) => runtimeLines(file, readFileSync(join(root, file), "utf8"));
    const measured = rows.reduce((sum, row) => sum + row.lines, 0);
    const ratio = measured / Math.max(1, rows.reduce((sum, row) => sum + read(row.file), 0));
    const missing: string[] = [];
    let untested = 0;
    for (const file of absent) {
      if (!inProject(file)) {
        missing.push(file);
        continue;
      }
      const runtime = read(file);
      // Types only (or empty): nothing to run, so nothing to cover.
      if (runtime === 0) continue;
      const lines = Math.max(1, Math.round(runtime * ratio));
      rows.push({ file, lines, covered: 0, percent: 0, untested: true });
      untested++;
    }
    rows.sort((a, b) => a.percent - b.percent || b.lines - a.lines || a.file.localeCompare(b.file));

    const lines = rows.reduce((sum, row) => sum + row.lines, 0);
    const covered = rows.reduce((sum, row) => sum + row.covered, 0);
    const percent = Math.round((covered / lines) * 1000) / 10;

    const severityOf = (row: CoverageRow): Severity | undefined =>
      row.percent < settings.highThreshold ? "high" : row.percent < settings.fileThreshold ? "medium" : undefined;
    const findings: Finding[] = rows.flatMap((row) => {
      const severity = severityOf(row);
      if (!severity) return [];
      const message = row.untested ? `no test loads it (≈ ${row.lines} lines)` : `${row.percent} % of ${row.lines} lines covered (${row.covered})`;
      return [{ file: row.file, severity, message }];
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
        `${percent} % of ${lines} instrumented lines covered` +
        (untested ? ` (${untested} file(s) no test loads, their lines estimated)` : "") +
        `, ${findings.length} file(s) under ${settings.fileThreshold} %` +
        (missing.length ? `; ${missing.length} code file(s) in projects without a report` : "") +
        (stale ? "; the report is older than the last commit." : "."),
      findings,
      status: "ok",
      data: { files, percent, lines, covered, rows, untested, missing, estimateRatio: Math.round(ratio * 100) / 100, reportDate: new Date(reportDate).toISOString(), stale },
    };
  },
};
