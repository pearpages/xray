// Where every repository's reports live on this machine (ADR-0028): one folder, outside every
// analysed repository, shared by the CLI, the quality-report skill and the quality UI.
//
//   <home>/reports/<owner>-<repo>/quality/<generatedAt>-<sha>.json   quality history (ADR-0027 names)
//   <home>/reports/<owner>-<repo>/pr/<name>.md                       saved PR reports
//
// Only node builtins: the quality UI's dev server imports this file from source.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/** `$XRAY_HOME/reports`, else `~/.xray/reports`. */
export function reportsHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XRAY_HOME ? resolve(env.XRAY_HOME) : join(homedir(), ".xray"), "reports");
}

/** Characters a repository key keeps; anything else becomes `-`, so a key is always one safe folder name. */
const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");

/**
 * A remote URL's last two path segments, joined by `-`: the owner and the repository.
 * @example remoteKey("git@github.com:pearpages/xray.git") // → "pearpages-xray"
 * @example remoteKey("https://github.com/pearpages/xray") // → "pearpages-xray"
 */
export function remoteKey(url: string): string | undefined {
  const path = url.trim().replace(/\.git\/?$/, "").replace(/\/+$/, "").split(/[/:]/).filter(Boolean);
  if (path.length < 2) return undefined;
  const key = safe(`${path.at(-2)}-${path.at(-1)}`);
  return key || undefined;
}

const git = (root: string, args: string[]) => {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

/**
 * The name a repository's history is kept under: `<owner>-<repo>` from its `origin` remote, else
 * the name of its top folder (or of `root` outside git). Every clone of one repository gets the
 * same key, so its history is found again.
 */
export function repoKey(root: string): string {
  const fromRemote = remoteKey(git(root, ["remote", "get-url", "origin"]));
  if (fromRemote) return fromRemote;
  return safe(basename(git(root, ["rev-parse", "--show-toplevel"]) || resolve(root))) || "repository";
}

/** The folder `--snapshots` uses when given none: `<home>/<key>/quality`. */
export function qualityHistory(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(reportsHome(env), repoKey(root), "quality");
}
