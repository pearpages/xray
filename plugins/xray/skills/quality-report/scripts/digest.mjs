#!/usr/bin/env node
// digest.mjs: the part of an xray-quality report the quality-report skill needs, short enough to
// read in full. A report can hold 10,000 findings; the digest holds the scores, how many problems
// are new and fixed, the worst few of each, and the issue picks (ADR-0027).
//
// Usage:
//   node digest.mjs <report.json> [--top N]
//
// Prints JSON: { version: 1, repo, score, metrics, comparison }. `comparison` is null when the
// report has none (the first snapshot of a repository, or a run without --snapshots).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Most new problems that become issue proposals: the worst high-severity ones. */
export const MAX_PICKS = 5;
const SEVERITIES = ["high", "medium", "low"];

/** Count per severity, and the first `top` (the comparison lists them worst first). */
function summarise(findings, top) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) bySeverity[finding.severity] += 1;
  return { total: findings.length, bySeverity, worst: findings.slice(0, top) };
}

/**
 * The digest of a parsed report. One pass over each findings list.
 * @example digest(report).comparison.picks // → at most 5 new high-severity problems, worst first
 */
export function digest(report, { top = 10 } = {}) {
  if (report?.version !== 1 || !Array.isArray(report.metrics)) throw new Error("not a quality report (version 1)");
  const comparison = report.comparison;
  return {
    version: 1,
    repo: report.repo,
    score: report.score,
    metrics: report.metrics.map(({ id, name, score, status, summary }) => ({ id, name, score, status, summary })),
    comparison: comparison
      ? {
          previous: comparison.previous,
          score: comparison.score,
          metrics: comparison.metrics,
          added: summarise(comparison.added, top),
          fixed: summarise(comparison.fixed, top),
          picks: comparison.added.filter((finding) => finding.severity === "high").slice(0, MAX_PICKS),
        }
      : null,
  };
}

function main(argv) {
  const [file, ...rest] = argv;
  if (!file) {
    console.error("usage: node digest.mjs <report.json> [--top N]");
    process.exit(2);
  }
  const at = rest.indexOf("--top");
  const top = at >= 0 ? Number(rest[at + 1]) : 10;
  if (!Number.isInteger(top) || top < 0) {
    console.error("digest: --top takes a whole number");
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`digest: ${file} can't be read as JSON: ${error.message}`);
    process.exit(1);
  }
  try {
    process.stdout.write(`${JSON.stringify(digest(report, { top }), null, 2)}\n`);
  } catch (error) {
    console.error(`digest: ${file} is ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
