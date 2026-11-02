import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../core/src/testing/git-fixture.js";
import { architecture } from "./analyzers/architecture.js";
import { createDependencies, parseAudit, parseOutdated, worstPerPackage, type Runner } from "./analyzers/dependencies.js";
import { hotspots, type HotspotRow } from "./analyzers/hotspots.js";
import { loadQualityConfig, type QualityConfig } from "./config.js";
import { codeFiles, git } from "./files.js";
import { analyzeQuality } from "./report.js";
import { findingsScore, globalScore } from "./score.js";
import type { AnalyzerContext, MetricResult } from "./types.js";

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

const context = (root: string, config: QualityConfig = loadQualityConfig(root)): AnalyzerContext => ({
  root,
  config,
  codeFiles: codeFiles(root, config.ignore),
});

describe("scoring", () => {
  const penalty = { high: 10, medium: 3, low: 1 };
  const finding = (severity: "high" | "medium" | "low") => ({ file: "a.ts", severity, message: "" });

  it("costs penalty points per 100 files of code", () => {
    expect(findingsScore([finding("high"), finding("medium")], 50, penalty)).toBe(87);
    expect(findingsScore([finding("high"), finding("medium")], 200, penalty)).toBe(94); // 13 / 2
    expect(findingsScore(Array.from({ length: 20 }, () => finding("high")), 100, penalty)).toBe(0);
  });

  it("averages the metrics that ran, renormalising their weights", () => {
    const metric = (id: string, score: number | null) => ({ id, score }) as MetricResult;
    expect(globalScore([metric("a", 80), metric("b", 40), metric("c", null)], { a: 3, b: 1, c: 5 })).toBe(70);
    expect(globalScore([metric("a", null)], {})).toBeNull();
  });
});

describe("hotspots", () => {
  it("multiplies commits in the window by complexity, and grades the hottest files", async () => {
    const repo = (fixture = new GitFixture());
    const branchy = (n: number) =>
      `export const f = (x: number) => {\n${Array.from({ length: n }, (_, i) => `  if (x === ${i}) return ${i};`).join("\n")}\n  return -1;\n};\n`;
    repo.write({ "src/hot.ts": branchy(10), "src/cold.ts": branchy(10), "src/simple.ts": "export const g = () => 1;\n" }).commit("one");
    for (let i = 0; i < 4; i++) repo.write({ "src/hot.ts": branchy(10) + `// ${i}\n`, "src/simple.ts": `export const g = () => ${i};\n` }).commit(`edit ${i}`);

    const config = loadQualityConfig(repo.root);
    config.hotspots.thresholds = { high: 50, medium: 20, low: 5 };
    const result = await hotspots.analyze(context(repo.root, config));
    const rows = (result.data as { rows: HotspotRow[] }).rows;
    expect(rows[0]).toEqual({ file: "src/hot.ts", churn: 5, complexity: 11, hotspot: 55 });
    // simple.ts changed as often but has complexity 1: below minComplexity, not a finding.
    expect(result.findings.map((f) => [f.file, f.severity])).toEqual([["src/hot.ts", "high"]]);
    expect(result.score).toBe(90);
    // Five commits, all made today (committer date, as git prints it).
    const activity = (result.data as { activity: Record<string, number> }).activity;
    const today = git(repo.root, ["log", "-1", "--format=%cs"]);
    expect(activity).toEqual({ [today]: 5 });
  });
});

const FEATURES = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } }, include: ["src"] }),
  "src/features/cart/index.ts": 'export { total } from "./total";\n',
  "src/features/cart/total.ts": 'import { price } from "@/features/catalog/price";\nexport const total = () => price();\n',
  "src/features/catalog/index.ts": 'export { price } from "./price";\n',
  "src/features/catalog/price.ts": 'import { total } from "../cart";\nimport { log } from "../_shared/log";\nexport const price = () => (log(), 1);\nexport const t = total;\n',
  "src/features/_shared/log.ts": "export const log = () => undefined;\n",
};

describe("architecture", () => {
  it("flags deep imports between features and cycles, and lets anyone use shared folders", async () => {
    const repo = (fixture = new GitFixture().write(FEATURES).commit("base"));
    const result = await architecture.analyze(context(repo.root));
    expect(result.status).toBe("ok");
    expect(result.findings.map((f) => [f.severity, f.file, f.line])).toEqual([
      ["medium", "src/features/cart/total.ts", 1],
      ["high", expect.any(String), undefined],
    ]);
    expect(result.findings[0]!.message).toContain('inside feature "catalog"');
    expect(result.data).toMatchObject({
      source: "folders",
      violations: [{ from: "src/features/cart", to: "src/features/catalog" }],
      cycles: [["src/features/cart", "src/features/catalog"]],
    });
  });

  it("uses xray.features.json features that declare files", async () => {
    const repo = (fixture = new GitFixture()
      .write({
        ...FEATURES,
        "xray.features.json": JSON.stringify({
          version: 1,
          features: [
            { id: "buy", name: "Buying", entryPoints: ["src/features/cart/index.ts#total"], files: ["src/features/cart/**"] },
            { id: "browse", name: "Browsing", entryPoints: [], files: ["src/features/catalog/**"] },
          ],
        }),
      })
      .commit("base"));
    const result = await architecture.analyze(context(repo.root));
    expect(result.data).toMatchObject({ source: "feature map", violations: [{ from: "buy", to: "browse" }] });
  });

  it("is unavailable without features", async () => {
    const repo = (fixture = new GitFixture().write({ "src/a.ts": "export const a = 1;\n" }).commit("base"));
    expect((await architecture.analyze(context(repo.root))).status).toBe("unavailable");
  });
});

describe("dependencies", () => {
  const NPM_AUDIT = JSON.stringify({
    vulnerabilities: {
      lodash: { severity: "high", via: [{ title: "Prototype pollution" }] },
      minimist: { severity: "moderate", via: ["lodash"] },
    },
  });
  const PNPM_AUDIT = JSON.stringify({
    advisories: {
      1: { module_name: "semver", severity: "moderate", title: "ReDoS" },
      2: { module_name: "semver", severity: "critical", title: "RCE" },
    },
  });
  const NPM_OUTDATED = JSON.stringify({ react: { current: "18.3.1", wanted: "18.3.1", latest: "19.1.0" }, zod: { current: "3.23.0", latest: "3.24.0" } });

  it("reads npm and pnpm audit output, one entry per package at its worst", () => {
    expect(parseAudit(NPM_AUDIT)).toEqual([
      { package: "lodash", severity: "high", title: "Prototype pollution" },
      { package: "minimist", severity: "moderate", title: "via lodash" },
    ]);
    expect(worstPerPackage(parseAudit(PNPM_AUDIT))).toEqual([{ package: "semver", severity: "critical", title: "ReDoS; RCE" }]);
    expect(parseOutdated(NPM_OUTDATED)).toEqual([
      { package: "react", current: "18.3.1", latest: "19.1.0", major: true },
      { package: "zod", current: "3.23.0", latest: "3.24.0", major: false },
    ]);
    expect(parseAudit("not json")).toBeUndefined();
  });

  const npmRepo = () =>
    (fixture = new GitFixture().write({ "package.json": "{}", "package-lock.json": "{}", "src/a.ts": "" }).commit("base"));

  it("scores production vulnerabilities and major versions behind", async () => {
    const repo = npmRepo();
    const calls: string[][] = [];
    const runner: Runner = (command, args) => {
      calls.push([command, ...args]);
      return { status: 1, stdout: args[0] === "audit" ? NPM_AUDIT : NPM_OUTDATED, stderr: "" };
    };
    const result = await createDependencies(runner).analyze(context(repo.root));
    expect(calls).toEqual([
      ["npm", "audit", "--json", "--omit=dev"],
      ["npm", "outdated", "--json"],
    ]);
    // high 15 + moderate 5 + one major behind 1
    expect(result.score).toBe(79);
    expect(result.findings.map((f) => f.severity)).toEqual(["high", "medium", "low"]);
  });

  it("is unavailable offline, or without a lockfile, instead of failing", async () => {
    const repo = npmRepo();
    const offline: Runner = () => ({ status: 1, stdout: "", stderr: "npm ERR! code ENOTFOUND\nnpm ERR! getaddrinfo ENOTFOUND registry.npmjs.org" });
    const result = await createDependencies(offline).analyze(context(repo.root));
    expect(result).toMatchObject({ status: "unavailable", score: null });
    expect(result.reason).toContain("registry can't be reached");

    fixture!.dispose();
    const bare = (fixture = new GitFixture().write({ "package.json": "{}", "src/a.ts": "" }).commit("base"));
    expect((await createDependencies(offline).analyze(context(bare.root))).reason).toContain("package-lock.json");
  });
});

describe("analyzeQuality", () => {
  it("reports the commit, every metric and a global score, and never changes the repo", async () => {
    const repo = (fixture = new GitFixture().write(FEATURES).commit("base"));
    const report = await analyzeQuality(repo.root, loadQualityConfig(repo.root));
    expect(report).toMatchObject({ version: 1, repo: { dirty: false }, weights: { hotspots: 1, architecture: 1, dependencies: 1, coverage: 1, duplication: 1, lint: 1 } });
    expect(report.repo.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.scoring).toEqual({ codeFiles: report.scoring!.codeFiles, severityPenalty: { high: 10, medium: 3, low: 1 } });
    expect(report.scoring!.codeFiles).toBeGreaterThan(0);
    expect(report.metrics.map((metric) => [metric.id, metric.status])).toEqual([
      ["hotspots", "ok"],
      ["architecture", "ok"],
      ["dependencies", "unavailable"],
      ["coverage", "unavailable"],
      ["duplication", "ok"],
      ["lint", "unavailable"],
    ]);
    const ran = report.metrics.filter((metric) => metric.score !== null);
    expect(report.score).toBe(Math.round(ran.reduce((sum, metric) => sum + metric.score!, 0) / ran.length));
    const { execFileSync } = await import("node:child_process");
    expect(execFileSync("git", ["status", "--porcelain", "--ignored"], { cwd: repo.root, encoding: "utf8" })).toBe("");
  });

  it("reads weights and thresholds from the quality section of xray.config.json", () => {
    const repo = (fixture = new GitFixture()
      .write({ "xray.config.json": JSON.stringify({ roots: ["lib"], quality: { weights: { hotspots: 3 }, hotspots: { windowMonths: 6 } } }) })
      .commit("base"));
    const config = loadQualityConfig(repo.root);
    expect(config.weights).toEqual({ hotspots: 3 });
    expect(config.hotspots).toMatchObject({ windowMonths: 6, minChurn: 2 });
    expect(config.xray.roots).toEqual(["lib"]);
  });
});
