import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../core/src/testing/git-fixture.js";
import type { AgentReport } from "@xray/core";
import type { QualityReport } from "./types.js";

// The built CLI, as users run it: build first (`npm run build`).
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

let fixture: GitFixture | undefined;
let outDir: string | undefined;
afterEach(() => {
  fixture?.dispose();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
  fixture = outDir = undefined;
});

const repo = () => (fixture = new GitFixture().write({ "src/a.ts": "export const a = 1;\n" }).commit("base"));

describe("xray-quality", () => {
  it("writes the report into folders that don't exist yet and prints the scores", () => {
    const { root } = repo();
    outDir = mkdtempSync(join(tmpdir(), "xray-quality-cli-"));
    const out = join(outDir, "nested", "report.json");
    const result = run("--cwd", root, "-o", out);
    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(out, "utf8")) as QualityReport;
    expect(report.version).toBe(1);
    expect(result.stderr).toMatch(/^xray-quality: \d+\/100 \(Hotspots \d+ · Architecture n\/a · Dependencies n\/a · Coverage n\/a · Duplication \d+ · Lint and types n\/a\) → /);
    expect(result.stdout).toBe("");
  });

  it("prints the report to stdout without -o", () => {
    const { root } = repo();
    const result = run("--cwd", root);
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as QualityReport).repo.path).toBe(root);
  });

  it("fails with a message when the given config doesn't exist", () => {
    const { root } = repo();
    const result = run("--cwd", root, "-c", "missing.json");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("xray-quality: Config file not found:");
    expect(existsSync(join(root, "missing.json"))).toBe(false);
  });
});

describe("xray-quality -f graph (ADR-0023)", () => {
  it("prints the repository's import graph with repo-relative paths", () => {
    fixture = new GitFixture()
      .write({ "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n', "src/b.ts": "export const b = 1;\n" })
      .commit("base");
    // Run from another folder: paths must still be repo-relative (principle P4).
    const result = spawnSync(process.execPath, [CLI, "--cwd", fixture.root, "-f", "graph"], { encoding: "utf8", cwd: tmpdir() });
    expect(result.status).toBe(0);
    const graph = JSON.parse(result.stdout) as { version: number; tool: string; commit: string; modules: string[]; edges: { from: string; to: string }[] };
    expect(graph.version).toBe(1);
    expect(graph.tool).toBe("xray-quality");
    expect(graph.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(graph.modules).toEqual(["src/a.ts", "src/b.ts"]);
    expect(graph.edges).toEqual([{ from: "src/a.ts", to: "src/b.ts", typeOnly: false, dynamic: false }]);
  });
});

describe("xray-quality for agents (ADR-0021)", () => {
  // Two files with churn × complexity high enough to be graded.
  const busy = () => {
    const branches = (n: number) => Array.from({ length: n }, (_, i) => `  if (x === ${i}) return ${i};`).join("\n");
    fixture = new GitFixture();
    for (let commit = 0; commit < 6; commit++) {
      fixture.write({
        "src/a.ts": `export function a(x: number) {\n${branches(30 + commit)}\n  return -1;\n}\n`,
        "src/b.ts": `export function b(x: number) {\n${branches(30 + commit)}\n  return -1;\n}\n`,
      });
      fixture.commit(`c${commit}`);
    }
    return fixture;
  };
  const json = (...args: string[]) => {
    const result = run(...args);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };

  it("runs only the metrics --only names", () => {
    const { root } = busy();
    const report = json("--cwd", root, "--only", "hotspots,duplication") as unknown as QualityReport;
    expect(report.metrics.map((metric) => metric.id)).toEqual(["hotspots", "duplication"]);
  });

  it("limits findings to --files and leaves every score null", () => {
    const { root } = busy();
    const report = json("--cwd", root, "--only", "hotspots", "--files", "./src/b.ts") as unknown as QualityReport;
    expect(report.scope).toEqual({ files: ["src/b.ts"] });
    expect(report.score).toBeNull();
    expect(report.metrics[0]!.score).toBeNull();
    expect(report.metrics[0]!.findings.map((finding) => finding.file)).toEqual(["src/b.ts"]);
  });

  it("caches git churn by commit in an ignored .xray/cache, and reads it back", () => {
    const { root } = busy();
    json("--cwd", root, "--only", "hotspots");
    const dir = join(root, ".xray", "cache");
    const [file] = readdirSync(dir);
    expect(file).toMatch(/^churn-[0-9a-f]{40}-12m-\d{4}-\d{2}-\d{2}\.json$/);
    expect(readFileSync(join(root, ".xray", ".gitignore"), "utf8")).toBe("*\n");
    // The cache is what the next run reads: change it and the finding follows.
    const cached = JSON.parse(readFileSync(join(dir, file!), "utf8")) as { churn: [string, number][] };
    writeFileSync(join(dir, file!), JSON.stringify({ ...cached, churn: cached.churn.map(([path, n]) => [path, path === "src/a.ts" ? 40 : n]) }));
    const report = json("--cwd", root, "--only", "hotspots") as unknown as QualityReport;
    expect(report.repo.dirty).toBe(false);
    expect(report.metrics[0]!.findings.find((finding) => finding.file === "src/a.ts")!.message).toMatch(/^40 commits/);
    // --no-cache recomputes.
    const fresh = json("--cwd", root, "--only", "hotspots", "--no-cache") as unknown as QualityReport;
    expect(fresh.metrics[0]!.findings.find((finding) => finding.file === "src/a.ts")!.message).toMatch(/^6 commits/);
  });

  it("recomputes when the cache is corrupt", () => {
    const { root } = busy();
    json("--cwd", root, "--only", "hotspots");
    const dir = join(root, ".xray", "cache");
    writeFileSync(join(dir, readdirSync(dir)[0]!), "{not json");
    const report = json("--cwd", root, "--only", "hotspots") as unknown as QualityReport;
    expect(report.metrics[0]!.findings[0]!.message).toMatch(/^6 commits/);
  });

  it("prints the agent format: findings, summaries, filters and truncated", () => {
    const { root } = busy();
    const report = json("--cwd", root, "-f", "agent", "--only", "hotspots", "--min-severity", "low", "--top", "1") as unknown as AgentReport;
    expect(Object.keys(report).sort()).toEqual(["analyzers", "commit", "findings", "tool", "truncated", "version"]);
    expect(report).toMatchObject({ version: 1, tool: "xray-quality", truncated: 1 });
    expect(report.analyzers).toEqual([{ analyzer: "hotspots", status: "ok", summary: expect.any(String), findings: 2 }]);
    expect(report.findings).toEqual([expect.objectContaining({ analyzer: "hotspots", file: "src/a.ts" })]);
  });

  it("exits 2 on usage errors", () => {
    const { root } = repo();
    expect(run("--cwd", root, "--only", "speed").status).toBe(2);
    expect(run("--cwd", root, "-f", "yaml").status).toBe(2);
    expect(run("--cwd", root, "--top", "-1").status).toBe(2);
  });
});

describe("xray-quality compare", () => {
  const reportFile = (name: string, commit: string, findings: { file: string; severity: string; message: string }[]) => {
    outDir ??= mkdtempSync(join(tmpdir(), "xray-quality-compare-"));
    const file = join(outDir, name);
    const metric = { id: "hotspots", name: "Hotspots", score: 60, summary: "", findings, status: "ok" };
    writeFileSync(file, JSON.stringify({ version: 1, repo: { path: "/r", name: "r", commit, dirty: false }, generatedAt: "2026-11-10T00:00:00.000Z", score: 60, weights: {}, metrics: [metric] }));
    return file;
  };

  it("prints what changed between two reports as JSON", () => {
    const old = reportFile("old.json", "a", [{ file: "src/a.ts", severity: "high", message: "4 commits" }]);
    const now = reportFile("new.json", "b", [{ file: "src/a.ts", severity: "high", message: "9 commits" }, { file: "src/b.ts", severity: "high", message: "2 commits" }]);
    const result = run("compare", old, now);
    expect(result.status).toBe(0);
    const comparison = JSON.parse(result.stdout) as { version: number; added: { file: string }[]; fixed: unknown[] };
    expect(comparison.version).toBe(1);
    expect(comparison.added.map((finding) => finding.file)).toEqual(["src/b.ts"]);
    expect(comparison.fixed).toEqual([]);
  });

  it("prints only the new problems in the agent format", () => {
    const old = reportFile("old.json", "a", []);
    const now = reportFile("new.json", "b", [{ file: "src/b.ts", severity: "high", message: "2 commits" }]);
    const result = run("compare", old, now, "-f", "agent");
    expect(result.status).toBe(0);
    const agent = JSON.parse(result.stdout) as AgentReport;
    expect(agent.commit).toBe("b");
    expect(agent.findings.map((finding) => finding.file)).toEqual(["src/b.ts"]);
  });

  it("fails naming the file when it isn't a quality report", () => {
    const old = reportFile("old.json", "a", []);
    outDir ??= mkdtempSync(join(tmpdir(), "xray-quality-compare-"));
    const bad = join(outDir, "bad.json");
    writeFileSync(bad, JSON.stringify({ version: 2 }));
    const result = run("compare", old, bad);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`xray-quality: ${bad} is not a quality report (version 1)`);
    expect(run("compare", old, join(outDir, "missing.json")).status).toBe(1);
  });

  it("is a usage error without two reports", () => {
    expect(run("compare", "only-one.json").status).toBe(2);
  });
});

describe("xray-quality --snapshots", () => {
  it("saves each commit's report and compares the next run with the last one", () => {
    const { root } = repo();
    outDir = mkdtempSync(join(tmpdir(), "xray-quality-snapshots-"));
    const snapshots = join(outDir, "snapshots", "o-r");
    const first = run("--cwd", root, "--only", "hotspots", "--snapshots", snapshots);
    expect(first.status).toBe(0);
    // --only is a partial run: compared, not saved.
    expect(existsSync(snapshots) ? readdirSync(snapshots) : []).toEqual([]);

    const base = JSON.parse(run("--cwd", root, "--snapshots", snapshots).stdout) as QualityReport;
    expect(base.comparison).toBeUndefined();
    fixture!.write({ "src/b.ts": "export const b = 2;\n" }).commit("second");
    const second = run("--cwd", root, "--snapshots", snapshots);
    expect(second.status).toBe(0);
    const report = JSON.parse(second.stdout) as QualityReport;
    expect(report.comparison?.previous.commit).toBe(base.repo.commit);
    expect(report.comparison?.current.commit).toBe(report.repo.commit);
    expect(readdirSync(snapshots)).toHaveLength(2);
    expect(second.stderr).toContain(`xray-quality: compared with ${base.repo.commit.slice(0, 7)}`);
  });
});
