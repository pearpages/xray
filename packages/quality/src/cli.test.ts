import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../core/src/testing/git-fixture.js";
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
