import { utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../../core/src/testing/git-fixture.js";
import { loadQualityConfig } from "../config.js";
import { codeFiles } from "../files.js";
import type { AnalyzerContext } from "../types.js";
import { coverage, fileCoverage, type CoverageRow } from "./coverage.js";

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
    const repo = (fixture = new GitFixture().write({ ...SOURCES, "coverage/lcov.info": lcov }).commit("base"));
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(repo.root, "coverage/lcov.info"), later, later);

    const result = await coverage.analyze(context(repo.root));
    expect(result.score).toBe(55); // 6 of 11 lines
    expect(result.findings).toEqual([
      { file: "src/none.ts", severity: "high", message: "0 % of 2 lines covered (0)" },
      { file: "src/half.ts", severity: "medium", message: "40 % of 5 lines covered (2)" },
    ]);
    const data = result.data as { rows: CoverageRow[]; missing: string[]; stale: boolean };
    expect(data.rows.map((row) => row.file)).toEqual(["src/none.ts", "src/half.ts", "src/full.ts"]);
    expect(data.missing).toEqual(["src/untested.ts"]);
    expect(data.stale).toBe(false);
    expect(result.summary).toBe("54.5 % of 11 instrumented lines covered, 2 file(s) under 50 %; 1 code file(s) not in the report.");
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

  it("reads the reports the config names", async () => {
    const repo = (fixture = new GitFixture()
      .write({ ...SOURCES, "reports/unit.lcov": record("src/full.ts", [1, 1]), "xray.config.json": JSON.stringify({ quality: { coverage: { files: ["reports/unit.lcov"], fileThreshold: 80 } } }) })
      .commit("base"));
    const result = await coverage.analyze(context(repo.root));
    expect(result.score).toBe(100);
    expect((result.data as { files: string[] }).files).toEqual(["reports/unit.lcov"]);
  });
});
