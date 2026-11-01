import { existsSync, readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";

export interface FeatureDefinition {
  id: string;
  name: string;
  description?: string;
  /** Unit ids (`path#name`) where the feature starts: pages, routes, screens. */
  entryPoints: string[];
  /** Globs of files that belong to the feature even when no walk reaches its entry points. */
  files?: string[];
}

export interface FeatureMap {
  version: 1;
  features: FeatureDefinition[];
}

export type FeatureMapStatus =
  | { status: "found"; map: FeatureMap }
  | { status: "missing" }
  | { status: "invalid"; error: string };

function validate(value: unknown): FeatureMap {
  const map = value as Partial<FeatureMap>;
  if (map?.version !== 1) throw new Error('"version" must be 1');
  if (!Array.isArray(map.features)) throw new Error('"features" must be an array');
  const ids = new Set<string>();
  map.features.forEach((feature, index) => {
    const at = `features[${index}]`;
    if (typeof feature?.id !== "string" || !feature.id) throw new Error(`${at}.id must be a non-empty string`);
    if (ids.has(feature.id)) throw new Error(`${at}.id "${feature.id}" is duplicated`);
    ids.add(feature.id);
    if (typeof feature.name !== "string" || !feature.name) throw new Error(`${at}.name must be a non-empty string`);
    const entries = feature.entryPoints as unknown;
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !entry.includes("#"))) {
      throw new Error(`${at}.entryPoints must be an array of "path#name" strings`);
    }
    const files = feature.files as unknown;
    if (files !== undefined && (!Array.isArray(files) || files.some((glob) => typeof glob !== "string"))) {
      throw new Error(`${at}.files must be an array of globs`);
    }
  });
  return map as FeatureMap;
}

export function loadFeatureMap(cwd: string, path: string): FeatureMapStatus {
  const file = join(cwd, path);
  if (!existsSync(file)) return { status: "missing" };
  try {
    return { status: "found", map: validate(JSON.parse(readFileSync(file, "utf8"))) };
  } catch (error) {
    return { status: "invalid", error: `${path}: ${(error as Error).message}` };
  }
}

/** Features that own a touched unit: through an entry point its walk reached, or a file glob. */
export function featuresFor(map: FeatureMap, roots: string[], file: string): FeatureDefinition[] {
  return map.features.filter(
    (feature) =>
      feature.entryPoints.some((entry) => roots.includes(entry)) ||
      (feature.files ?? []).some((glob) => matchesGlob(file, glob)),
  );
}
