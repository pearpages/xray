import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { cruise, type ICruiseResult, type IDependency } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import ts from "typescript";
import type { XrayConfig } from "../config.js";
import type { ChangedFile, ChangeStatus } from "../git.js";
import { discoverWorkspace, workspaceAliases } from "../workspaces.js";

export type NodeKind = "source" | "test" | "external" | "group";

export interface DependencyNode {
  /** Repo-relative path, or the package name for external nodes. */
  id: string;
  kind: NodeKind;
  /** Set when the file is part of the diff. */
  change?: ChangeStatus;
  /** A file that only re-exports (`export … from`), e.g. a package's index.ts. */
  barrel?: boolean;
  /** For `group` nodes: how many files of the folder are in the diagram. */
  count?: number;
  /** For `group` nodes of a folder-level diagram: how many of those files changed. */
  changedCount?: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  typeOnly: boolean;
  dynamic: boolean;
}

export interface DependencyAnalysis {
  /** `folder` when the PR changes too many modules to draw them one by one. */
  level: "file" | "folder";
  nodes: DependencyNode[];
  /** Only edges with at least one changed endpoint: the diagram is about the diff. */
  edges: DependencyEdge[];
  /** Changed files that are not modules in the graph (deleted, docs, config…). */
  outsideGraph: ChangedFile[];
  /** Nodes left out because the diagram hit `maxNodes`. */
  omittedNodes: number;
  warnings: string[];
}

const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** A barrel: a module whose statements are all `export … from "…"` (comments aside). */
export function isReExportOnly(text: string): boolean {
  const source = ts.createSourceFile("barrel.ts", text, ts.ScriptTarget.Latest);
  return (
    source.statements.length > 0 &&
    source.statements.every((statement) => ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined)
  );
}

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
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

async function cruiseProject(
  cwd: string,
  config: XrayConfig,
  warnings: string[],
): Promise<ICruiseResult> {
  let tsConfig: ReturnType<typeof extractTSConfig> | undefined;
  if (config.tsConfig) {
    try {
      tsConfig = extractTSConfig(join(cwd, config.tsConfig));
    } catch (error) {
      warnings.push(`Could not read ${config.tsConfig}: ${(error as Error).message}`);
    }
  }
  const workspace = discoverWorkspace(cwd);
  const result = await cruise(
    config.roots,
    {
      baseDir: cwd,
      doNotFollow: { path: "node_modules" },
      exclude: { path: config.exclude },
      tsPreCompilationDeps: true,
      ...(tsConfig && config.tsConfig ? { tsConfig: { fileName: join(cwd, config.tsConfig) } } : {}),
    },
    // CI has no node_modules: map workspace package names to their files ourselves.
    workspace ? { alias: workspaceAliases(workspace) } : {},
    tsConfig ? { tsConfig } : {},
  );
  if (typeof result.output === "string") {
    return JSON.parse(result.output) as ICruiseResult;
  }
  return result.output;
}

export interface Graph {
  modules: Set<string>;
  edges: DependencyEdge[];
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
 * Keeps the changed modules plus their direct neighbours (what they import
 * and what imports them). When that exceeds `maxNodes`, neighbours touching
 * the most changed modules are kept first.
 */
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");

/**
 * The same neighbourhood one level up: a node per folder (how many of its files changed),
 * an edge between folders when any file of one uses any file of the other.
 */
function foldersOf(
  files: string[],
  changed: Set<string>,
  edges: DependencyEdge[],
  maxNodes: number,
): Pick<DependencyAnalysis, "nodes" | "edges" | "omittedNodes"> {
  const folders = new Map<string, { count: number; changedCount: number }>();
  for (const file of files) {
    const folder = folders.get(folderOf(file)) ?? { count: 0, changedCount: 0 };
    folder.count++;
    if (changed.has(file)) folder.changedCount++;
    folders.set(folderOf(file), folder);
  }
  const ranked = [...folders].sort(([a, x], [b, y]) => y.changedCount - x.changedCount || y.count - x.count || a.localeCompare(b));
  const kept = new Map(ranked.slice(0, maxNodes));
  const between = new Map<string, DependencyEdge>();
  for (const edge of edges) {
    const from = folderOf(edge.from);
    const to = folderOf(edge.to);
    if (from === to || !kept.has(from) || !kept.has(to)) continue;
    const key = `${from}\0${to}`;
    const existing = between.get(key);
    if (!existing) between.set(key, { from: `${from}/*`, to: `${to}/*`, typeOnly: edge.typeOnly, dynamic: edge.dynamic });
    else {
      existing.typeOnly &&= edge.typeOnly;
      existing.dynamic &&= edge.dynamic;
    }
  }
  return {
    nodes: [...kept]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([folder, { count, changedCount }]) => ({
        id: `${folder}/*`,
        kind: "group" as const,
        count,
        changedCount,
        ...(changedCount > 0 ? { change: "modified" as const } : {}),
      })),
    edges: [...between.values()],
    omittedNodes: ranked.length - kept.size,
  };
}

/** Above this many importers, a barrel's importers are shown as one node per folder. */
export const MAX_BARREL_IMPORTERS = 8;

/**
 * Keeps the changed modules plus their direct neighbours. A neighbour that is a
 * barrel re-exporting a changed module also brings its importers (one more hop),
 * so a change inside a package reaches the code that imports the package; past
 * MAX_BARREL_IMPORTERS they are grouped per folder.
 */
export function selectNeighbourhood(
  graph: Graph,
  changed: ChangedFile[],
  maxNodes: number,
  isBarrel: (path: string) => boolean = () => false,
): Omit<DependencyAnalysis, "warnings"> {
  const changeByPath = new Map(changed.map((file) => [file.path, file.status]));
  const changedInGraph = [...graph.modules].filter((path) => changeByPath.has(path)).sort();
  const changedSet = new Set(changedInGraph);
  const outsideGraph = changed.filter((file) => !graph.modules.has(file.path));

  const touching = graph.edges.filter((edge) => changedSet.has(edge.from) || changedSet.has(edge.to));
  const weight = new Map<string, number>();
  for (const edge of touching) {
    for (const end of [edge.from, edge.to]) {
      if (!changedSet.has(end)) weight.set(end, (weight.get(end) ?? 0) + 1);
    }
  }
  // Barrels that re-export a changed module, and who imports them.
  const barrels = new Set(
    touching.filter((edge) => changedSet.has(edge.to) && !changedSet.has(edge.from) && isBarrel(edge.from)).map((edge) => edge.from),
  );
  const extraEdges: DependencyEdge[] = [];
  const groups = new Map<string, number>();
  for (const barrel of barrels) {
    const importers = graph.edges.filter((edge) => edge.to === barrel && !changedSet.has(edge.from) && edge.from !== barrel);
    if (importers.length <= MAX_BARREL_IMPORTERS) {
      for (const edge of importers) {
        extraEdges.push(edge);
        // Below direct neighbours in the ranking: they are one hop further.
        if (!weight.has(edge.from)) weight.set(edge.from, 0.5);
      }
      continue;
    }
    const byFolder = new Map<string, number>();
    for (const edge of importers) {
      const folder = edge.from.includes("/") ? edge.from.slice(0, edge.from.lastIndexOf("/")) : ".";
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
    }
    for (const [folder, count] of byFolder) {
      const id = `${folder}/*`;
      groups.set(id, (groups.get(id) ?? 0) + count);
      extraEdges.push({ from: id, to: barrel, typeOnly: false, dynamic: false });
      weight.set(id, Math.max(weight.get(id) ?? 0, 0.5));
    }
  }
  const neighbours = [...weight.entries()]
    .sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b))
    .map(([path]) => path);

  // Too many changed modules to draw one by one: draw the folders instead.
  if (changedInGraph.length > maxNodes / 2) {
    const files = [...new Set([...changedInGraph, ...neighbours.filter((id) => !groups.has(id))])];
    return {
      level: "folder",
      ...foldersOf(files, changedSet, [...touching, ...extraEdges], maxNodes),
      outsideGraph,
    };
  }

  const keptChanged = changedInGraph.slice(0, maxNodes);
  const keptNeighbours = neighbours.slice(0, Math.max(0, maxNodes - keptChanged.length));
  const kept = new Set([...keptChanged, ...keptNeighbours]);

  const nodes: DependencyNode[] = [...kept].sort().map((id) => {
    const count = groups.get(id);
    if (count !== undefined) return { id, kind: "group", count };
    const change = changeByPath.get(id);
    const kind: NodeKind = !graph.modules.has(id) ? "external" : isTestFile(id) ? "test" : "source";
    return { id, kind, ...(change ? { change } : {}), ...(barrels.has(id) ? { barrel: true } : {}) };
  });

  return {
    level: "file",
    nodes,
    edges: [...touching, ...extraEdges].filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
    outsideGraph,
    omittedNodes:
      neighbours.length - keptNeighbours.length + (changedInGraph.length - keptChanged.length),
  };
}

export async function analyzeDependencies(
  cwd: string,
  changed: ChangedFile[],
  config: XrayConfig,
): Promise<DependencyAnalysis> {
  const warnings: string[] = [];
  const result = await cruiseProject(cwd, config, warnings);
  const graph = toGraph(result, config.dependencies.includeExternal, repoPathResolver(cwd));
  const isBarrel = (path: string) => {
    try {
      return isReExportOnly(readFileSync(join(cwd, path), "utf8"));
    } catch {
      return false;
    }
  };
  return { ...selectNeighbourhood(graph, changed, config.dependencies.maxNodes, isBarrel), warnings };
}
