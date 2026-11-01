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
 */
export function getChangedFiles(cwd: string, mergeBase: string): ChangedFile[] {
  const tracked = parseNameStatus(git(cwd, ["diff", "--name-status", "-M", mergeBase]));
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .map((path): ChangedFile => ({ path, status: "added" }));
  const seen = new Set(tracked.map((file) => file.path));
  return [...tracked, ...untracked.filter((file) => !seen.has(file.path))];
}
