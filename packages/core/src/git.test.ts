import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getChangedFiles, parseNameStatus, resolveMergeBase } from "./git.js";

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
