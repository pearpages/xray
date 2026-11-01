import { describe, expect, it } from "vitest";
import { byRepo, evolution, filterFindings, findingRows, parseReport, tone, type QualityReport } from "./reports.js";

const report = (commit: string, generatedAt: string, score: number, name = "shop"): QualityReport => ({
  version: 1,
  repo: { path: `/repos/${name}`, name, commit: commit.padEnd(40, "0"), dirty: false },
  generatedAt,
  score,
  weights: { hotspots: 1 },
  metrics: [
    {
      id: "hotspots",
      name: "Hotspots",
      score,
      summary: "",
      status: "ok",
      findings: [
        { file: "a.ts", severity: "high", message: "hot" },
        { file: "b.ts", severity: "low", message: "warm" },
      ],
    },
  ],
});

describe("reports", () => {
  it("rejects files that aren't reports", () => {
    expect(() => parseReport("{", "x.json")).toThrow("isn't JSON");
    expect(() => parseReport('{"version":2}', "x.json")).toThrow("isn't an xray-quality report");
    expect(parseReport(JSON.stringify(report("a", "2026-01-01", 50)), "x.json").score).toBe(50);
  });

  it("groups reports by repository, oldest first, and builds the evolution", () => {
    const groups = byRepo([report("b", "2026-02-01", 70), report("a", "2026-01-01", 60), report("c", "2026-01-15", 90, "other"), report("a", "2026-01-01", 60)]);
    expect([...groups.keys()]).toEqual(["shop", "other"]);
    expect(evolution(groups.get("shop")!)).toEqual([
      { commit: "a000000", date: "2026-01-01", score: 60, metrics: { hotspots: 60 } },
      { commit: "b000000", date: "2026-02-01", score: 70, metrics: { hotspots: 70 } },
    ]);
  });

  it("filters findings by severity and metric", () => {
    const rows = findingRows(report("a", "2026-01-01", 50));
    expect(filterFindings(rows, ["high"], "all").map((row) => row.file)).toEqual(["a.ts"]);
    expect(filterFindings(rows, ["high", "low"], "architecture")).toEqual([]);
  });

  it("bands scores", () => {
    expect([tone(95), tone(60), tone(10), tone(null)]).toEqual(["success", "warning", "error", "neutral"]);
  });
});
