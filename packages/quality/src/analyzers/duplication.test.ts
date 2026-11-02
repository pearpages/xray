import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../../core/src/testing/git-fixture.js";
import { loadQualityConfig } from "../config.js";
import { codeFiles, git } from "../files.js";
import type { AnalyzerContext } from "../types.js";
import { duplication, type Clone } from "./duplication.js";

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

const context = (root: string): AnalyzerContext => {
  const config = loadQualityConfig(root);
  return { root, config, codeFiles: codeFiles(root, config.ignore) };
};

/** A function of `n` statements, about 28 tokens each. */
const body = (name: string, n: number) =>
  `export function ${name}(input: number[]): number {\n  let total = 0;\n` +
  Array.from({ length: n }, (_, i) => `  total += input[${i}] * ${i + 2} - (input[${i + 1}] ?? 0);\n`).join("") +
  "  return total;\n}\n";

const distinct = (name: string, n: number) =>
  Array.from({ length: n }, (_, i) => `export const ${name}${i} = (value: string) => value.repeat(${i}) + "${name}${i}";\n`).join("");

describe("duplication", () => {
  it("scores the share of duplicated lines and lists each copied block", async () => {
    const repo = (fixture = new GitFixture()
      .write({
        "src/a.ts": body("sum", 4),
        "src/b.ts": distinct("b", 10) + body("sum", 4).replace("sum", "total"),
        "src/c.ts": distinct("c", 200),
        "src/a.test.ts": body("sum", 4), // tests are left out
      })
      .commit("base"));
    const result = await duplication.analyze(context(repo.root));
    const data = result.data as { percent: number; lines: number; duplicatedLines: number; clones: Clone[] };

    expect(data.lines).toBe(8 + 18 + 200); // body(n) is n + 4 lines
    expect(data.clones).toHaveLength(1);
    expect(data.clones[0]!.a.file).toBe("src/a.ts");
    expect(data.clones[0]!.b.file).toBe("src/b.ts");
    expect(data.clones[0]!.tokens).toBeGreaterThanOrEqual(50);
    expect(data.duplicatedLines).toBe(2 * data.clones[0]!.lines);
    expect(result.score).toBe(Math.round(100 - 4 * data.percent));
    expect(result.findings).toEqual([
      { file: "src/a.ts", line: data.clones[0]!.a.start, severity: "low", message: expect.stringMatching(/ lines \(\d+ tokens\) also in src\/b\.ts:\d+$/) },
    ]);
    expect(git(repo.root, ["status", "--porcelain", "--ignored"])).toBe("");
  });

  it("grades long blocks medium and honours minTokens", async () => {
    const files = { "src/a.ts": body("sum", 30), "src/b.ts": body("sum", 30).replace("sum", "total") };
    const repo = (fixture = new GitFixture().write(files).commit("base"));
    const long = await duplication.analyze(context(repo.root));
    expect(long.findings.map((finding) => finding.severity)).toEqual(["medium"]);

    repo.write({ "xray.config.json": JSON.stringify({ quality: { duplication: { minTokens: 1000 } } }) }).commit("config");
    const strict = await duplication.analyze(context(repo.root));
    expect(strict.findings).toEqual([]);
    expect(strict.score).toBe(100);
    expect(strict.summary).toBe("No duplicated block of 1000 tokens or more in 68 lines of code.");
  });

  it("is unavailable without code", async () => {
    const repo = (fixture = new GitFixture().write({ "README.md": "# empty\n" }).commit("base"));
    expect((await duplication.analyze(context(repo.root))).status).toBe("unavailable");
  });
});
