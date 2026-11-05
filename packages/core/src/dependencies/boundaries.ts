import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, matchesGlob, posix } from "node:path";
import { loadFeatureMap } from "../interactions/features.js";
import type { BoundaryViolation } from "./analyze.js";
import type { DependencyEdge } from "./graph.js";

/**
 * Feature boundaries (ADR-0021): which folders or feature-map features are features, and the
 * imports between them that skip a public API or form a cycle. Shared by the quality report's
 * architecture metric (whole repository) and the PR report's dependencies (changed files).
 */

/** The `quality.architecture` section of `xray.config.json`. */
export interface BoundaryConfig {
  /** Globs of feature folders. */
  features: string[];
  /** Globs, relative to a feature folder, of the files that are its public API. */
  publicApi: string[];
  /** Names of folders among the features that are shared code, importable by any feature. */
  shared: string[];
  /** Use xray.features.json features that declare `files`, when present. */
  useFeatureMap: boolean;
}

export const DEFAULT_BOUNDARIES: BoundaryConfig = {
  features: ["**/features/*"],
  publicApi: ["index.{ts,tsx,js,jsx,mts,mjs}"],
  shared: ["_*", "shared", "common"],
  useFeatureMap: true,
};

export interface Feature {
  id: string;
  name: string;
  files: string[];
  /** Files other features may import. */
  publicApi: string[];
}

export interface FeatureViolations {
  from: string;
  to: string;
  imports: { file: string; imports: string; line?: number }[];
}

const GLOB_CHAR = /[*?[{]/;

/** `src/features/cart/**` → `src/features/cart`: the folder before the first wildcard. */
function staticBase(glob: string): string {
  const parts = glob.split("/");
  const at = parts.findIndex((part) => GLOB_CHAR.test(part));
  return (at === -1 ? parts.slice(0, -1) : parts.slice(0, at)).join("/");
}

const isPublicIn = (folder: string, file: string, patterns: string[]) =>
  dirname(file) === folder && patterns.some((pattern) => matchesGlob(basename(file), pattern));

/** Features from the map, when its features declare `files`: their code, entry points and index files. */
export function featuresFromMap(root: string, featureMap: string, config: BoundaryConfig, codeFiles: string[]): Feature[] {
  const map = loadFeatureMap(root, featureMap);
  if (map.status !== "found") return [];
  return map.map.features
    .filter((feature) => (feature.files ?? []).length > 0)
    .map((feature) => {
      const globs = feature.files ?? [];
      const entryFiles = feature.entryPoints.map((entry) => entry.slice(0, entry.lastIndexOf("#")));
      const files = codeFiles.filter((file) => entryFiles.includes(file) || globs.some((glob) => matchesGlob(file, glob)));
      const bases = globs.map(staticBase);
      const publicApi = files.filter(
        (file) => entryFiles.includes(file) || bases.some((base) => isPublicIn(base, file, config.publicApi)),
      );
      return { id: feature.id, name: feature.name, files, publicApi };
    })
    .filter((feature) => feature.files.length > 0);
}

/** Features from folders matching `features`: the outermost matching folder owns a file. */
export function featuresFromFolders(config: BoundaryConfig, codeFiles: string[]): Feature[] {
  const byFolder = new Map<string, string[]>();
  for (const file of codeFiles) {
    const parts = file.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join("/");
      if (config.features.some((glob) => matchesGlob(folder, glob))) {
        // Shared code (`_shared`, `common`) isn't a feature: anyone may import it.
        if (!config.shared.some((pattern) => matchesGlob(basename(folder), pattern))) {
          byFolder.set(folder, [...(byFolder.get(folder) ?? []), file]);
        }
        break;
      }
    }
  }
  return [...byFolder].sort(([a], [b]) => a.localeCompare(b)).map(([folder, files]) => ({
    id: folder,
    name: basename(folder),
    files,
    publicApi: files.filter((file) => isPublicIn(folder, file, config.publicApi)),
  }));
}

/** The map's features when it declares at least two with `files`, else the feature folders. */
export function detectFeatures(
  root: string,
  featureMap: string,
  config: BoundaryConfig,
  codeFiles: string[],
): { source: "feature map" | "folders"; features: Feature[] } {
  const fromMap = config.useFeatureMap ? featuresFromMap(root, featureMap, config, codeFiles) : [];
  return fromMap.length >= 2 ? { source: "feature map", features: fromMap } : { source: "folders", features: featuresFromFolders(config, codeFiles) };
}

/** The line of `file` that imports `target`, best effort: a specifier ending like the target. */
export function importLine(root: string, file: string, target: string): number | undefined {
  const stem = basename(target, extname(target));
  const tail = stem === "index" ? basename(dirname(target)) : stem;
  try {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    const at = lines.findIndex((line) => /\b(import|from|require)\b/.test(line) && new RegExp(`['"][^'"]*\\b${tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[a-z]+)?['"]`).test(line));
    return at === -1 ? undefined : at + 1;
  } catch {
    return undefined;
  }
}

export interface BoundaryCheck {
  /** Deep imports first, in edge order, then cycles. */
  violations: BoundaryViolation[];
  /** Deep imports grouped by feature pair, for the UI. */
  groups: FeatureViolations[];
  /** Feature id pairs that import each other. */
  cycles: [string, string][];
}

/**
 * Imports between features that skip the target's public API (`deep`), and feature pairs that
 * import each other (`cycle`). With `from`, only imports from those files are reported (the
 * PR's changed files); cycles still look at every import, since the other direction may be old.
 */
export function checkBoundaries(root: string, features: Feature[], edges: DependencyEdge[], from?: Set<string>): BoundaryCheck {
  const owner = new Map<string, Feature>();
  for (const feature of features) for (const file of feature.files) if (!owner.has(file)) owner.set(file, feature);
  const crossing = edges.filter((edge) => {
    const a = owner.get(edge.from);
    const b = owner.get(edge.to);
    return a && b && a !== b;
  });
  const reported = (edge: DependencyEdge) => !from || from.has(edge.from);

  const groups = new Map<string, FeatureViolations>();
  const violations: BoundaryViolation[] = [];
  for (const edge of crossing) {
    if (!reported(edge)) continue;
    const a = owner.get(edge.from)!;
    const b = owner.get(edge.to)!;
    if (b.publicApi.includes(edge.to)) continue;
    const line = importLine(root, edge.from, edge.to);
    violations.push({
      kind: "deep",
      file: edge.from,
      ...(line ? { line } : {}),
      imports: edge.to,
      message:
        `imports ${edge.to}, inside feature "${b.name}"; go through its public API` +
        (b.publicApi.length > 0 ? ` (${b.publicApi.map((file) => posix.basename(file)).join(", ")})` : " (it has none: add an index file)"),
    });
    const key = `${a.id}\0${b.id}`;
    const group = groups.get(key) ?? { from: a.id, to: b.id, imports: [] };
    group.imports.push({ file: edge.from, imports: edge.to, ...(line ? { line } : {}) });
    groups.set(key, group);
  }

  // Two features importing each other, public API or not: one finding per pair.
  const pairs = new Map<string, DependencyEdge[]>();
  for (const edge of crossing) {
    const key = `${owner.get(edge.from)!.id}\0${owner.get(edge.to)!.id}`;
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  }
  const cycles: [string, string][] = [];
  for (const [key, list] of pairs) {
    const [a, b] = key.split("\0") as [string, string];
    if (a >= b || !pairs.has(`${b}\0${a}`)) continue;
    // The whole repository keeps its old pick, the last a → b import; a PR, its first own import.
    const edge = from ? [...list, ...pairs.get(`${b}\0${a}`)!].find(reported) : list.at(-1);
    if (!edge) continue;
    cycles.push([a, b]);
    const names = [owner.get(edge.from)!.name, owner.get(edge.to)!.name];
    violations.push({ kind: "cycle", file: edge.from, imports: edge.to, message: `features "${names[0]}" and "${names[1]}" import each other` });
  }
  return { violations, groups: [...groups.values()], cycles };
}
