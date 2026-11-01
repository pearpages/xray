import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BundleConfig } from "../config.js";
import { git } from "../git.js";
import { discoverWorkspace } from "../workspaces.js";

export interface BuildPlan {
  install: string;
  build: string;
  outDir: string;
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export type PackageManager = "pnpm" | "yarn" | "npm-ci" | "npm";

/** The package manager a lockfile names: from `dir` up to `top` (monorepos keep it at the root). */
export function detectPackageManager(dir: string, top: string): PackageManager {
  return packageManager(dir, top);
}

function packageManager(dir: string, top: string): "pnpm" | "yarn" | "npm-ci" | "npm" {
  for (let current = dir; ; current = join(current, "..")) {
    if (existsSync(join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(current, "yarn.lock"))) return "yarn";
    if (existsSync(join(current, "package-lock.json"))) return "npm-ci";
    if (current === top || current === join(current, "..")) return "npm";
  }
}

const INSTALL = {
  pnpm: "pnpm install --frozen-lockfile",
  yarn: "yarn install --frozen-lockfile",
  "npm-ci": "npm ci --no-audit --no-fund",
  npm: "npm install --no-audit --no-fund",
};
const EXEC = { pnpm: "pnpm exec", yarn: "yarn", "npm-ci": "npx --no-install", npm: "npx --no-install" };
const RUN = { pnpm: "pnpm run", yarn: "yarn run", "npm-ci": "npm run", npm: "npm run" };
/** Runs a binary inside one workspace package, from the root. */
const EXEC_IN = {
  pnpm: (name: string) => `pnpm --filter ${name} exec`,
  yarn: (name: string) => `yarn workspace ${name}`,
  "npm-ci": (name: string) => `npm exec --workspace ${name} --`,
  npm: (name: string) => `npm exec --workspace ${name} --`,
};
const VITE_FLAGS = "--sourcemap hidden --emptyOutDir";

const usesVite = (manifest: Record<string, unknown>) =>
  "vite" in { ...(manifest.dependencies as object), ...(manifest.devDependencies as object) };

/** Workspace packages that are Vite apps: they depend on vite and have an index.html. */
function viteApps(dir: string): { name: string; dir: string }[] {
  return (discoverWorkspace(dir) ?? []).filter((pkg) => {
    const manifest = readJson(join(dir, pkg.dir, "package.json")) ?? {};
    return usesVite(manifest) && existsSync(join(dir, pkg.dir, "index.html"));
  });
}

/** What to run, from the config or from the project (lockfile, Vite, `build` script). */
export function planBuild(dir: string, top: string, config: BundleConfig): BuildPlan {
  const manager = packageManager(dir, top);
  const manifest = readJson(join(dir, "package.json")) ?? {};
  const vite = usesVite(manifest);
  // A workspace root rarely holds the app: build the one package that is a Vite app.
  if (!vite && !config.build) {
    const apps = viteApps(dir);
    if (apps.length > 1) {
      throw new BuildError(
        `Several Vite apps in this workspace (${apps.map((app) => app.name).join(", ")}): ` +
          "set `bundle.build` and `bundle.outDir` in xray.config.json.",
      );
    }
    const [app] = apps;
    if (app) {
      return {
        install: config.install ?? INSTALL[manager],
        build: `${EXEC_IN[manager](app.name)} vite build ${VITE_FLAGS}`,
        outDir: config.outDir ?? `${app.dir}/dist`,
      };
    }
  }
  const outDir =
    config.outDir ?? (vite ? "dist" : (["dist", "build", "out"].find((name) => existsSync(join(dir, name))) ?? "dist"));
  return {
    install: config.install ?? INSTALL[manager],
    // Vite directly: skips the type-check most `build` scripts run first, and emits source maps.
    build: config.build ?? (vite ? `${EXEC[manager]} vite build ${VITE_FLAGS}` : `${RUN[manager]} build`),
    outDir,
  };
}

export class BuildError extends Error {}

/** The lines that say what went wrong: error lines first, stack frames and colours dropped. */
export function summarizeFailure(output: string): string {
  const lines = output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !/^\s+at /.test(line));
  const errors = lines.filter((line) => /error|failed|cannot|could not|not found/i.test(line));
  return [...new Set([...errors.slice(0, 6), ...lines.slice(-3)])].join("\n");
}

function run(command: string, cwd: string, minutes: number): void {
  try {
    execSync(command, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: minutes * 60_000,
      env: { ...process.env, CI: "true" },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as { stderr?: Buffer; stdout?: Buffer; message: string };
    throw new BuildError(`\`${command}\` failed:\n\n${summarizeFailure(`${failure.stderr ?? ""}\n${failure.stdout ?? ""}`) || failure.message}`);
  }
}

export interface Checkout {
  /** The analysed root inside the checkout. */
  dir: string;
  dispose: () => void;
}

/**
 * A detached worktree of `commit`, so building never touches the user's tree.
 * `prefix` is the analysed root relative to the repository top.
 */
export function checkout(cwd: string, commit: string): Checkout {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  const prefix = git(cwd, ["rev-parse", "--show-prefix"]);
  const parent = mkdtempSync(join(tmpdir(), "xray-bundle-"));
  const worktree = join(parent, "tree");
  git(top, ["worktree", "add", "--detach", "--force", worktree, commit]);
  return {
    dir: join(worktree, prefix),
    dispose: () => {
      try {
        git(top, ["worktree", "remove", "--force", worktree]);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
  };
}

/** Installs and builds the analysed root of `commit`; returns the output folder, then cleans up via `dispose`. */
export function buildAt(cwd: string, commit: string, config: BundleConfig): Checkout & { outDir: string; plan: BuildPlan } {
  const tree = checkout(cwd, commit);
  try {
    const top = git(tree.dir, ["rev-parse", "--show-toplevel"]);
    const plan = planBuild(tree.dir, top, config);
    run(plan.install, tree.dir, config.timeoutMinutes);
    run(plan.build, tree.dir, config.timeoutMinutes);
    const outDir = join(tree.dir, plan.outDir);
    if (!existsSync(outDir)) throw new BuildError(`The build produced no \`${plan.outDir}\` folder (set \`bundle.outDir\`).`);
    return { ...tree, outDir, plan };
  } catch (error) {
    tree.dispose();
    throw error;
  }
}
