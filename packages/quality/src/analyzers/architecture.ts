import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, matchesGlob, posix } from "node:path";
import { buildDependencyGraph, loadFeatureMap, type DependencyEdge } from "@xray/core";
import type { QualityConfig } from "../config.js";
import { findingsScore, unavailable } from "../score.js";
import type { Analyzer, Finding } from "../types.js";

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
function featuresFromMap(root: string, config: QualityConfig, codeFiles: string[]): Feature[] {
  const map = loadFeatureMap(root, config.xray.interactions.featureMap);
  if (map.status !== "found") return [];
  return map.map.features
    .filter((feature) => (feature.files ?? []).length > 0)
    .map((feature) => {
      const globs = feature.files ?? [];
      const entryFiles = feature.entryPoints.map((entry) => entry.slice(0, entry.lastIndexOf("#")));
      const files = codeFiles.filter((file) => entryFiles.includes(file) || globs.some((glob) => matchesGlob(file, glob)));
      const bases = globs.map(staticBase);
      const publicApi = files.filter(
        (file) => entryFiles.includes(file) || bases.some((base) => isPublicIn(base, file, config.architecture.publicApi)),
      );
      return { id: feature.id, name: feature.name, files, publicApi };
    })
    .filter((feature) => feature.files.length > 0);
}

/** Features from folders matching `architecture.features`: the outermost matching folder owns a file. */
function featuresFromFolders(config: QualityConfig, codeFiles: string[]): Feature[] {
  const byFolder = new Map<string, string[]>();
  for (const file of codeFiles) {
    const parts = file.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join("/");
      if (config.architecture.features.some((glob) => matchesGlob(folder, glob))) {
        // Shared code (`_shared`, `common`) isn't a feature: anyone may import it.
        if (!config.architecture.shared.some((pattern) => matchesGlob(basename(folder), pattern))) {
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
    publicApi: files.filter((file) => isPublicIn(folder, file, config.architecture.publicApi)),
  }));
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

export const architecture: Analyzer = {
  id: "architecture",
  name: "Architecture",
  phase: 1,
  async analyze({ root, config, codeFiles }) {
    const fromMap = config.architecture.useFeatureMap ? featuresFromMap(root, config, codeFiles) : [];
    const source = fromMap.length >= 2 ? "feature map" : "folders";
    const features = fromMap.length >= 2 ? fromMap : featuresFromFolders(config, codeFiles);
    if (features.length < 2) {
      return unavailable(
        "architecture",
        "Architecture",
        `fewer than two features (no xray.features.json features with \`files\`, and no folders matching ${config.architecture.features.join(", ")})`,
      );
    }
    const owner = new Map<string, Feature>();
    for (const feature of features) for (const file of feature.files) if (!owner.has(file)) owner.set(file, feature);

    const graph = await buildDependencyGraph(root, config.xray);
    const crossing = graph.edges.filter((edge) => {
      const from = owner.get(edge.from);
      const to = owner.get(edge.to);
      return from && to && from !== to;
    });
    const groups = new Map<string, FeatureViolations>();
    const findings: Finding[] = [];
    for (const edge of crossing) {
      const from = owner.get(edge.from)!;
      const to = owner.get(edge.to)!;
      if (to.publicApi.includes(edge.to)) continue;
      const line = importLine(root, edge.from, edge.to);
      findings.push({
        file: edge.from,
        ...(line ? { line } : {}),
        severity: "medium",
        message:
          `imports ${edge.to}, inside feature "${to.name}"; go through its public API` +
          (to.publicApi.length > 0 ? ` (${to.publicApi.map((file) => posix.basename(file)).join(", ")})` : " (it has none: add an index file)"),
      });
      const key = `${from.id}\0${to.id}`;
      const group = groups.get(key) ?? { from: from.id, to: to.id, imports: [] };
      group.imports.push({ file: edge.from, imports: edge.to, ...(line ? { line } : {}) });
      groups.set(key, group);
    }

    // Two features importing each other, public API or not.
    const pairs = new Map<string, DependencyEdge>();
    for (const edge of crossing) pairs.set(`${owner.get(edge.from)!.id}\0${owner.get(edge.to)!.id}`, edge);
    const cycles: [string, string][] = [];
    for (const [key, edge] of pairs) {
      const [a, b] = key.split("\0") as [string, string];
      if (a < b && pairs.has(`${b}\0${a}`)) {
        cycles.push([a, b]);
        const names = [owner.get(edge.from)!.name, owner.get(edge.to)!.name];
        findings.push({ file: edge.from, severity: "high", message: `features "${names[0]}" and "${names[1]}" import each other` });
      }
    }

    const deep = findings.filter((finding) => finding.severity === "medium").length;
    return {
      id: "architecture",
      name: "Architecture",
      score: findingsScore(findings, codeFiles.length, config.severityPenalty),
      summary:
        deep === 0 && cycles.length === 0
          ? `${features.length} features (from ${source}); every import between them goes through a public API.`
          : `${features.length} features (from ${source}): ${deep} deep import(s), ${cycles.length} cycle(s) between features.`,
      findings,
      status: "ok",
      data: {
        source,
        features: features.map((feature) => ({ id: feature.id, name: feature.name, files: feature.files.length, publicApi: feature.publicApi })),
        violations: [...groups.values()],
        cycles,
      },
    };
  },
};
