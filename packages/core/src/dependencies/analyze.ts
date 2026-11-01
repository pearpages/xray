import { existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { cruise, type ICruiseResult, type IDependency } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import type { XrayConfig } from "../config.js";
import type { ChangedFile, ChangeStatus } from "../git.js";
import { discoverWorkspace, workspaceAliases } from "../workspaces.js";

export type NodeKind = "source" | "test" | "external";

export interface DependencyNode {
  /** Repo-relative path, or the package name for external nodes. */
  id: string;
  kind: NodeKind;
  /** Set when the file is part of the diff. */
  change?: ChangeStatus;
}

export interface DependencyEdge {
  from: string;
  to: string;
  typeOnly: boolean;
  dynamic: boolean;
}

export interface DependencyAnalysis {
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
export function selectNeighbourhood(
  graph: Graph,
  changed: ChangedFile[],
  maxNodes: number,
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
  const neighbours = [...weight.entries()]
    .sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b))
    .map(([path]) => path);

  const keptChanged = changedInGraph.slice(0, maxNodes);
  const keptNeighbours = neighbours.slice(0, Math.max(0, maxNodes - keptChanged.length));
  const kept = new Set([...keptChanged, ...keptNeighbours]);

  const nodes: DependencyNode[] = [...kept].sort().map((id) => {
    const change = changeByPath.get(id);
    const kind: NodeKind = !graph.modules.has(id) ? "external" : isTestFile(id) ? "test" : "source";
    return change ? { id, kind, change } : { id, kind };
  });

  return {
    nodes,
    edges: touching.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
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
  return { ...selectNeighbourhood(graph, changed, config.dependencies.maxNodes), warnings };
}
