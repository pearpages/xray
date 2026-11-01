import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitFixture } from "./testing/git-fixture.js";
import { getChangedFiles, getChangedLines, parseChangedLines, parseNameStatus, resolveMergeBase } from "./git.js";

describe("parseNameStatus", () => {
  it("maps git status letters, including renames", () => {
    const output = ["M\tsrc/a.ts", "A\tsrc/b.ts", "D\tsrc/c.ts", "R087\tsrc/old.ts\tsrc/new.ts", ""].join("\n");
    expect(parseNameStatus(output)).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
      { path: "src/c.ts", status: "deleted" },
      { path: "src/new.ts", status: "renamed", previousPath: "src/old.ts" },
    ]);
  });
});

describe("getChangedFiles", () => {
  it("includes uncommitted and untracked work, but not ignored files", () => {
    const repo = mkdtempSync(join(tmpdir(), "xray-git-"));
    const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    try {
      run("init", "-q", "-b", "main");
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      writeFileSync(join(repo, ".gitignore"), "ignored.ts\n");
      run("add", ".");
      run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base");

      writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
      writeFileSync(join(repo, "new.ts"), "export const n = 1;\n");
      writeFileSync(join(repo, "ignored.ts"), "export const i = 1;\n");

      expect(getChangedFiles(repo, resolveMergeBase(repo, "main"))).toEqual([
        { path: "a.ts", status: "modified" },
        { path: "new.ts", status: "added" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("parseChangedLines", () => {
  it("collects new-side line ranges per file and skips pure deletions", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3 +3,2 @@",
      "@@ -10,2 +11,0 @@",
      "@@ -20 +20 @@",
      "diff --git a/old.ts b/old.ts",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
    ].join("\n");
    expect([...parseChangedLines(diff)]).toEqual([["src/a.ts", [[3, 4], [20, 20]]]]);
  });
});

describe("changes seen from a monorepo package", () => {
  it("are relative to that package and ignore the rest of the repo", () => {
    const fixture = new GitFixture()
      .write({ "packages/app/src/a.ts": "export const a = 1;\n", "packages/lib/b.ts": "export const b = 1;\n" })
      .commit("base")
      .branch("feature")
      .write({ "packages/app/src/a.ts": "export const a = 2;\n", "packages/lib/b.ts": "export const b = 2;\n" })
      .commit("change");
    try {
      const cwd = `${fixture.root}/packages/app`;
      const mergeBase = resolveMergeBase(cwd, "main");
      expect(getChangedFiles(cwd, mergeBase)).toEqual([{ path: "src/a.ts", status: "modified" }]);
      expect([...getChangedLines(cwd, mergeBase).keys()]).toEqual(["src/a.ts"]);
    } finally {
      fixture.dispose();
    }
  });
});
