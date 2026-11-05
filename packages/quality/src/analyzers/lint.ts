import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { ts } from "ts-morph";
import { git } from "../files.js";
import { findingsScore, unavailable } from "../score.js";
import type { Analyzer, Finding } from "../types.js";

export interface LintRun {
  tool: "eslint" | "typescript";
  /** Root-relative folder (ESLint) or tsconfig (TypeScript); "." for the root. */
  target: string;
  status: "ok" | "failed" | "not installed";
  errors: number;
  warnings: number;
  reason?: string;
}

const ESLINT_CONFIG = /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/;
const LINTABLE = /\.(c|m)?[jt]sx?$/;
const toPosix = (path: string) => path.split(sep).join("/");
/** Root-relative path of a file a tool reported; tools may print the real path of a symlinked root (P4). */
export function relativeTo(root: string, file: string): string {
  const direct = toPosix(relative(root, file));
  if (!direct.startsWith("../")) return direct;
  const real = toPosix(relative(realpathSync(root), file));
  return real.startsWith("../") ? direct : real;
}

const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".");

/** The CLI script of a package installed where `dir` would find it (the project's own copy), if any. */
export function installedBin(dir: string, name: string, bin: string): string | undefined {
  try {
    const manifest = createRequire(join(dir, "package.json")).resolve(`${name}/package.json`);
    const bins = (JSON.parse(readFileSync(manifest, "utf8")) as { bin?: string | Record<string, string> }).bin;
    const script = typeof bins === "string" ? bins : bins?.[bin];
    return script ? join(dirname(manifest), script) : undefined;
  } catch {
    return undefined;
  }
}

/** The tsconfigs `tsc -p` should check: a solution-style config (`files: []` + references) stands for its references. */
export function tsconfigsToCheck(root: string, tsconfig: string, seen = new Set<string>()): string[] {
  if (seen.has(tsconfig)) return [];
  seen.add(tsconfig);
  const { config } = ts.readConfigFile(join(root, tsconfig), ts.sys.readFile) as {
    config?: { files?: unknown[]; include?: unknown[]; references?: { path: string }[] };
  };
  const solution = Array.isArray(config?.files) && config.files.length === 0 && !config.include && config.references?.length;
  if (!solution) return [tsconfig];
  return config!.references!.flatMap((reference) => {
    const target = toPosix(relative(root, resolve(join(root, dirOf(tsconfig)), reference.path)));
    const file = target.endsWith(".json") ? target : `${target}/tsconfig.json`;
    return existsSync(join(root, file)) ? tsconfigsToCheck(root, file, seen) : [];
  });
}

const TYPECHECK_SCRIPTS = ["typecheck", "type-check", "check-types", "types", "tsc"];

/** The tsconfig a folder's own typecheck script checks (`tsc --noEmit -p tsconfig.build.json`), if it names one. */
export function typecheckConfig(root: string, dir: string): string | undefined {
  const manifest = join(root, dir, "package.json");
  if (!existsSync(manifest)) return undefined;
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return undefined;
  }
  for (const name of TYPECHECK_SCRIPTS) {
    const project = /\btsc\b[^&|;]*?\s(?:-p|--project)[\s=]+(\S+)/.exec(scripts[name] ?? "")?.[1];
    if (!project) continue;
    const target = toPosix(join(dir, project));
    const file = target.endsWith(".json") ? target : `${target}/tsconfig.json`;
    if (existsSync(join(root, file))) return file;
  }
  return undefined;
}

/** The deepest of `dirs` holding `file` ("." for the root). */
export function nearestDir(file: string, dirs: string[]): string {
  return dirs.filter((dir) => dir === "." || file.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0] ?? ".";
}

interface EslintResult {
  filePath: string;
  messages: { ruleId: string | null; severity: 1 | 2; message: string; line?: number }[];
}

/** `path(line,col): error TS2322: message` lines of `tsc --pretty false`; continuation lines are dropped. */
export function parseTscOutput(output: string, cwd: string, root: string): { file: string; line?: number; code: string; message: string }[] {
  const diagnostics: { file: string; line?: number; code: string; message: string }[] = [];
  for (const text of output.split("\n")) {
    const located = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(text);
    if (located) {
      const absolute = isAbsolute(located[1]!) ? located[1]! : join(cwd, located[1]!);
      diagnostics.push({ file: relativeTo(root, absolute), line: Number(located[2]), code: located[3]!, message: located[4]! });
      continue;
    }
    const global = /^error (TS\d+): (.*)$/.exec(text);
    if (global) diagnostics.push({ file: "", code: global[1]!, message: global[2]! });
  }
  return diagnostics;
}

export const lint: Analyzer = {
  id: "lint",
  name: "Lint and types",
  phase: 2,
  async analyze({ root, config, codeFiles, scope }) {
    const settings = config.lint;
    const timeout = settings.timeoutSeconds * 1000;
    const tracked = git(root, ["ls-files", "--", "."]).split("\n").filter((file) => file && !file.includes("node_modules/"));
    const keep = (file: string) => file !== "" && !file.startsWith("../") && !isAbsolute(file) && !config.ignore.some((glob) => matchesGlob(file, glob));
    const findings: Finding[] = [];
    const runs: LintRun[] = [];
    const rules = new Map<string, number>();
    const count = (rule: string) => rules.set(rule, (rules.get(rule) ?? 0) + 1);
    const run = (script: string, args: string[], cwd: string) =>
      spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout, maxBuffer: 256 * 1024 * 1024 });

    if (settings.eslint) {
      const dirs = [...new Set(tracked.filter((file) => ESLINT_CONFIG.test(file)).map(dirOf))].sort();
      for (const dir of dirs) {
        const target: LintRun = { tool: "eslint", target: dir, status: "ok", errors: 0, warnings: 0 };
        runs.push(target);
        const cwd = join(root, dir);
        const bin = installedBin(cwd, "eslint", "eslint");
        if (!bin) {
          Object.assign(target, { status: "not installed", reason: "eslint isn't installed (xray doesn't install)" });
          continue;
        }
        // A folder with its own config is linted from there, not again from its parent.
        const nested = dirs.filter((other) => other !== dir && (dir === "." || other.startsWith(`${dir}/`)));
        const ignores = nested.flatMap((other) => ["--ignore-pattern", `${toPosix(relative(cwd, join(root, other)))}/**`]);
        // Scoped: lint just those files of this folder (ESLint skips the ones its config ignores).
        const inDir = (file: string) => (dir === "." || file.startsWith(`${dir}/`)) && nearestDir(file, dirs) === dir;
        const targets = scope ? tracked.filter((file) => LINTABLE.test(file) && scope(file) && inDir(file)).map((file) => toPosix(relative(cwd, join(root, file)))) : ["."];
        if (targets.length === 0) continue;
        const result = run(bin, [...targets, "--format", "json", "--no-error-on-unmatched-pattern", ...ignores], cwd);
        let parsed: EslintResult[] | undefined;
        try {
          parsed = JSON.parse(result.stdout) as EslintResult[];
        } catch {
          parsed = undefined;
        }
        if (!parsed || result.status === 2) {
          const why = result.error?.message ?? (`${result.stderr}\n${result.stdout}`.split("\n").find((line) => line.trim()) || `exit ${result.status}`);
          Object.assign(target, { status: "failed", reason: why.trim().slice(0, 300) });
          continue;
        }
        for (const file of parsed) {
          const path = relativeTo(root, file.filePath);
          if (!keep(path)) continue;
          for (const message of file.messages) {
            const severity = message.severity === 2 ? "medium" : "low";
            if (severity === "medium") target.errors++;
            else target.warnings++;
            count(`eslint:${message.ruleId ?? "parse"}`);
            findings.push({ file: path, ...(message.line ? { line: message.line } : {}), severity, message: `${message.message}${message.ruleId ? ` (${message.ruleId})` : ""}` });
          }
        }
      }
    }

    if (settings.typescript) {
      const owned = tracked.filter((file) => /(^|\/)tsconfig\.json$/.test(file));
      const owners = owned.map(dirOf);
      // Each folder is checked as the project checks it: its typecheck script's config, else tsconfig.json.
      const configs = [...new Set(owned.flatMap((file) => tsconfigsToCheck(root, typecheckConfig(root, dirOf(file)) ?? file)))].sort();
      for (const tsconfig of configs) {
        const target: LintRun = { tool: "typescript", target: tsconfig, status: "ok", errors: 0, warnings: 0 };
        runs.push(target);
        const cwd = join(root, dirOf(tsconfig));
        const bin = installedBin(cwd, "typescript", "tsc");
        if (!bin) {
          Object.assign(target, { status: "not installed", reason: "typescript isn't installed (xray doesn't install)" });
          continue;
        }
        // Read-only: no emit, and no .tsbuildinfo even for composite or incremental projects.
        const result = run(bin, ["--noEmit", "-p", join(root, tsconfig), "--pretty", "false", "--incremental", "false", "--composite", "false"], cwd);
        if (result.error || (result.status !== 0 && result.status !== 1 && result.status !== 2)) {
          Object.assign(target, { status: "failed", reason: (result.error?.message ?? `exit ${result.status}`).slice(0, 300) });
          continue;
        }
        for (const diagnostic of parseTscOutput(`${result.stdout}\n${result.stderr}`, cwd, root)) {
          const file = diagnostic.file || tsconfig;
          if (!keep(file)) continue;
          // A file with a nearer tsconfig compiles with that one (its paths, its options): a broader
          // config's errors about it are noise (ADR-0013, ADR-0016).
          if (diagnostic.file && nearestDir(file, owners) !== dirOf(tsconfig)) continue;
          target.errors++;
          count(diagnostic.code);
          findings.push({ file, ...(diagnostic.line ? { line: diagnostic.line } : {}), severity: "medium", message: `${diagnostic.message} (${diagnostic.code})` });
        }
      }
    }

    const ran = runs.filter((item) => item.status === "ok");
    if (ran.length === 0) {
      const why =
        runs.length === 0
          ? "no ESLint config or tsconfig.json"
          : runs.map((item) => `${item.tool} in ${item.target}: ${item.reason}`).join("; ");
      return unavailable("lint", "Lint and types", why);
    }
    // A file can be reported by two overlapping tsconfigs; count each problem once.
    const unique = [...new Map(findings.map((finding) => [`${finding.file}:${finding.line}:${finding.message}`, finding])).values()];
    const errors = unique.filter((finding) => finding.severity === "medium").length;
    const skipped = runs.length - ran.length;
    return {
      id: "lint",
      name: "Lint and types",
      score: findingsScore(unique, codeFiles.length, config.severityPenalty),
      summary:
        `${errors} error(s) and ${unique.length - errors} warning(s) from ${ran.map((item) => (item.tool === "eslint" ? `ESLint in ${item.target}` : `tsc -p ${item.target}`)).join(", ")}` +
        (skipped ? `; ${skipped} run(s) couldn't start (see data).` : "."),
      findings: unique,
      status: "ok",
      data: { runs, rules: [...rules].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count) },
    };
  },
};
