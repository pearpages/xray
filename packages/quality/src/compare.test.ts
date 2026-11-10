import { describe, expect, it } from "vitest";
import { compareReports, findingIdentity } from "./compare.js";
import type { Finding, MetricResult, QualityReport } from "./types.js";

const metric = (id: string, score: number | null, findings: Finding[] = [], status: MetricResult["status"] = "ok"): MetricResult => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  score,
  summary: "",
  findings,
  status,
});

const report = (commit: string, score: number | null, metrics: MetricResult[]): QualityReport => ({
  version: 1,
  repo: { path: "/repo", name: "repo", commit, dirty: false },
  generatedAt: `2026-11-${commit === "a" ? "01" : "10"}T00:00:00.000Z`,
  score,
  weights: {},
  metrics,
});

const hotspot = (file: string, churn: number, severity: Finding["severity"] = "high"): Finding => ({
  file,
  severity,
  message: `${churn} commits in 12 months × complexity 30 = ${churn * 30}`,
});

describe("findingIdentity", () => {
  it("is the same problem when only its numbers or its line changed", () => {
    expect(findingIdentity("hotspots", hotspot("src/a.ts", 4))).toBe(findingIdentity("hotspots", hotspot("src/a.ts", 9)));
    const lint = (line: number): Finding => ({ file: "src/a.ts", line, severity: "high", message: "'x' is unused (no-unused-vars)" });
    expect(findingIdentity("lint", lint(3))).toBe(findingIdentity("lint", lint(40)));
  });

  it("is another problem in another file, metric or wording", () => {
    const base = findingIdentity("hotspots", hotspot("src/a.ts", 4));
    expect(findingIdentity("hotspots", hotspot("src/b.ts", 4))).not.toBe(base);
    expect(findingIdentity("duplication", hotspot("src/a.ts", 4))).not.toBe(base);
    expect(findingIdentity("hotspots", { ...hotspot("src/a.ts", 4), message: "something else" })).not.toBe(base);
  });
});

describe("compareReports", () => {
  it("says how the global score and each metric's score changed", () => {
    const comparison = compareReports(
      report("a", 70, [metric("hotspots", 60), metric("coverage", 80)]),
      report("b", 75, [metric("hotspots", 70), metric("coverage", 80)]),
    );
    expect(comparison.version).toBe(1);
    expect(comparison.previous).toEqual({ commit: "a", generatedAt: "2026-11-01T00:00:00.000Z" });
    expect(comparison.current.commit).toBe("b");
    expect(comparison.score).toEqual({ before: 70, after: 75, change: 5 });
    expect(comparison.metrics).toEqual([
      { id: "hotspots", name: "Hotspots", comparable: true, before: 60, after: 70, change: 10 },
      { id: "coverage", name: "Coverage", comparable: true, before: 80, after: 80, change: 0 },
    ]);
  });

  it("lists the problems that are new and the ones that are gone, matched by identity", () => {
    const comparison = compareReports(
      report("a", 70, [metric("hotspots", 60, [hotspot("src/old.ts", 5), hotspot("src/kept.ts", 4)])]),
      report("b", 70, [metric("hotspots", 60, [hotspot("src/kept.ts", 8), hotspot("src/new.ts", 6)])]),
    );
    expect(comparison.added).toEqual([{ metric: "hotspots", ...hotspot("src/new.ts", 6) }]);
    expect(comparison.fixed).toEqual([{ metric: "hotspots", ...hotspot("src/old.ts", 5) }]);
  });

  it("counts repeated identical problems instead of merging them", () => {
    const unused = (line: number): Finding => ({ file: "src/a.ts", line, severity: "medium", message: "'x' is unused" });
    const comparison = compareReports(
      report("a", 70, [metric("lint", 90, [unused(1)])]),
      report("b", 70, [metric("lint", 85, [unused(1), unused(9)])]),
    );
    expect(comparison.added).toHaveLength(1);
    expect(comparison.fixed).toEqual([]);
  });

  it("puts the worst new problems first", () => {
    const comparison = compareReports(
      report("a", 70, [metric("hotspots", 60), metric("lint", 90)]),
      report("b", 70, [
        metric("hotspots", 60, [hotspot("src/low.ts", 2, "low"), hotspot("src/high.ts", 9, "high")]),
        metric("lint", 90, [{ file: "src/m.ts", severity: "medium", message: "m" }]),
      ]),
    );
    expect(comparison.added.map((finding) => finding.severity)).toEqual(["high", "medium", "low"]);
  });

  it("treats a metric unavailable or missing on either side as not comparable, never as a drop to 0", () => {
    const comparison = compareReports(
      report("a", 70, [metric("coverage", null, [], "unavailable"), metric("hotspots", 60)]),
      report("b", 70, [metric("coverage", 80, [hotspot("src/a.ts", 1)]), metric("lint", 50, [hotspot("src/b.ts", 1)])]),
    );
    expect(comparison.metrics).toEqual([
      { id: "coverage", name: "Coverage", comparable: false, before: null, after: 80, change: null },
      { id: "lint", name: "Lint", comparable: false, before: null, after: 50, change: null },
      { id: "hotspots", name: "Hotspots", comparable: false, before: 60, after: null, change: null },
    ]);
    expect(comparison.added).toEqual([]);
    expect(comparison.fixed).toEqual([]);
  });

  it("has no score change when either report has no global score", () => {
    expect(compareReports(report("a", null, []), report("b", 70, [])).score).toEqual({ before: null, after: 70, change: null });
  });

  it("compares 10,000 findings a side in one pass (under 100 ms)", () => {
    const many = (offset: number) =>
      Array.from({ length: 10_000 }, (_, i) => ({ file: `src/f${i + offset}.ts`, severity: "medium" as const, message: `issue ${i}` }));
    const previous = report("a", 70, [metric("lint", 90, many(0))]);
    const current = report("b", 70, [metric("lint", 90, many(5_000))]);
    const started = performance.now();
    const comparison = compareReports(previous, current);
    expect(performance.now() - started).toBeLessThan(100);
    // Files f5000–f9999 are in both; messages differ only in numbers, so the file decides.
    expect(comparison.added).toHaveLength(5_000);
    expect(comparison.fixed).toHaveLength(5_000);
  });
});
