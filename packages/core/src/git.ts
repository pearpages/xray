import { execFileSync } from "node:child_process";

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  /** Only set for renames. */
  previousPath?: string;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function refExists(cwd: string, ref: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the commit the PR branched from. Accepts a local branch, a remote
 * one (`origin/main`) or a bare name that only exists on the remote — the
 * usual situation in a CI checkout.
 */
export function resolveMergeBase(cwd: string, base: string): string {
  const candidates = [base, `origin/${base}`];
  const ref = candidates.find((candidate) => refExists(cwd, candidate));
  if (!ref) {
    throw new Error(
      `Base ref "${base}" not found (tried ${candidates.join(", ")}). ` +
        "In CI, check out with fetch-depth: 0 so the base branch is available.",
    );
  }
  return git(cwd, ["merge-base", ref, "HEAD"]);
}

const STATUS_BY_LETTER: Record<string, ChangeStatus> = {
  A: "added",
  C: "added",
  M: "modified",
  T: "modified",
  D: "deleted",
  R: "renamed",
};

export function parseNameStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [code = "", first = "", second] = line.split("\t");
    const status = STATUS_BY_LETTER[code.charAt(0)];
    if (!status) continue;
    if (status === "renamed" && second) {
      files.push({ path: second, status, previousPath: first });
    } else {
      files.push({ path: second ?? first, status });
    }
  }
  return files;
}

/**
 * Files changed between the merge base and the working tree, so a local run
 * also sees uncommitted and untracked work. In CI the tree is clean and this
 * is the same as diffing against HEAD.
 *
 * Paths are relative to `cwd` and only cover files under it (`--relative`),
 * so a run from a monorepo package matches the analysers' own paths.
 */
export function getChangedFiles(cwd: string, mergeBase: string): ChangedFile[] {
  const tracked = parseNameStatus(
    git(cwd, ["diff", "--name-status", "-M", "--relative", mergeBase]),
  );
  const seen = new Set(tracked.map((file) => file.path));
  const untracked = untrackedFiles(cwd).map((path): ChangedFile => ({ path, status: "added" }));
  return [...tracked, ...untracked.filter((file) => !seen.has(file.path))];
}

function untrackedFiles(cwd: string): string[] {
  return git(cwd, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
}

/** Inclusive line ranges, on the new side of the diff. */
export type LineRange = [from: number, to: number];

export function parseChangedLines(diff: string): Map<string, LineRange[]> {
  const ranges = new Map<string, LineRange[]>();
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? undefined : line.slice("+++ b/".length);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !file) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count > 0) ranges.set(file, [...(ranges.get(file) ?? []), [start, start + count - 1]]);
  }
  return ranges;
}

/**
 * Lines added or changed since the merge base, per file (same scope and paths
 * as `getChangedFiles`). Untracked files count as entirely changed.
 */
export function getChangedLines(cwd: string, mergeBase: string): Map<string, LineRange[]> {
  // Explicit prefixes: a user's diff.noprefix setting would otherwise break the parsing.
  const args = ["diff", "-U0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];
  const ranges = parseChangedLines(git(cwd, [...args, "-M", "--relative", mergeBase]));
  for (const path of untrackedFiles(cwd)) {
    if (!ranges.has(path)) ranges.set(path, [[1, Number.MAX_SAFE_INTEGER]]);
  }
  return ranges;
}

/** File contents at a commit, or undefined when the file did not exist there. */
export function showFile(cwd: string, commit: string, path: string): string | undefined {
  try {
    return git(cwd, ["show", `${commit}:./${path}`]);
  } catch {
    return undefined;
  }
}
