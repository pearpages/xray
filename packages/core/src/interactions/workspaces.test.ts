import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { analyzePullRequest } from "../index.js";
import { GitFixture } from "../testing/git-fixture.js";
import { discoverWorkspace, parsePnpmWorkspace, workspaceResolver } from "./workspaces.js";

const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true }, include: ["src"] });

/** pnpm monorepo: the app imports the domain package by name, with no node_modules installed. */
const MONOREPO = {
  "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  # tools are not packages\nonlyBuiltDependencies:\n  - esbuild\n",
  "package.json": JSON.stringify({ name: "root", private: true }),
  "packages/domain/package.json": JSON.stringify({ name: "@shop/domain", exports: { ".": "./src/index.ts" } }),
  "packages/domain/tsconfig.json": tsconfig,
  "packages/domain/src/index.ts": 'export { total } from "./cart";\n',
  "packages/domain/src/cart.ts": "export const total = (prices: number[]) => prices.reduce((a, b) => a + b, 0);\n",
  "packages/ui/package.json": JSON.stringify({ name: "@shop/ui", main: "./dist/index.js" }),
  "packages/ui/tsconfig.json": tsconfig,
  "packages/ui/src/index.tsx": "export const Money = ({ value }: { value: number }) => <b>{value}</b>;\n",
  "packages/app/package.json": JSON.stringify({ name: "@shop/app", dependencies: { "@shop/domain": "workspace:*" } }),
  "packages/app/tsconfig.json": tsconfig,
  "packages/app/src/pages/Cart.tsx":
    'import { total } from "@shop/domain";\nimport { Money } from "@shop/ui";\n' +
    "export const Cart = () => <Money value={total([1, 2])} />;\n",
};

let fixture: GitFixture | undefined;
afterEach(() => fixture?.dispose());

describe("parsePnpmWorkspace", () => {
  it("reads the packages list and stops at the next key", () => {
    expect(parsePnpmWorkspace(MONOREPO["pnpm-workspace.yaml"])).toEqual(["packages/*"]);
    expect(parsePnpmWorkspace('packages:\n  - "apps/*"\n  - libs/core\n  - "!**/test/**"\n')).toEqual([
      "apps/*",
      "libs/core",
      "!**/test/**",
    ]);
  });
});

describe("workspaces", () => {
  it("maps package names to source, falling back to src/index for built-only packages", () => {
    fixture = new GitFixture().write(MONOREPO);
    const packages = discoverWorkspace(fixture.root)!;
    expect(packages.map((pkg) => [pkg.name, pkg.dir])).toEqual([
      ["@shop/app", "packages/app"],
      ["@shop/domain", "packages/domain"],
      ["@shop/ui", "packages/ui"],
    ]);
    const resolve = workspaceResolver(packages);
    expect(resolve("@shop/domain")).toMatch(/packages\/domain\/src\/index\.ts$/);
    expect(resolve("@shop/ui")).toMatch(/packages\/ui\/src\/index\.tsx$/);
    expect(resolve("@shop/domain/missing")).toBeUndefined();
    expect(resolve("react")).toBeUndefined();
  });

  it("follows a change in a shared package into the app that imports it", async () => {
    fixture = new GitFixture().write(MONOREPO).commit("base").branch("feature");
    fixture.write({
      "packages/domain/src/cart.ts": "export const total = (prices: number[]) => prices.reduce((a, b) => a + b, 1);\n",
    }).commit("change");

    const { interactions } = await analyzePullRequest({
      cwd: fixture.root,
      base: "main",
      config: resolveConfig(fixture.root),
    });
    expect(interactions.touched).toEqual(["packages/domain/src/cart.ts#total"]);
    expect(interactions.features.map((feature) => feature.entryPoints)).toEqual([
      ["packages/app/src/pages/Cart.tsx#Cart"],
    ]);
    expect(interactions.features[0]?.interactions.map((i) => `${i.from} -${i.kind}-> ${i.to}`)).toEqual([
      "packages/app/src/pages/Cart.tsx#Cart -calls-> packages/domain/src/cart.ts#total",
    ]);
  });
});
