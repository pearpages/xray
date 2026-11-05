import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import type { XrayResult } from "../pr.js";
import { prAgentResults } from "./pr.js";
import { agentReport } from "./report.js";
import type { AgentFinding } from "./types.js";

const finding = (severity: AgentFinding["severity"], file: string, line?: number): AgentFinding => ({
  analyzer: "x",
  file,
  ...(line ? { line } : {}),
  severity,
  message: `${severity} ${file}`,
});

describe("agentReport", () => {
  const results = [
    { analyzer: "x", status: "ok" as const, summary: "x ran", findings: [finding("low", "a.ts"), finding("medium", "b.ts", 9), finding("medium", "b.ts", 2)] },
    { analyzer: "y", status: "unavailable" as const, summary: "y couldn't run", findings: [] },
    { analyzer: "z", status: "ok" as const, summary: "z ran", findings: [finding("high", "z.ts")] },
  ];

  it("keeps medium and up by default, high first, then by file and line", () => {
    const report = agentReport("xray", "abc", results);
    expect(report.findings.map((f) => `${f.severity} ${f.file}:${f.line ?? ""}`)).toEqual(["high z.ts:", "medium b.ts:2", "medium b.ts:9"]);
    expect(report.truncated).toBe(0);
  });

  it("summarises every analyzer with its findings before the filters", () => {
    expect(agentReport("xray", "abc", results, { minSeverity: "high", top: 0 }).analyzers).toEqual([
      { analyzer: "x", status: "ok", summary: "x ran", findings: 3 },
      { analyzer: "y", status: "unavailable", summary: "y couldn't run", findings: 0 },
      { analyzer: "z", status: "ok", summary: "z ran", findings: 1 },
    ]);
  });

  it("counts what --top cut, not what --min-severity dropped", () => {
    const report = agentReport("xray", "abc", results, { minSeverity: "low", top: 2 });
    expect(report.findings).toHaveLength(2);
    expect(report.truncated).toBe(2);
  });
});

describe("prAgentResults", () => {
  const base = (): XrayResult => ({ version: 1, meta: { base: "main", mergeBase: "m", head: "h" }, changed: [], config: resolveConfig("/nonexistent") });

  it("maps boundary violations: cycles high, deep imports medium", () => {
    const result = base();
    result.dependencies = {
      level: "file",
      nodes: [{ id: "src/a/x.ts", kind: "source", change: "modified" }],
      edges: [],
      outsideGraph: [],
      omittedNodes: 0,
      warnings: [],
      boundaries: [
        { kind: "deep", file: "src/a/x.ts", line: 3, imports: "src/b/internal.ts", message: "deep" },
        { kind: "cycle", file: "src/a/x.ts", imports: "src/b/index.ts", message: "cycle" },
      ],
    };
    const [dependencies] = prAgentResults(result);
    expect(dependencies!.findings.map((f) => [f.severity, f.line])).toEqual([["medium", 3], ["high", undefined]]);
    expect(dependencies!.summary).toContain("2 boundary violation(s)");
  });

  it("maps risk lights and skips green units", () => {
    const result = base();
    const unit = (name: string, light: "green" | "yellow" | "red") => ({
      id: `src/a.ts#${name}`, file: "src/a.ts", line: 4, name, change: "modified" as const, light,
      evidence: { kind: "none" as const }, complexity: { before: 2, after: 5 },
    });
    result.risk = { light: "red", units: [unit("a", "red"), unit("b", "yellow"), unit("c", "green")], features: [], untestedFeatures: [], growing: [], coverageFiles: [] };
    const [risk] = prAgentResults(result);
    expect(risk!.findings.map((f) => f.severity)).toEqual(["high", "medium"]);
    expect(risk!.findings[0]!.message).toBe("`a` (modified) is red: no test reaches it, complexity 2 → 5");
  });

  it("maps an invalid feature map and unmapped units in interactions", () => {
    const result = base();
    result.interactions = { featureMap: "invalid", units: {}, features: [], unmapped: ["src/a.ts#a"], deleted: [], touched: ["src/a.ts#a"], warnings: [] };
    const [interactions] = prAgentResults(result);
    expect(interactions!.findings.map((f) => [f.severity, f.file])).toEqual([["medium", "xray.features.json"], ["low", "src/a.ts"]]);
  });

  it("maps bundle growth, dependency changes and a failed build", () => {
    const result = base();
    result.bundle = {
      status: "measured", light: "red", before: { raw: 0, gzip: 1000, brotli: 0 }, after: { raw: 0, gzip: 4072, brotli: 0 },
      chunks: [{ key: "index.js", before: { raw: 0, gzip: 1000, brotli: 0 }, after: { raw: 0, gzip: 4072, brotli: 0 } }],
      packages: [], sourceMaps: false,
      dependencyChanges: [{ file: "package.json", name: "lodash", after: "4.17.21" }, { file: "package.json", name: "left-pad", before: "1.0.0" }],
    };
    const [bundle] = prAgentResults(result);
    expect(bundle!.findings).toEqual([
      { analyzer: "bundle", file: "package.json", severity: "high", message: "bundle grew +3.0 kB gzip (index.js +3.0 kB)" },
      { analyzer: "bundle", file: "package.json", severity: "low", message: "adds dependency lodash@4.17.21" },
    ]);
    result.bundle = { status: "failed", error: "vite: not found\nstack", chunks: [], packages: [], sourceMaps: false, dependencyChanges: [] };
    expect(prAgentResults(result)[0]).toMatchObject({ status: "unavailable", summary: "Not measured: the build failed: vite: not found", findings: [] });
  });
});
