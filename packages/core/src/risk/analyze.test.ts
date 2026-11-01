import { Project } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { analyzePullRequest, renderMarkdown } from "../index.js";
import { GitFixture } from "../testing/git-fixture.js";
import { lightFor } from "./analyze.js";
import { cyclomaticComplexity } from "./complexity.js";

const settings = { complexityHigh: 15, complexityJump: 3, indirectDepth: 3 };

describe("cyclomaticComplexity", () => {
  it("counts branches, loops, catch and short-circuits", () => {
    const source = new Project({ useInMemoryFileSystem: true }).createSourceFile(
      "/a.ts",
      `export function f(a: number[], b?: string) {
         if (a.length === 0 || !b) return 0;
         for (const x of a) { try { x > 1 ? g() : h(); } catch { return b ?? "none"; } }
         switch (b) { case "x": return 1; case "y": return 2; default: return 3; }
       }`,
    );
    // 1 + if + || + for-of + ?: + catch + ?? + 2 cases
    expect(cyclomaticComplexity(source.getFunctionOrThrow("f"))).toBe(9);
  });
});

describe("lightFor", () => {
  it.each([
    ["none", { after: 2 }, "yellow"],
    ["none", { after: 15 }, "red"],
    ["none", { before: 4, after: 7 }, "red"],
    ["none", { before: 4, after: 6 }, "yellow"],
    ["indirect", { before: 4, after: 5 }, "yellow"],
    ["indirect", { before: 4, after: 4 }, "green"],
    ["direct", { before: 20, after: 21 }, "yellow"],
    ["direct", { before: 4, after: 9 }, "green"],
    ["by-name", { after: 30 }, "green"],
  ] as const)("%s, %o → %s", (evidence, complexity, light) => {
    expect(lightFor(evidence, complexity, settings)).toBe(light);
  });
});

const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, include: ["src"] });

const APP = {
  "tsconfig.json": tsconfig,
  "src/main.tsx": 'import { Shop } from "./pages/Shop";\nexport const root = () => <Shop />;\n',
  "src/pages/Shop.tsx":
    'import { total } from "../lib/total";\nimport { discount } from "../lib/discount";\n' +
    "export const Shop = () => <p>{total([1])}{discount(1)}</p>;\n",
  "src/pages/Shop.test.tsx": 'import { Shop } from "./Shop";\nexport const t = () => <Shop />;\n',
  "src/lib/total.ts": "export const total = (prices: number[]) => prices.reduce((a, b) => a + b, 0);\n",
  "src/lib/total.test.ts": 'import { total } from "./total";\nexport const t = () => total([]);\n',
  "src/lib/discount.ts": "export const discount = (n: number) => n;\n",
  "src/lib/tax.ts": "export const tax = (n: number) => n;\n",
  "src/lib/__tests__/tax.spec.ts": "export const t = 1;\n",
};

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

describe("analyzeRisk", () => {
  it("finds direct, by-name, indirect and missing evidence, and lights each unit", async () => {
    const repo = (fixture = new GitFixture().write(APP).commit("base").branch("feature"));
    repo
      .write({
        "src/lib/total.ts": "export const total = (prices: number[]) => prices.reduce((a, b) => a + b, 1);\n",
        "src/lib/tax.ts": "export const tax = (n: number) => (n > 0 ? n : 0);\n",
        // Reached only through Shop, which has its own test; complexity grows 1 → 3.
        "src/lib/discount.ts": "export const discount = (n: number) => (n > 10 ? n * 0.9 : n > 5 ? n * 0.95 : n);\n",
        "src/lib/orphan.ts":
          "export const orphan = (n: number) => {\n  if (n > 1) return 1;\n  return 0;\n};\n",
      })
      .commit("change");

    const { risk } = await analyzePullRequest({ cwd: repo.root, base: "main", config: resolveConfig(repo.root) });
    const byName = Object.fromEntries(risk.units.map((unit) => [unit.name, unit]));

    expect(byName.total).toMatchObject({ light: "green", evidence: { kind: "direct", tests: ["src/lib/total.test.ts"] } });
    expect(byName.tax).toMatchObject({ light: "green", evidence: { kind: "by-name", tests: ["src/lib/__tests__/tax.spec.ts"] } });
    expect(byName.discount).toMatchObject({
      light: "yellow",
      evidence: { kind: "indirect", via: "src/pages/Shop.tsx#Shop", depth: 1 },
      complexity: { before: 1, after: 3 },
    });
    expect(byName.orphan).toMatchObject({ light: "yellow", change: "added", evidence: { kind: "none" } });
    expect(risk.light).toBe("yellow");
    expect(risk.growing).toEqual(["src/lib/discount.ts#discount", "src/lib/tax.ts#tax"]);
    // orphan is its own entry point and the only unit of its feature.
    expect(risk.untestedFeatures).toEqual(["src/lib/orphan.ts#orphan"]);
  });

  it("is red when an untested unit gets much more complex, and says so in the report", async () => {
    const repo = (fixture = new GitFixture().write(APP).commit("base").branch("feature"));
    repo
      .write({
        "src/lib/discount.ts":
          "export const discount = (n: number) => {\n" +
          "  if (n > 10 && n < 100) return n * 0.9;\n  if (n > 5 || n < -5) return n * 0.95;\n  return n ?? 0;\n};\n",
      })
      // A test file named after Shop.tsx would still count as evidence, even if empty.
      .remove("src/pages/Shop.test.tsx")
      .commit("change");

    const result = await analyzePullRequest({ cwd: repo.root, base: "main", config: resolveConfig(repo.root) });
    expect(result.risk.units.find((unit) => unit.name === "discount")).toMatchObject({
      light: "red",
      evidence: { kind: "none" },
      complexity: { before: 1, after: 6 },
    });
    const markdown = renderMarkdown(result);
    expect(markdown).toContain("## 🚦 Impact and risk");
    expect(markdown).toContain("**🔴 High risk**");
    expect(markdown).toContain("**Growing complexity:** `discount` 1 → 6");
  });
});
