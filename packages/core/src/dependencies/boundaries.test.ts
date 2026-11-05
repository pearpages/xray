import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { analyzePullRequest } from "../pr.js";
import { GitFixture } from "../testing/git-fixture.js";

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

const shop = () =>
  new GitFixture()
    .write({
      "tsconfig.json": JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" }, include: ["src"] }),
      "src/features/cart/index.ts": 'export { total } from "./total";\n',
      "src/features/cart/total.ts": "export const total = (n: number[]) => n.length;\n",
      "src/features/user/index.ts": 'export { name } from "./name";\n',
      "src/features/user/name.ts": "export const name = 'ana';\n",
      // An old deep import, outside the PR: not reported.
      "src/features/user/old.ts": 'import { total } from "../cart/total";\nexport const old = total([]);\n',
    })
    .commit("base");

describe("dependency boundaries in the PR report", () => {
  it("reports deep imports and cycles from changed files only", async () => {
    fixture = shop()
      .branch("feature")
      .write({
        "src/features/cart/total.ts": 'import { name } from "../user/name";\n\nexport const total = (n: number[]) => n.length + name.length;\n',
      })
      .commit("feature");
    const { root } = fixture;
    const result = await analyzePullRequest({ cwd: root, base: "main", config: loadConfig(root), only: ["dependencies"] });
    expect(result.dependencies!.boundaries).toEqual([
      {
        kind: "deep",
        file: "src/features/cart/total.ts",
        line: 1,
        imports: "src/features/user/name.ts",
        message: 'imports src/features/user/name.ts, inside feature "user"; go through its public API (index.ts)',
      },
      {
        kind: "cycle",
        file: "src/features/cart/total.ts",
        imports: "src/features/user/name.ts",
        message: 'features "cart" and "user" import each other',
      },
    ]);
  });

  it("has no boundaries to check without two features", async () => {
    fixture = new GitFixture().write({ "src/a.ts": "export const a = 1;\n" }).commit("base").branch("feature").write({ "src/a.ts": "export const a = 2;\n" }).commit("f");
    const result = await analyzePullRequest({ cwd: fixture.root, base: "main", config: loadConfig(fixture.root), only: ["dependencies"] });
    expect(result.dependencies!.boundaries).toBeUndefined();
  });
});
