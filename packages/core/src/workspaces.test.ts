import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";
import { analyzePullRequest } from "./index.js";
import { GitFixture } from "./testing/git-fixture.js";
import { discoverWorkspace, parsePnpmWorkspace, workspaceAliases, workspaceResolver } from "./workspaces.js";

const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true }, include: ["src"] });

/** pnpm monorepo: the app imports the domain package by name, with no node_modules installed. */
const MONOREPO = {
  "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  # tools are not packages\nonlyBuiltDependencies:\n  - esbuild\n",
  "package.json": JSON.stringify({ name: "root", private: true }),
  "packages/domain/package.json": JSON.stringify({ name: "@shop/domain", exports: { ".": "./src/index.ts" } }),
  "packages/domain/tsconfig.json": tsconfig,
  "packages/domain/src/index.ts": 'export { total } from "./cart";\n',
  "packages/domain/src/cart.ts": "export const total = (prices: number[]) => prices.reduce((a, b) => a + b, 0);\n",
  "packages/ui/package.json": JSON.stringify({
    name: "@shop/ui",
    main: "./dist/index.js",
    exports: { ".": "./dist/index.js", "./theme.css": "./src/theme.css" },
  }),
  "packages/ui/src/theme.css": ":root { --gap: 4px; }\n",
  "packages/ui/tsconfig.json": tsconfig,
  "packages/ui/src/index.tsx": "export const Money = ({ value }: { value: number }) => <b>{value}</b>;\n",
  "packages/app/package.json": JSON.stringify({ name: "@shop/app", dependencies: { "@shop/domain": "workspace:*" } }),
  "packages/app/tsconfig.json": tsconfig,
  "packages/app/src/pages/Cart.tsx":
    'import { total } from "@shop/domain";\nimport { Money } from "@shop/ui";\nimport "@shop/ui/theme.css";\n' +
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
    // CSS is not TypeScript: the interactions resolver leaves it out, the aliases keep it.
    expect(resolve("@shop/ui/theme.css")).toBeUndefined();
    expect(Object.keys(workspaceAliases(packages)).sort()).toEqual([
      "@shop/domain$",
      "@shop/ui$",
      "@shop/ui/theme.css$",
    ]);
    expect(resolve("react")).toBeUndefined();
  });

  it("draws a changed app page's imports from other workspace packages", async () => {
    fixture = new GitFixture().write(MONOREPO).commit("base").branch("feature");
    fixture.write({
      "packages/app/src/pages/Cart.tsx":
        'import { total } from "@shop/domain";\nimport { Money } from "@shop/ui";\nimport "@shop/ui/theme.css";\n' +
        "export const Cart = () => <p><Money value={total([1, 2])} /></p>;\n",
    }).commit("change");

    const { dependencies } = await analyzePullRequest({
      cwd: fixture.root,
      base: "main",
      config: resolveConfig(fixture.root),
    });
    expect(dependencies.edges.map((edge) => `${edge.from} -> ${edge.to}`).sort()).toEqual([
      "packages/app/src/pages/Cart.tsx -> packages/domain/src/index.ts",
      "packages/app/src/pages/Cart.tsx -> packages/ui/src/index.tsx",
      "packages/app/src/pages/Cart.tsx -> packages/ui/src/theme.css",
    ]);
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

describe("per-package tsconfig paths", () => {
  /** bitepals' shape: every app has `@/*` pointing at itself; one extends a base that isn't installed. */
  const APPS = {
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    "package.json": JSON.stringify({ name: "root", private: true }),
    // The root only extends something CI doesn't install.
    "tsconfig.json": JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: {} }),
    "apps/web/package.json": JSON.stringify({ name: "web" }),
    "apps/web/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", paths: { "@/*": ["./*"] } } }),
    "apps/web/lib/photo.ts": "export const photo = (id: string) => `/photos/${id}`;\n",
    "apps/web/app/place/page.tsx": 'import { photo } from "@/lib/photo";\nexport default function PlacePage() {\n  return <img src={photo("a")} />;\n}\n',
    "apps/mobile/package.json": JSON.stringify({ name: "mobile" }),
    "apps/mobile/tsconfig.json": JSON.stringify({
      extends: "expo/tsconfig.base",
      compilerOptions: { jsx: "react-jsx", paths: { "@/*": ["./src/*"] } },
    }),
    // Same alias, same file name, different app.
    "apps/mobile/src/lib/photo.ts": "export const photo = (id: string) => `mobile/${id}`;\n",
    "apps/mobile/src/screens/Place.tsx": 'import { photo } from "@/lib/photo";\nexport const Place = () => <img src={photo("b")} />;\n',
  };

  it("resolves each app's @/ alias inside that app, and warns about nothing", async () => {
    const repo = (fixture = new GitFixture().write(APPS).commit("base").branch("feature"));
    repo
      .write({
        "apps/web/lib/photo.ts": "export const photo = (id: string) => `/cdn/photos/${id}`;\n",
        "apps/mobile/src/lib/photo.ts": "export const photo = (id: string) => `mobile/cdn/${id}`;\n",
      })
      .commit("change");

    const { dependencies, interactions } = await analyzePullRequest({
      cwd: repo.root,
      base: "main",
      config: resolveConfig(repo.root),
    });
    expect(dependencies.warnings).toEqual([]);
    expect(interactions.warnings).toEqual([]);
    expect(dependencies.edges.map((edge) => `${edge.from} -> ${edge.to}`).sort()).toEqual([
      "apps/mobile/src/screens/Place.tsx -> apps/mobile/src/lib/photo.ts",
      "apps/web/app/place/page.tsx -> apps/web/lib/photo.ts",
    ]);
    const callers = interactions.features.flatMap((feature) => feature.interactions.map((i) => `${i.from} -${i.kind}-> ${i.to}`));
    expect(callers.sort()).toEqual([
      "apps/mobile/src/screens/Place.tsx#Place -calls-> apps/mobile/src/lib/photo.ts#photo",
      "apps/web/app/place/page.tsx#PlacePage -calls-> apps/web/lib/photo.ts#photo",
    ]);
  });
});

describe("pathAliases", () => {
  it("turns tsconfig paths into resolver aliases, longest first", async () => {
    const { pathAliases } = await import("./dependencies/graph.js");
    const aliases = pathAliases({ paths: { "@/*": ["./src/*"], "@/assets/*": ["./assets/*"], "env": ["./env.ts"] } }, "/repo/app");
    expect(Object.entries(aliases)).toEqual([
      ["@/assets", "/repo/app/assets"],
      ["env$", "/repo/app/env.ts"],
      ["@", "/repo/app/src"],
    ]);
  });
});
