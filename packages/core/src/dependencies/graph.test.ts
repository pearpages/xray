import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { GitFixture } from "../testing/git-fixture.js";
import { buildDependencyGraph, repoPathResolver } from "./graph.js";

describe("repoPathResolver", () => {
  let root: string;
  let link: string;

  beforeAll(() => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "xray-paths-")));
    root = join(parent, "repo");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    link = join(parent, "link");
    symlinkSync(root, link);
  });

  afterAll(() => rmSync(join(root, ".."), { recursive: true, force: true }));

  it("resolves a baseDir-relative path (a module's source)", () => {
    expect(repoPathResolver(root)("src/a.ts", false)).toBe("src/a.ts");
  });

  it("resolves a process-cwd-relative path (a dependency's resolved) when --cwd is elsewhere", () => {
    const fromCwd = relative(process.cwd(), join(root, "src/a.ts"));
    expect(fromCwd.startsWith("..")).toBe(true);
    expect(repoPathResolver(root)(fromCwd, true)).toBe("src/a.ts");
  });

  it("falls back to the other base when the preferred one has no such file", () => {
    expect(repoPathResolver(root)("src/a.ts", true)).toBe("src/a.ts");
  });

  it("gives one path through a symlinked root", () => {
    expect(repoPathResolver(link)("src/a.ts", false)).toBe("src/a.ts");
    expect(repoPathResolver(link)(join(link, "src/a.ts"), true)).toBe("src/a.ts");
  });

  it("leaves a path that exists at neither base unchanged", () => {
    expect(repoPathResolver(root)("src/missing.ts", false)).toBe("src/missing.ts");
  });
});

describe("buildDependencyGraph across workspace packages", () => {
  let fixture: GitFixture | undefined;
  afterEach(() => fixture?.dispose());

  const tsconfig = JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] });

  it("keeps a file reached by two package scopes as one node with its own edges", async () => {
    fixture = new GitFixture()
      .write({
        "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
        "packages/domain/package.json": JSON.stringify({ name: "@shop/domain", exports: { ".": "./src/index.ts" } }),
        "packages/domain/tsconfig.json": tsconfig,
        "packages/domain/src/index.ts": 'export { total } from "./cart";\n',
        "packages/domain/src/cart.ts": "export const total = (prices: number[]) => prices.length;\n",
        "packages/app/package.json": JSON.stringify({ name: "@shop/app" }),
        "packages/app/tsconfig.json": tsconfig,
        "packages/app/src/main.ts": 'import { total } from "@shop/domain";\nexport const run = () => total([1]);\n',
      })
      .commit("base");

    // The fixture is not the process cwd, as with `--cwd`.
    const graph = await buildDependencyGraph(fixture.root, resolveConfig(fixture.root));

    expect([...graph.modules].sort()).toEqual([
      "packages/app/src/main.ts",
      "packages/domain/src/cart.ts",
      "packages/domain/src/index.ts",
    ]);
    const edges = graph.edges.map((edge) => `${edge.from} -> ${edge.to}`).sort();
    expect(edges).toEqual([
      "packages/app/src/main.ts -> packages/domain/src/index.ts",
      "packages/domain/src/index.ts -> packages/domain/src/cart.ts",
    ]);
  });
});
