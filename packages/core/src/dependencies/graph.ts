import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { cruise, type ICruiseResult, type IDependency } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import ts from "typescript";
import type { XrayConfig } from "../config.js";
import { isCodeFile } from "../files.js";
import { discoverWorkspace, workspaceAliases } from "../workspaces.js";

/**
 * The project's module graph: dependency-cruiser's output with aliases, workspace packages and
 * per-package tsconfigs resolved, and every path repo-relative POSIX (principle P4). Shared by the
 * PR report's Dependencies section and the quality report's architecture metric.
 */

export interface DependencyEdge {
  from: string;
  to: string;
  typeOnly: boolean;
  dynamic: boolean;
}

export interface Graph {
  modules: Set<string>;
  edges: DependencyEdge[];
}

/** A tsconfig's compiler options, `extends` resolved; plain `typescript`, so the graph never loads ts-morph. */
function readCompilerOptions(tsConfigPath: string): ts.CompilerOptions | undefined {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsConfigPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  return parsed?.options;
}

/** `react-dom/client` → `react-dom`, `@scope/pkg/x` → `@scope/pkg`. */
export function packageName(specifier: string): string {
  const parts = specifier.replace(/^node:/, "").split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function isExternal(dependency: IDependency): boolean {
  return (
    dependency.coreModule ||
    dependency.dependencyTypes.some((type) => type === "core" || type.startsWith("npm"))
  );
}

/** `paths` as resolver aliases: `@/*` → `<dir>/*` becomes `@` → `<dir>`; exact keys match exactly. */
export function pathAliases(options: ts.CompilerOptions, tsConfigDir: string): Record<string, string> {
  const base = (options as { pathsBasePath?: string }).pathsBasePath ?? options.baseUrl ?? tsConfigDir;
  const aliases: [string, string][] = [];
  for (const [key, targets] of Object.entries(options.paths ?? {})) {
    const [target] = targets;
    if (!target) continue;
    if (key.endsWith("/*") && target.endsWith("/*")) aliases.push([key.slice(0, -2), resolve(base, target.slice(0, -2))]);
    else if (!key.includes("*") && !target.includes("*")) aliases.push([`${key}$`, resolve(base, target)]);
  }
  // Longest first: `@/assets` must win over `@`.
  return Object.fromEntries(aliases.sort(([a], [b]) => b.length - a.length));
}

interface Scope {
  /** Folders to cruise, relative to the root. */
  roots: string[];
  tsConfig?: string;
  /** Folders whose files are left to their own scope's cruise. */
  others: string[];
}

/**
 * Cruises one scope: a workspace package with its own tsconfig, or the files outside
 * packages with the root's. Its `paths` are given as resolver aliases, so they work
 * without a baseUrl and even when an `extends` isn't installed.
 */
async function cruiseScope(cwd: string, config: XrayConfig, scope: Scope, workspaceAlias: Record<string, string>): Promise<ICruiseResult> {
  let tsConfig: ReturnType<typeof extractTSConfig> | undefined;
  let aliases: Record<string, string> = {};
  if (scope.tsConfig && existsSync(join(cwd, scope.tsConfig))) {
    // `paths` always become aliases: dependency-cruiser's tsconfig plugin ignores them without a
    // baseUrl (optional since TypeScript 4.1), and can't read a file whose `extends` is missing.
    const options = readCompilerOptions(join(cwd, scope.tsConfig));
    if (options) aliases = pathAliases(options, join(cwd, scope.tsConfig, ".."));
    try {
      tsConfig = extractTSConfig(join(cwd, scope.tsConfig));
    } catch {
      tsConfig = undefined;
    }
  }
  const escape = (folder: string) => folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = await cruise(
    scope.roots,
    {
      baseDir: cwd,
      // Other packages' files are reached as leaves; their own cruise resolves their imports.
      doNotFollow: { path: ["node_modules", ...scope.others.map((folder) => `^${escape(folder)}/`)] },
      exclude: { path: config.exclude },
      tsPreCompilationDeps: true,
      ...(tsConfig && scope.tsConfig ? { tsConfig: { fileName: join(cwd, scope.tsConfig) } } : {}),
    },
    { alias: { ...aliases, ...workspaceAlias } },
    tsConfig ? { tsConfig } : {},
  );
  return typeof result.output === "string" ? (JSON.parse(result.output) as ICruiseResult) : result.output;
}

/**
 * The whole project's modules. At a workspace root, each package is cruised with its own
 * tsconfig (its `paths` aliases), and the files outside packages with the root's.
 *
 * A file of one package imported from another shows up twice in the merged modules: as a leaf
 * of the importer's cruise (`doNotFollow`) and in full in its own. `toGraph` keeps it as one node.
 */
async function cruiseProject(cwd: string, config: XrayConfig): Promise<ICruiseResult> {
  const workspace = discoverWorkspace(cwd);
  // CI has no node_modules: map workspace package names to their files ourselves.
  const workspaceAlias = workspace ? workspaceAliases(workspace) : {};
  if (!workspace) {
    return cruiseScope(cwd, config, { roots: config.roots, tsConfig: config.tsConfig, others: [] }, workspaceAlias);
  }
  const dirs = workspace.map((pkg) => pkg.dir);
  const scopes: Scope[] = workspace.map((pkg) => ({
    roots: [pkg.dir],
    tsConfig: existsSync(join(cwd, pkg.dir, "tsconfig.json")) ? `${pkg.dir}/tsconfig.json` : config.tsConfig,
    others: dirs.filter((dir) => dir !== pkg.dir && !pkg.dir.startsWith(`${dir}/`)),
  }));
  // Files outside packages: start from what isn't a package or holds one, so no package is
  // cruised twice with the wrong aliases.
  const holdsPackage = (path: string) => dirs.some((dir) => dir === path || dir.startsWith(`${path}/`));
  const outside = config.roots
    .flatMap((root) =>
      root === "."
        ? readdirSync(cwd, { withFileTypes: true })
            .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
            .filter((entry) => entry.isDirectory() || isCodeFile(entry.name))
            .map((entry) => entry.name)
        : [root],
    )
    .filter((root) => !holdsPackage(root));
  if (outside.length > 0) scopes.push({ roots: outside, tsConfig: config.tsConfig, others: dirs });
  const results = await Promise.all(scopes.map((scope) => cruiseScope(cwd, config, scope, workspaceAlias)));
  return { ...results[0]!, modules: results.flatMap((result) => result.modules) };
}

/**
 * dependency-cruiser reports `source` relative to `baseDir` but `resolved`
 * relative to the process cwd, which differ when the CLI runs with --cwd.
 * Maps both to repo-relative POSIX paths (through realpath, so /var vs
 * /private/var symlinks on macOS do not split one file into two).
 */
export function repoPathResolver(cwd: string): (path: string, preferProcessCwd: boolean) => string {
  const root = realpathSync(cwd);
  return (path, preferProcessCwd) => {
    const bases = preferProcessCwd ? [process.cwd(), cwd] : [cwd, process.cwd()];
    for (const base of bases) {
      const absolute = resolve(base, path);
      if (existsSync(absolute)) return relative(root, realpathSync(absolute)).split(sep).join("/");
    }
    return path;
  };
}

type ToRepoPath = ReturnType<typeof repoPathResolver>;

const asIs: ToRepoPath = (path) => path;

export function toGraph(result: ICruiseResult, includeExternal: boolean, toRepoPath = asIs): Graph {
  const modules = new Set<string>();
  const edges: DependencyEdge[] = [];
  for (const module of result.modules) {
    if (module.coreModule || module.couldNotResolve || module.source.includes("node_modules/")) {
      continue;
    }
    const source = toRepoPath(module.source, false);
    modules.add(source);
    for (const dependency of module.dependencies) {
      if (dependency.couldNotResolve) continue;
      const external = isExternal(dependency);
      if (external && !includeExternal) continue;
      edges.push({
        from: source,
        to: external ? packageName(dependency.module) : toRepoPath(dependency.resolved, true),
        typeOnly: dependency.typeOnly ?? dependency.dependencyTypes.includes("type-only"),
        dynamic: dependency.dynamic,
      });
    }
  }
  return { modules, edges: dedupeEdges(edges) };
}

function dedupeEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const byKey = new Map<string, DependencyEdge>();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}`;
    const existing = byKey.get(key);
    // A value import wins over a type-only one between the same two modules.
    if (!existing) byKey.set(key, { ...edge });
    else {
      existing.typeOnly &&= edge.typeOnly;
      existing.dynamic &&= edge.dynamic;
    }
  }
  return [...byKey.values()];
}

/**
 * The whole project's module graph (aliases, workspaces and per-package tsconfigs resolved),
 * for the PR report and for tools that need more than a PR's neighbourhood, like the quality report.
 */
export async function buildDependencyGraph(cwd: string, config: XrayConfig): Promise<Graph> {
  return toGraph(await cruiseProject(cwd, config), config.dependencies.includeExternal, repoPathResolver(cwd));
}
