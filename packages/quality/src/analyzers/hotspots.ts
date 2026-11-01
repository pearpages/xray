import { join } from "node:path";
import { cyclomaticComplexity, unitsOf } from "@xray/core";
import { Project } from "ts-morph";
import { git } from "../files.js";
import { findingsScore } from "../score.js";
import type { Analyzer, Finding, Severity } from "../types.js";

export interface HotspotRow {
  file: string;
  /** Commits touching the file in the window. */
  churn: number;
  /** Sum of its units' cyclomatic complexity. */
  complexity: number;
  hotspot: number;
}

/** Commits per file since `months` ago, paths relative to the root. */
export function churnSince(root: string, months: number): Map<string, number> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const log = git(root, ["log", `--since=${since.toISOString()}`, "--no-merges", "--name-only", "--relative", "--format=%x00"]);
  const churn = new Map<string, number>();
  for (const commit of log.split("\0")) {
    for (const file of new Set(commit.split("\n").filter(Boolean))) churn.set(file, (churn.get(file) ?? 0) + 1);
  }
  return churn;
}

export const hotspots: Analyzer = {
  id: "hotspots",
  name: "Hotspots",
  phase: 1,
  async analyze({ root, config, codeFiles }) {
    const settings = config.hotspots;
    const churn = churnSince(root, settings.windowMonths);
    // Parsed one file at a time, without types: complexity needs only the syntax.
    const project = new Project({ compilerOptions: { allowJs: true } });
    const rows: HotspotRow[] = [];
    for (const file of codeFiles) {
      const commits = churn.get(file) ?? 0;
      if (commits === 0) continue;
      const source = project.addSourceFileAtPath(join(root, file));
      const complexity = unitsOf(source, file)
        .filter((unit) => unit.kind === "code")
        .reduce((sum, unit) => sum + cyclomaticComplexity(unit.node), 0);
      project.removeSourceFile(source);
      rows.push({ file, churn: commits, complexity, hotspot: commits * complexity });
    }
    rows.sort((a, b) => b.hotspot - a.hotspot || a.file.localeCompare(b.file));

    const severityOf = (row: HotspotRow): Severity | undefined => {
      if (row.churn < settings.minChurn || row.complexity < settings.minComplexity) return undefined;
      const { high, medium, low } = settings.thresholds;
      return row.hotspot >= high ? "high" : row.hotspot >= medium ? "medium" : row.hotspot >= low ? "low" : undefined;
    };
    const findings: Finding[] = rows.flatMap((row) => {
      const severity = severityOf(row);
      return severity
        ? [{ file: row.file, severity, message: `${row.churn} commits in ${settings.windowMonths} months × complexity ${row.complexity} = ${row.hotspot}` }]
        : [];
    });
    const top = findings[0];
    return {
      id: "hotspots",
      name: "Hotspots",
      score: findingsScore(findings, codeFiles.length, config.severityPenalty),
      summary:
        findings.length === 0
          ? `No file is both often changed and complex (${rows.length} files changed in ${settings.windowMonths} months).`
          : `${findings.length} hotspot file(s); the hottest is ${top!.file} (${rows[0]!.hotspot}).`,
      findings,
      status: "ok",
      data: { rows: rows.filter((row) => row.complexity > 0), windowMonths: settings.windowMonths },
    };
  },
};
