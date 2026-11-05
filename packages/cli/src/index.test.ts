import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentReport, XrayResult } from "@xray/core";
import { GitFixture } from "../../core/src/testing/git-fixture.js";

// The built CLI, as users and agents run it: build first (`npm run build`).
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let fixture: GitFixture;
let hooksDir: string;
beforeAll(() => {
  fixture = new GitFixture()
    .write({
      "package.json": JSON.stringify({ name: "shop" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler" }, include: ["src"] }),
      "src/math.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "src/cart.ts": 'import { add } from "./math";\n\nexport function total(items: number[]): number {\n  return items.reduce((sum, item) => add(sum, item), 0);\n}\n',
    })
    .commit("base")
    .branch("feature")
    .write({
      // A new required parameter: a breaking change, and an untested unit that grew.
      "src/math.ts":
        "export function add(a: number, b: number, round: boolean): number {\n  if (round) {\n    return Math.round(a + b);\n  }\n  return a + b;\n}\n",
      "src/tax.ts": "export function tax(amount: number): number {\n  return amount > 100 ? amount * 0.2 : amount * 0.1;\n}\n",
    })
    .commit("feature");
  // Logs every ts-morph module the process resolves.
  hooksDir = mkdtempSync(join(tmpdir(), "xray-hooks-"));
  writeFileSync(
    join(hooksDir, "trace.mjs"),
    `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (result.url.includes("/ts-morph/")) process.stderr.write("LOADED ts-morph\\n");
  return result;
} });
`,
  );
});
afterAll(() => {
  fixture.dispose();
  rmSync(hooksDir, { recursive: true, force: true });
});

const run = (args: string[], node: string[] = []) =>
  spawnSync(process.execPath, [...node, CLI, "main", "--cwd", fixture.root, ...args], { encoding: "utf8" });
const agent = (...args: string[]) => {
  const result = run(["-f", "agent", ...args]);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as AgentReport;
};

describe("xray --only", () => {
  it("leaves the other analyses out of the JSON", () => {
    const result = run(["-f", "json", "--only", "dependencies"]);
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout) as XrayResult;
    expect(json.dependencies).toBeDefined();
    expect(json.interactions ?? json.risk ?? json.api ?? json.bundle).toBeUndefined();
  });

  it("never loads ts-morph for dependencies alone", () => {
    const hooks = ["--import", join(hooksDir, "trace.mjs")];
    const only = run(["-f", "agent", "--only", "dependencies"], hooks);
    expect(only.status, only.stderr).toBe(0);
    expect(only.stderr).not.toContain("LOADED ts-morph");
    // The check itself works: the API analysis does load it.
    expect(run(["-f", "agent", "--only", "api"], hooks).stderr).toContain("LOADED ts-morph");
  });

  it("renders only the selected sections in Markdown", () => {
    const result = run(["--only", "api,risk"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Public API");
    expect(result.stdout).toContain("Impact and risk");
    expect(result.stdout).not.toContain("🧭 Dependencies");
    expect(result.stdout).not.toContain("🔀 Interactions");
  });
});

describe("xray --format agent", () => {
  it("maps a breaking export to a high finding and an untested unit to its light", () => {
    const report = agent("--only", "api,risk", "--min-severity", "low");
    expect(report.version).toBe(1);
    expect(report.tool).toBe("xray");
    expect(report.analyzers.map((a) => a.analyzer)).toEqual(["risk", "api"]);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ analyzer: "api", file: "src/math.ts", severity: "high", message: expect.stringContaining("export `add` changed (breaking)") }),
    );
    expect(report.findings).toContainEqual(expect.objectContaining({ analyzer: "api", file: "src/tax.ts", severity: "low" }));
    const add = report.findings.find((f) => f.analyzer === "risk" && f.file === "src/math.ts");
    expect(add).toMatchObject({ line: 1, message: expect.stringContaining("`add`") });
    expect(["high", "medium"]).toContain(add!.severity);
  });

  it("keeps medium and up by default, sorted high first", () => {
    const report = agent("--only", "api,risk");
    expect(report.findings.every((f) => f.severity !== "low")).toBe(true);
    expect(report.findings[0]!.severity).toBe("high");
  });

  it("caps the findings with --top and counts the rest", () => {
    const all = agent("--only", "api,risk", "--min-severity", "low");
    const one = agent("--only", "api,risk", "--min-severity", "low", "--top", "1");
    expect(one.findings).toEqual(all.findings.slice(0, 1));
    expect(one.truncated).toBe(all.findings.length - 1);
    expect(one.analyzers).toEqual(all.analyzers);
  });

  it("says the bundle wasn't measured without --bundle, and still exits 0", () => {
    const report = agent("--only", "bundle");
    expect(report.analyzers).toEqual([
      { analyzer: "bundle", status: "unavailable", summary: expect.stringContaining("pass --bundle"), findings: 0 },
    ]);
  });
});

describe("xray contract (ADR-0019, ADR-0021)", () => {
  it("pins the top-level keys and version of the JSON and agent outputs", () => {
    const json = JSON.parse(run(["-f", "json"]).stdout) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["api", "bundle", "changed", "config", "dependencies", "interactions", "meta", "risk", "version"]);
    expect(json.version).toBe(1);
    const report = agent() as unknown as Record<string, unknown>;
    expect(Object.keys(report).sort()).toEqual(["analyzers", "commit", "findings", "tool", "truncated", "version"]);
  });
});

describe("xray exit codes", () => {
  it("exits 2 on a usage error and 1 when the analysis can't run", () => {
    expect(run(["--only", "nope"]).status).toBe(2);
    expect(run(["-f", "agent", "--min-severity", "urgent"]).status).toBe(2);
    expect(run(["-f", "yaml"]).status).toBe(2);
    const failed = spawnSync(process.execPath, [CLI, "no-such-branch", "--cwd", fixture.root], { encoding: "utf8" });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/^xray: /);
  });
});
