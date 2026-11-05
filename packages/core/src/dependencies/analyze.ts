import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { XrayConfig } from "../config.js";
import { isTestFile } from "../files.js";
import type { ChangedFile } from "../git.js";
import { checkBoundaries, detectFeatures } from "./boundaries.js";
import { buildDependencyGraph } from "./graph.js";
import { isReExportOnly, selectNeighbourhood, type Neighbourhood } from "./neighbourhood.js";

/** Analysis 1: the graph (`graph.ts`), the part of it the diagram shows (`neighbourhood.ts`), and feature boundaries. */
export interface DependencyAnalysis extends Neighbourhood {
  /**
   * Imports from changed files that break feature boundaries (ADR-0021); undefined when the
   * project has fewer than two features, so there are no boundaries to check.
   */
  boundaries?: BoundaryViolation[];
  warnings: string[];
}

export interface BoundaryViolation {
  /** `deep`: into another feature's internals; `cycle`: two features importing each other. */
  kind: "deep" | "cycle";
  /** The importing file. */
  file: string;
  line?: number;
  /** The imported file. */
  imports: string;
  message: string;
}

export async function analyzeDependencies(
  cwd: string,
  changed: ChangedFile[],
  config: XrayConfig,
): Promise<DependencyAnalysis> {
  const warnings: string[] = [];
  const graph = await buildDependencyGraph(cwd, config);
  const isBarrel = (path: string) => {
    try {
      return isReExportOnly(readFileSync(join(cwd, path), "utf8"));
    } catch {
      return false;
    }
  };
  const neighbourhood = selectNeighbourhood(graph, changed, config.dependencies.maxNodes, isBarrel);
  const codeFiles = [...graph.modules].filter((file) => !isTestFile(file)).sort();
  const { features } = detectFeatures(cwd, config.interactions.featureMap, config.boundaries, codeFiles);
  const touched = new Set(changed.filter((file) => file.status !== "deleted").map((file) => file.path));
  const boundaries = features.length >= 2 ? checkBoundaries(cwd, features, graph.edges, touched).violations : undefined;
  return { ...neighbourhood, ...(boundaries ? { boundaries } : {}), warnings };
}
