import { execFileSync } from "node:child_process";
import { matchesGlob } from "node:path";
import { isTestFile } from "@xray/core";

const CODE = /\.(c|m)?[jt]sx?$/;
const NOT_SOURCE = [/\.d\.[cm]?ts$/, /\.stories\.[cm]?[jt]sx?$/, /(^|\/)(node_modules|dist|build|coverage|\.next|out)\//];

export function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }).trim();
}

/** Tracked code files under the root, relative to it: no tests, stories, declarations, build output or ignored globs. */
export function codeFiles(root: string, ignore: string[]): string[] {
  return git(root, ["ls-files", "--", "."])
    .split("\n")
    .filter((file) => file && CODE.test(file))
    .filter((file) => !isTestFile(file) && !NOT_SOURCE.some((pattern) => pattern.test(file)))
    .filter((file) => !ignore.some((glob) => matchesGlob(file, glob)))
    .sort();
}
