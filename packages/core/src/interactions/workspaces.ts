import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, matchesGlob } from "node:path";

export interface WorkspacePackage {
  name: string;
  /** Folder relative to the workspace root. */
  dir: string;
  /** `exports`-style subpath (".", "./utils") → absolute source file. */
  entries: Map<string, string>;
}

const SOURCE = /\.(c|m)?tsx?$/;
/** Condition keys tried in order; source-first conditions win over built output. */
const CONDITIONS = ["source", "development", "import", "module", "default", "types", "require", "node", "browser"];

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The `packages:` list of a pnpm-workspace.yaml, without a YAML dependency. */
export function parsePnpmWorkspace(text: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    const item = inPackages && /^\s*-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(line);
    if (item) patterns.push(item[1]!.trim());
  }
  return patterns;
}

/** Workspace patterns declared at `root`, or undefined when it isn't a workspace root. */
export function workspacePatterns(root: string): string[] | undefined {
  const pnpm = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) return parsePnpmWorkspace(readFileSync(pnpm, "utf8"));
  const workspaces = readJson(join(root, "package.json"))?.workspaces;
  if (Array.isArray(workspaces)) return workspaces as string[];
  const packages = (workspaces as { packages?: unknown } | undefined)?.packages;
  return Array.isArray(packages) ? (packages as string[]) : undefined;
}

/** Folders (relative to root) holding a package.json and matching the patterns. */
function expand(root: string, patterns: string[]): string[] {
  const include = patterns.filter((pattern) => !pattern.startsWith("!"));
  const exclude = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      const matches = (glob: string) => matchesGlob(path, glob.replace(/\/$/, ""));
      if (include.some(matches) && !exclude.some(matches) && existsSync(join(root, path, "package.json"))) {
        found.push(path);
      }
      visit(path, depth + 1);
    }
  };
  visit("", 0);
  return found.sort();
}

/** Picks a file from an `exports` target: a string, or nested condition objects. */
function pickTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) return target.map(pickTarget).find(Boolean);
  if (target && typeof target === "object") {
    const conditions = target as Record<string, unknown>;
    for (const key of CONDITIONS) {
      const picked = key in conditions ? pickTarget(conditions[key]) : undefined;
      if (picked) return picked;
    }
  }
  return undefined;
}

function entriesOf(root: string, dir: string, manifest: Record<string, unknown>): Map<string, string> {
  const entries = new Map<string, string>();
  const packageDir = join(root, dir);
  const accept = (subpath: string, target: string | undefined) => {
    if (!target || target.includes("*")) return;
    const file = join(packageDir, target);
    if (SOURCE.test(file) && !file.endsWith(".d.ts") && existsSync(file)) entries.set(subpath, file);
  };

  const exports = manifest.exports;
  const isSubpathMap =
    exports && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some((key) => key.startsWith("."));
  if (isSubpathMap) {
    for (const [subpath, target] of Object.entries(exports as Record<string, unknown>)) accept(subpath, pickTarget(target));
  } else if (exports) {
    accept(".", pickTarget(exports));
  }
  for (const field of ["source", "module", "main", "types"]) {
    if (!entries.has(".")) accept(".", manifest[field] as string | undefined);
  }
  // Built-only packages (dist/…): source usually sits in src/index.
  for (const fallback of ["src/index.ts", "src/index.tsx", "index.ts", "index.tsx"]) {
    if (!entries.has(".")) accept(".", fallback);
  }
  return entries;
}

export function discoverWorkspace(root: string): WorkspacePackage[] | undefined {
  const patterns = workspacePatterns(root);
  if (!patterns) return undefined;
  const packages: WorkspacePackage[] = [];
  for (const dir of expand(root, patterns)) {
    const manifest = readJson(join(root, dir, "package.json"));
    if (typeof manifest?.name !== "string" || !statSync(join(root, dir)).isDirectory()) continue;
    packages.push({ name: manifest.name, dir, entries: entriesOf(root, dir, manifest) });
  }
  return packages;
}

/** Resolves `@scope/pkg` or `@scope/pkg/sub` to a workspace package's source file. */
export function workspaceResolver(packages: WorkspacePackage[]): (specifier: string) => string | undefined {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  return (specifier) => {
    const parts = specifier.split("/");
    const nameLength = specifier.startsWith("@") ? 2 : 1;
    const pkg = byName.get(parts.slice(0, nameLength).join("/"));
    if (!pkg) return undefined;
    const rest = parts.slice(nameLength).join("/");
    return pkg.entries.get(rest ? `./${rest}` : ".");
  };
}
