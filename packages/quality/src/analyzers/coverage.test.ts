import { utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../../core/src/testing/git-fixture.js";
import { loadQualityConfig } from "../config.js";
import { codeFiles } from "../files.js";
import type { AnalyzerContext } from "../types.js";
import { coverage, fileCoverage, runtimeLines, sourceLines, type CoverageRow } from "./coverage.js";

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

const context = (root: string): AnalyzerContext => {
  const config = loadQualityConfig(root);
  return { root, config, codeFiles: codeFiles(root, config.ignore) };
};

/** lcov for one file: `hits` per line from 1, `branches` as [line, taken, total]. */
const record = (file: string, hits: number[], branches: [number, number, number][] = []) =>
  [
    `SF:${file}`,
    ...hits.map((count, index) => `DA:${index + 1},${count}`),
    ...branches.flatMap(([line, taken, total]) => Array.from({ length: total }, (_, i) => `BRDA:${line},0,${i},${i < taken ? 1 : 0}`)),
    "end_of_record",
  ].join("\n");

const SOURCES = {
  "src/full.ts": "export const a = 1;\n",
  "src/half.ts": "export const b = 1;\n",
  "src/none.ts": "export const c = 1;\n",
  "src/untested.ts": "export const d = 1;\n",
  "src/full.test.ts": "",
};

describe("coverage", () => {
  it("counts a line covered only when it ran with every branch taken", () => {
    const lines = new Map([[1, 3], [2, 1], [3, 0]]);
    const branches = new Map([[2, { taken: 1, total: 2 }]]);
    expect(fileCoverage("a.ts", { lines, branches })).toEqual({ file: "a.ts", lines: 3, covered: 1, percent: 33.3 });
  });

  it("scores the share of covered lines and flags poorly covered files", async () => {
    const lcov = [
      record("src/full.ts", [1, 1, 1, 1]),
      record("src/half.ts", [1, 1, 1, 0, 0], [[3, 1, 2]]), // line 3 ran, one branch never taken
      record("src/none.ts", [0, 0]),
    ].join("\n");
    const repo = (fixture = new GitFixture()
      .write({
        "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "packages/app/package.json": JSON.stringify({ name: "app" }),
        "packages/app/coverage/lcov.info": lcov,
        "packages/app/src/full.ts": "export const a = 1;\n// a comment\n\nexport const a2 = 2;\n",
        "packages/app/src/half.ts": "export const b = 1;\n",
        "packages/app/src/none.ts": "export const c = 1;\n",
        // No test loads it: absent from its package's report, so 0 %, its lines estimated.
        "packages/app/src/untested.ts": "/* setup */\nexport const d = 1;\nexport const e = 2;\n",
        // A package without a report is unknown, not untested.
        "packages/other/package.json": JSON.stringify({ name: "other" }),
        "packages/other/src/x.ts": "export const x = 1;\n",
      })
      .commit("base"));
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(repo.root, "packages/app/coverage/lcov.info"), later, later);

    const result = await coverage.analyze(context(repo.root));
    const data = result.data as { rows: CoverageRow[]; missing: string[]; untested: number; estimateRatio: number; stale: boolean };
    // 11 instrumented lines for 4 source lines: untested.ts's 2 source lines count as 6 (rounded 5.5).
    expect(data.estimateRatio).toBe(2.75);
    expect(data.rows.map((row) => [row.file, row.lines, row.percent, row.untested ?? false])).toEqual([
      ["packages/app/src/untested.ts", 6, 0, true],
      ["packages/app/src/none.ts", 2, 0, false],
      ["packages/app/src/half.ts", 5, 40, false],
      ["packages/app/src/full.ts", 4, 100, false],
    ]);
    expect(result.score).toBe(35); // 6 of 17 lines
    expect(result.findings).toEqual([
      { file: "packages/app/src/untested.ts", severity: "high", message: "no test loads it (≈ 6 lines)" },
      { file: "packages/app/src/none.ts", severity: "high", message: "0 % of 2 lines covered (0)" },
      { file: "packages/app/src/half.ts", severity: "medium", message: "40 % of 5 lines covered (2)" },
    ]);
    expect(data.missing).toEqual(["packages/other/src/x.ts"]);
    expect(data.stale).toBe(false);
    expect(result.summary).toBe(
      "35.3 % of 17 instrumented lines covered (1 file(s) no test loads, their lines estimated), 3 file(s) under 50 %; 1 code file(s) in projects without a report.",
    );
  });

  it("counts source lines without blanks or comments", () => {
    expect(sourceLines("// head\n/* block\n still */\nconst a = 1;\n\n/** doc */\nfunction f() {\n  return a;\n}\n")).toBe(4);
  });

  it("warns when the report is older than the last commit", async () => {
    const repo = (fixture = new GitFixture().write({ ...SOURCES, "coverage/lcov.info": record("src/full.ts", [1]) }).commit("base"));
    const earlier = new Date(Date.now() - 3_600_000);
    utimesSync(join(repo.root, "coverage/lcov.info"), earlier, earlier);
    const result = await coverage.analyze(context(repo.root));
    expect(result.summary).toMatch(/the report is older than the last commit\.$/);
  });

  it("is unavailable without a report, or when it covers no code file", async () => {
    const bare = (fixture = new GitFixture().write(SOURCES).commit("base"));
    expect((await coverage.analyze(context(bare.root))).reason).toMatch(/^no lcov report at coverage\/lcov.info/);
    bare.dispose();

    const other = (fixture = new GitFixture().write({ ...SOURCES, "coverage/lcov.info": record("lib/gone.ts", [1]) }).commit("base"));
    expect((await coverage.analyze(context(other.root))).reason).toBe("coverage/lcov.info covers none of the code files");
  });

  it("reads the reports the config names; one outside a project's coverage/ folder covers the root", async () => {
    const repo = (fixture = new GitFixture()
      .write({ ...SOURCES, "reports/unit.lcov": record("src/full.ts", [1, 1]), "xray.config.json": JSON.stringify({ quality: { coverage: { files: ["reports/unit.lcov"], fileThreshold: 80 } } }) })
      .commit("base"));
    const result = await coverage.analyze(context(repo.root));
    const data = result.data as { files: string[]; untested: number };
    expect(data.files).toEqual(["reports/unit.lcov"]);
    // half.ts, none.ts and untested.ts are in no report but under its project (the root): 2 + 3 × 2 lines.
    expect(data.untested).toBe(3);
    expect(result.score).toBe(25);
  });
});

describe("runtimeLines", () => {
  it("counts what runs: no types, imports, re-exports or comments", () => {
    expect(runtimeLines("a.ts", "export interface A { x: number }\nexport type B = string;\n")).toBe(0);
    expect(runtimeLines("i.ts", 'export * from "./x";\nexport { y } from "./y";\nexport type { Z } from "./z";\n')).toBe(0);
    expect(runtimeLines("b.ts", 'import type { A } from "./a";\nimport { h } from "./h";\n// note\nexport const f = (a: A): number =>\n  h(a.x);\n')).toBe(1); // reprinted on one line
    expect(runtimeLines("c.tsx", "export function C() {\n  return <div>hi</div>;\n}\n")).toBe(3);
  });
});

describe("coverage exclusions", () => {
  it("leaves tooling out by default, and the config can change the list", async () => {
    const repo = (fixture = new GitFixture()
      .write({
        "coverage/lcov.info": record("src/a.ts", [1, 1]),
        "src/a.ts": "export const a = 1;\nexport const b = 2;\n",
        "vite.config.ts": "export default { base: './' };\n",
        "scripts/seed.ts": "console.log('seed');\n",
        "src/testing/fixture.ts": "export const f = () => 1;\n",
      })
      .commit("base"));
    const result = await coverage.analyze(context(repo.root));
    expect(result.score).toBe(100);
    expect((result.data as { untested: number }).untested).toBe(0);

    repo.write({ "xray.config.json": JSON.stringify({ quality: { coverage: { exclude: ["**/testing/**"] } } }) }).commit("config");
    const strict = await coverage.analyze(context(repo.root));
    expect(strict.findings.map((finding) => finding.file)).toEqual(["scripts/seed.ts", "vite.config.ts"]);
  });
});
