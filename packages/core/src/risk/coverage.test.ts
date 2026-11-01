import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { analyzePullRequest } from "../index.js";
import { GitFixture } from "../testing/git-fixture.js";
import { parseLcov } from "./coverage.js";

describe("parseLcov", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "xray-lcov-"));
    mkdirSync(join(root, "packages/app/src"), { recursive: true });
    writeFileSync(join(root, "packages/app/src/a.ts"), "");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("resolves relative paths from the project that made the report", () => {
    const lcov = "SF:src/a.ts\nDA:1,3\nDA:2,0\nend_of_record\n";
    const coverage = parseLcov(lcov, root, join(root, "packages/app"));
    expect([...coverage.get("packages/app/src/a.ts")!.lines]).toEqual([[1, 3], [2, 0]]);
  });

  it("reads branches: a line counts once, with how many of its branches were taken", () => {
    const lcov = "SF:src/a.ts\nDA:4,2\nBRDA:4,0,0,2\nBRDA:4,0,1,-\nBRDA:4,1,0,0\nend_of_record\n";
    const coverage = parseLcov(lcov, root, join(root, "packages/app"));
    expect(coverage.get("packages/app/src/a.ts")!.branches.get(4)).toEqual({ taken: 1, total: 3 });
  });

  it("maps absolute paths from another machine by their longest existing suffix", () => {
    const lcov = "SF:/home/runner/work/shop/shop/packages/app/src/a.ts\nDA:5,1\nend_of_record\nSF:/elsewhere/gone.ts\nDA:1,1\n";
    const coverage = parseLcov(lcov, root, root);
    expect([...coverage.keys()]).toEqual(["packages/app/src/a.ts"]);
  });
});

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

describe("coverage evidence", () => {
  it("prefers lcov over static evidence, judged on the changed lines", async () => {
    const repo = (fixture = new GitFixture()
      .write({
        "tsconfig.json": JSON.stringify({ include: ["src"] }),
        "src/price.ts": "export const price = (n: number) => {\n  if (n > 0) return n;\n  return 0;\n};\n",
        "src/price.test.ts": 'import { price } from "./price";\nexport const t = price(1);\n',
        "src/tax.ts": "export const tax = (n: number) => n;\n",
        "src/discount.ts": "export const discount = (n: number) => n;\n",
      })
      .commit("base")
      .branch("feature"));
    repo
      .write({
        "src/price.ts": "export const price = (n: number) => {\n  if (n > 0) return n;\n  if (n < -10) return -10;\n  return 0;\n};\n",
        "src/tax.ts": "export const tax = (n: number) => n * 1.21;\n",
        // The report: line 3 (the new branch) never ran; tax.ts isn't in it.
        "src/discount.ts": "export const discount = (n: number) => (n > 10 ? n * 0.9 : n);\n",
        "coverage/lcov.info":
          "SF:src/price.ts\nDA:1,1\nDA:2,1\nDA:3,0\nDA:4,0\nDA:5,0\nend_of_record\n" +
          "SF:src/discount.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,0\nend_of_record\n",
      })
      .commit("change");

    const { risk } = await analyzePullRequest({ cwd: repo.root, base: "main", config: resolveConfig(repo.root) });
    const byName = Object.fromEntries(risk.units.map((unit) => [unit.name, unit]));
    expect(risk.coverageFiles).toEqual(["coverage/lcov.info"]);
    // Static evidence would say "direct" (price.test.ts); the report says the new line never ran.
    expect(byName.price?.evidence).toEqual({ kind: "coverage", covered: 0, total: 1, scope: "changed lines", untakenBranches: 0 });
    expect(byName.price?.light).toBe("yellow");
    // A changed line that ran but left a branch untaken is not covered.
    expect(byName.discount?.evidence).toEqual({
      kind: "coverage",
      covered: 0,
      total: 1,
      scope: "changed lines",
      untakenBranches: 1,
    });
    // No coverage for tax.ts: static evidence as before.
    expect(byName.tax?.evidence.kind).toBe("none");
  });
});
