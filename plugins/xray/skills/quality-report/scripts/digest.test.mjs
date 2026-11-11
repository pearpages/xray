import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { digest, MAX_PICKS } from "./digest.mjs";

const script = fileURLToPath(new URL("./digest.mjs", import.meta.url));
let dir;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const finding = (file, severity) => ({ metric: "hotspots", file, severity, message: "4 commits × complexity 30 = 120" });
const report = (comparison) => ({
  version: 1,
  repo: { path: "/repo", name: "repo", commit: "b".repeat(40), dirty: false },
  generatedAt: "2026-11-11T00:00:00.000Z",
  score: 80,
  weights: {},
  metrics: [{ id: "hotspots", name: "Hotspots", score: 80, status: "ok", summary: "2 hotspots", findings: [finding("src/a.ts", "high")] }],
  ...(comparison ? { comparison } : {}),
});
const comparison = (added, fixed = []) => ({
  version: 1,
  previous: { commit: "a".repeat(40), generatedAt: "2026-11-10T00:00:00.000Z" },
  current: { commit: "b".repeat(40), generatedAt: "2026-11-11T00:00:00.000Z" },
  score: { before: 78, after: 80, change: 2 },
  metrics: [{ id: "hotspots", name: "Hotspots", comparable: true, before: 78, after: 80, change: 2 }],
  added,
  fixed,
});

describe("digest", () => {
  it("has no comparison for a first snapshot, and leaves the findings out of the metrics", () => {
    const result = digest(report());
    expect(result.comparison).toBeNull();
    expect(result.metrics).toEqual([{ id: "hotspots", name: "Hotspots", score: 80, status: "ok", summary: "2 hotspots" }]);
  });

  it("counts new and fixed problems per severity and keeps the worst few", () => {
    const added = [finding("src/h.ts", "high"), finding("src/m1.ts", "medium"), finding("src/m2.ts", "medium"), finding("src/l.ts", "low")];
    const result = digest(report(comparison(added, [finding("src/old.ts", "low")])), { top: 2 });
    expect(result.comparison.score).toEqual({ before: 78, after: 80, change: 2 });
    expect(result.comparison.added).toEqual({ total: 4, bySeverity: { high: 1, medium: 2, low: 1 }, worst: added.slice(0, 2) });
    expect(result.comparison.fixed.total).toBe(1);
  });

  it(`picks at most ${MAX_PICKS} new problems for issues, high severity only, worst first`, () => {
    const highs = Array.from({ length: 8 }, (_, i) => finding(`src/h${i}.ts`, "high"));
    const result = digest(report(comparison([...highs, finding("src/m.ts", "medium")])));
    expect(result.comparison.picks).toEqual(highs.slice(0, MAX_PICKS));
    expect(digest(report(comparison([finding("src/m.ts", "medium")]))).comparison.picks).toEqual([]);
  });

  it("digests 10,000 new problems in one pass (under 50 ms)", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => finding(`src/f${i}.ts`, i % 3 === 0 ? "high" : "low"));
    const started = performance.now();
    const result = digest(report(comparison(many)));
    expect(performance.now() - started).toBeLessThan(50);
    expect(result.comparison.added.worst).toHaveLength(10);
    expect(result.comparison.picks).toHaveLength(MAX_PICKS);
  });

  it("rejects what isn't a version 1 report", () => {
    expect(() => digest({ version: 2, metrics: [] })).toThrow("not a quality report");
  });
});

describe("digest.mjs", () => {
  it("prints the digest of a report file", () => {
    dir = mkdtempSync(join(tmpdir(), "digest-"));
    const file = join(dir, "report.json");
    writeFileSync(file, JSON.stringify(report(comparison([finding("src/h.ts", "high")]))));
    const printed = JSON.parse(execFileSync("node", [script, file, "--top", "3"], { encoding: "utf8" }));
    expect(printed.comparison.picks.map((pick) => pick.file)).toEqual(["src/h.ts"]);
  });

  it("fails with a reason on a file that isn't JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "digest-"));
    const file = join(dir, "report.json");
    writeFileSync(file, "{ nope");
    expect(() => execFileSync("node", [script, file], { encoding: "utf8", stdio: "pipe" })).toThrow(/can't be read as JSON/);
  });
});
