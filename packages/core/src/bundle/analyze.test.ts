import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { analyzePullRequest, renderMarkdown } from "../index.js";
import { GitFixture } from "../testing/git-fixture.js";
import { summarizeFailure } from "./build.js";
import { chunkKey } from "./measure.js";

describe("chunkKey", () => {
  it("drops content hashes so builds can be matched", () => {
    expect(chunkKey("assets/index-BqX3k2aL.js")).toBe("assets/index.js");
    expect(chunkKey("static/js/main.3f2a9c1b.chunk.js")).toBe("static/js/main.chunk.js");
    expect(chunkKey("assets/style-a1B2c3D4.css")).toBe("assets/style.css");
    expect(chunkKey("app.js")).toBe("app.js");
  });
});

describe("summarizeFailure", () => {
  it("keeps the error lines and drops colours and stack frames", () => {
    const output = "\u001b[36mvite v7\u001b[39m\nerror: Rollup failed to resolve import \"@/x\"\n    at onLog (file:///a.js:1:1)\ntransforming...";
    expect(summarizeFailure(output)).toBe('error: Rollup failed to resolve import "@/x"\nvite v7\ntransforming...');
  });
});

/** A "build" with no dependencies: writes every src file into one hashed chunk. */
const BUILD = `
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const code = readdirSync("src").sort().map((f) => readFileSync("src/" + f, "utf8")).join("\\n");
const hash = createHash("sha1").update(code).digest("base64url").slice(0, 8);
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/assets", { recursive: true });
writeFileSync("dist/assets/app-" + hash + ".js", code);
writeFileSync("dist/assets/style-" + hash + ".css", "body{margin:0}");
`;

const PROJECT = {
  "package.json": JSON.stringify({ name: "shop", dependencies: { react: "^19.0.0" } }),
  "build.mjs": BUILD,
  "src/a.js": "export const a = 1;\n",
  "xray.config.json": JSON.stringify({ bundle: { install: "true", build: "node build.mjs" } }),
};

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

async function run(changes: Record<string, string>) {
  const repo = (fixture = new GitFixture().write(PROJECT).commit("base").branch("feature"));
  repo.write(changes).commit("change");
  const config = resolveConfig(repo.root, { bundle: { enabled: true, install: "true", build: "node build.mjs" } });
  return analyzePullRequest({ cwd: repo.root, base: "main", config });
}

describe("analyzeBundle", () => {
  it("matches hashed chunks across builds and flags growth over the threshold", async () => {
    // ~20 KB of incompressible-ish code: well over 10 KB gzip.
    const big = Array.from({ length: 2000 }, (_, i) => `export const v${i} = "${(i * 7919).toString(36)}${i}";`).join("\n");
    const result = await run({
      "src/b.js": big,
      "package.json": JSON.stringify({ name: "shop", dependencies: { react: "^19.1.0", dayjs: "^1.11.0" } }),
    });
    const { bundle } = result;
    expect(bundle.status).toBe("measured");
    expect(bundle.light).toBe("red");
    expect(bundle.chunks.map((chunk) => chunk.key)).toEqual(["assets/app.js"]);
    expect(bundle.after!.gzip - bundle.before!.gzip).toBeGreaterThan(10_240);
    expect(bundle.dependencyChanges).toEqual([
      { file: "package.json", name: "react", before: "^19.0.0", after: "^19.1.0" },
      { file: "package.json", name: "dayjs", after: "^1.11.0" },
    ]);
    const markdown = renderMarkdown(result);
    expect(markdown).toContain("## 📦 Bundle size");
    expect(markdown).toContain("**🔴 +");
    expect(markdown).toContain("`dayjs` added (^1.11.0)");
  });

  it("is green when nothing grows, and leaves no worktree behind", async () => {
    const result = await run({ "README.md": "docs only\n" });
    expect(result.bundle).toMatchObject({ status: "measured", light: "green", chunks: [] });
    const worktrees = execFileSync("git", ["worktree", "list"], { cwd: fixture!.root, encoding: "utf8" });
    expect(worktrees.trim().split("\n")).toHaveLength(1);
  });

  it("reports a failed build instead of throwing", async () => {
    const repo = (fixture = new GitFixture().write(PROJECT).commit("base").branch("feature"));
    repo.write({ "src/a.js": "export const a = 2;\n" }).commit("change");
    const config = resolveConfig(repo.root, { bundle: { enabled: true, install: "true", build: "node -e \"console.error('error: boom'); process.exit(1)\"" } });
    const { bundle } = await analyzePullRequest({ cwd: repo.root, base: "main", config });
    expect(bundle.status).toBe("failed");
    expect(bundle.error).toContain("error: boom");
  });

  it("adds no section when disabled", async () => {
    const repo = (fixture = new GitFixture().write(PROJECT).commit("base").branch("feature"));
    repo.write({ "src/a.js": "export const a = 2;\n" }).commit("change");
    const result = await analyzePullRequest({ cwd: repo.root, base: "main", config: resolveConfig(repo.root) });
    expect(result.bundle.status).toBe("disabled");
    expect(renderMarkdown(result)).not.toContain("Bundle size");
  });
});
