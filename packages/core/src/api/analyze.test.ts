import { Project } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { analyzePullRequest, renderMarkdown } from "../index.js";
import { GitFixture } from "../testing/git-fixture.js";
import { compareExports } from "./compare.js";
import { exportsOf } from "./exports.js";

const parse = (text: string) =>
  exportsOf(new Project({ useInMemoryFileSystem: true }).createSourceFile("/a.tsx", text, { overwrite: true }));

const diff = (before: string, after: string) =>
  compareExports(parse(before), parse(after)).map((c) => [c.name, c.compatibility, c.details.join("; ") || c.change]);

describe("compareExports", () => {
  it("classifies parameter changes", () => {
    expect(diff("export const f = (a: number) => a;", "export const f = (a: number, b?: string) => a;")).toEqual([
      ["f", "compatible", "new optional parameter `b`"],
    ]);
    expect(diff("export function f(a: number) {}", "export function f(a: number, b: string) {}")).toEqual([
      ["f", "breaking", "new required parameter `b`"],
    ]);
    expect(diff("export function f(a: number, b = 1) {}", "export function f(a: number) {}")).toEqual([
      ["f", "breaking", "parameter `b` removed"],
    ]);
    expect(diff("export const f = (a: number) => a;", "export const f = (a: string) => a;")).toEqual([
      ["f", "review", "parameter `a` type `number` → `string`"],
    ]);
  });

  it("compares component props written in the same file", () => {
    const before = "interface Props { label: string; size?: number }\nexport const Tag = ({ label }: Props) => null;";
    const after = "interface Props { label: string; tone: string }\nexport const Tag = memo(({ label }: Props) => null);";
    expect(diff(before, after)).toEqual([["Tag", "breaking", "`size` removed; new required `tone`"]]);
  });

  it("treats a new required member of a plain type as something to review, not a break", () => {
    expect(diff("export type User = { id: string };", "export type User = { id: string; name: string };")).toEqual([
      ["User", "review", "new required `name`"],
    ]);
  });

  it("reports added and removed exports, including re-exports", () => {
    expect(diff('export { a } from "./a";\nexport const b = 1;', 'export { a as c } from "./a";\nexport * from "./d";')).toEqual([
      ["a", "breaking", "export removed"],
      ["b", "breaking", "export removed"],
      ["c", "compatible", "added"],
      ["* from ./d", "compatible", "added"],
    ]);
  });

  it("sees default exports and enums", () => {
    expect(diff("export default function Page(p: { id: string }) {}", "export default function Page(p: { id: number }) {}")).toEqual([
      ["default", "review", "`id` type `string` → `number`"],
    ]);
    expect(diff("export enum Tone { Soft, Loud }", "export enum Tone { Soft }")).toEqual([["Tone", "breaking", "`Loud` removed"]]);
  });
});

const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, include: ["src"] });

const MONOREPO = {
  "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
  "package.json": JSON.stringify({ name: "root", private: true }),
  "packages/domain/package.json": JSON.stringify({ name: "@shop/domain", exports: { ".": "./src/index.ts" } }),
  "packages/domain/tsconfig.json": tsconfig,
  "packages/domain/src/index.ts": 'export * from "./cart";\n',
  "packages/domain/src/cart.ts":
    "export const total = (prices: number[]) => prices.reduce((a, b) => a + b, 0);\n" +
    "export const internal = () => 1;\n",
  "packages/app/package.json": JSON.stringify({ name: "@shop/app" }),
  "packages/app/tsconfig.json": tsconfig,
  "packages/app/src/Cart.tsx": 'import { total } from "@shop/domain";\nexport const Cart = () => <b>{total([1])}</b>;\n',
  "packages/app/src/Cart.test.tsx": 'import { total } from "@shop/domain";\nexport const t = total([]);\n',
  "openapi.json": JSON.stringify({ paths: { "/cart": { get: {}, delete: {} } } }),
};

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

describe("analyzeApi", () => {
  it("marks a package's breaking change and lists who uses it through the barrel", async () => {
    const repo = (fixture = new GitFixture().write(MONOREPO).commit("base").branch("feature"));
    repo
      .write({
        "packages/domain/src/cart.ts":
          "export const total = (prices: number[], currency: string) => prices.reduce((a, b) => a + b, 0);\n",
        "openapi.json": JSON.stringify({ paths: { "/cart": { get: {}, post: {} } } }),
      })
      .commit("change");

    const { api } = await analyzePullRequest({ cwd: repo.root, base: "main", config: resolveConfig(repo.root) });
    expect(api.compatibility).toBe("breaking");
    // Removals come first among equally breaking, public changes of one file.
    expect(api.exports).toEqual([
      expect.objectContaining({ name: "internal", change: "removed", public: true, usedBy: [] }),
      expect.objectContaining({
        name: "total",
        compatibility: "breaking",
        public: true,
        usedBy: ["packages/app/src/Cart.test.tsx", "packages/app/src/Cart.tsx"],
      }),
    ]);
    expect(api.endpoints).toEqual([
      { file: "openapi.json", method: "DELETE", path: "/cart", change: "removed", compatibility: "breaking" },
      { file: "openapi.json", method: "POST", path: "/cart", change: "added", compatibility: "compatible" },
    ]);

    const markdown = renderMarkdown(await analyzePullRequest({ cwd: repo.root, base: "main" }));
    expect(markdown).toContain("## 📜 Public API");
    expect(markdown).toContain("| 🔴 | 📦 `total`");
    expect(markdown).toContain("1 file, 1 test");
  });
});
