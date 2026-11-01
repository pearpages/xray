import { join, matchesGlob } from "node:path";
import { Project } from "ts-morph";
import type { XrayConfig } from "../config.js";
import { isTestFile } from "../dependencies/analyze.js";
import { showFile, type ChangedFile, type LineRange } from "../git.js";
import { featuresFor, loadFeatureMap, type FeatureDefinition } from "./features.js";
import { loadProject } from "./project.js";
import { unitsOf, UnitIndex, type Unit } from "./units.js";
import { walkDown, walkUp, Walker, type Interaction, type UpWalk } from "./walk.js";

export interface InteractionUnit {
  id: string;
  file: string;
  name: string;
  /** Set on units the PR touched: `added` when the unit did not exist on the base. */
  change?: "modified" | "added";
}

export interface FeatureImpact {
  id: string;
  name: string;
  description?: string;
  /** False when the feature is an entry point standing in for a missing map entry. */
  mapped: boolean;
  entryPoints: string[];
  touched: string[];
  interactions: Interaction[];
}

export interface InteractionsAnalysis {
  featureMap: "found" | "missing" | "invalid";
  /** Every unit that appears in a feature, keyed by id. */
  units: Record<string, InteractionUnit>;
  features: FeatureImpact[];
  /** Touched units no feature of the map covers (only when the map was found). */
  unmapped: string[];
  /** Units the PR removed (`path#name` on the base). */
  deleted: string[];
  /** Touched unit ids, also when the walk was skipped. */
  touched: string[];
  skipped?: { reason: "too-many-units"; limit: number };
  warnings: string[];
}

const CODE_FILE = /\.(c|m)?[jt]sx?$/;
const STORY_FILE = /\.stories\.[cm]?[jt]sx?$/;

export function splitUnitId(id: string): { file: string; name: string } {
  const at = id.lastIndexOf("#");
  return { file: id.slice(0, at), name: id.slice(at + 1) };
}

function overlaps(unit: Unit, ranges: LineRange[]): boolean {
  const from = unit.statement.getStartLineNumber();
  const to = unit.statement.getEndLineNumber();
  return ranges.some(([start, end]) => start <= to && end >= from);
}

/** Unit names per file on the base, parsed from `git show` without touching the working tree. */
function baseUnitNames(cwd: string, mergeBase: string, files: ChangedFile[]): Map<string, Set<string>> {
  const scratch = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const names = new Map<string, Set<string>>();
  for (const file of files) {
    if (file.status === "added") continue;
    const path = file.previousPath ?? file.path;
    const text = showFile(cwd, mergeBase, path);
    if (text === undefined) continue;
    const sourceFile = scratch.createSourceFile(`/${path}`, text, { overwrite: true });
    names.set(file.path, new Set(unitsOf(sourceFile, path).map((unit) => unit.name)));
  }
  return names;
}

/** Edges of an upward walk that lie on a path starting at one of `starts`. */
function reachableFrom(starts: string[], interactions: Interaction[]): Interaction[] {
  const reached = new Set(starts);
  let grew = true;
  while (grew) {
    grew = false;
    for (const interaction of interactions) {
      if (reached.has(interaction.from) && !reached.has(interaction.to)) {
        reached.add(interaction.to);
        grew = true;
      }
    }
  }
  return interactions.filter((interaction) => reached.has(interaction.from));
}

interface FeatureDraft {
  id: string;
  name: string;
  description?: string;
  mapped: boolean;
  entryPoints: Set<string>;
  touched: Set<string>;
  interactions: Map<string, Interaction>;
}

export async function analyzeInteractions(
  cwd: string,
  changed: ChangedFile[],
  changedLines: Map<string, LineRange[]>,
  mergeBase: string,
  config: XrayConfig,
): Promise<InteractionsAnalysis> {
  const settings = config.interactions;
  const ignored = (file: string) =>
    isTestFile(file) || STORY_FILE.test(file) || settings.ignore.some((glob) => matchesGlob(file, glob));
  const codeChanges = changed.filter((file) => CODE_FILE.test(file.path) && !ignored(file.path));
  const result: InteractionsAnalysis = {
    featureMap: "missing",
    units: {},
    features: [],
    unmapped: [],
    deleted: [],
    touched: [],
    warnings: [],
  };
  if (codeChanges.length === 0) return result;

  const loaded = loadProject(cwd, config);
  result.warnings.push(...loaded.warnings);
  const units = new UnitIndex(loaded.fileOf);
  const base = baseUnitNames(cwd, mergeBase, codeChanges);

  const touched: Unit[] = [];
  for (const file of codeChanges) {
    const before = base.get(file.path);
    const sourceFile =
      file.status === "deleted" ? undefined : loaded.project.getSourceFile(join(cwd, file.path));
    const now = sourceFile ? units.of(sourceFile) : [];
    const nowNames = new Set(now.map((unit) => unit.name));
    for (const name of before ?? []) {
      if (!nowNames.has(name)) result.deleted.push(`${file.previousPath ?? file.path}#${name}`);
    }
    for (const unit of now) {
      if (!overlaps(unit, changedLines.get(file.path) ?? [])) continue;
      touched.push(unit);
      result.units[unit.id] = {
        id: unit.id,
        file: unit.file,
        name: unit.name,
        change: before?.has(unit.name) ? "modified" : "added",
      };
    }
  }
  result.touched = touched.map((unit) => unit.id);

  if (touched.length > settings.maxTouchedUnits) {
    result.skipped = { reason: "too-many-units", limit: settings.maxTouchedUnits };
    return result;
  }
  if (touched.length === 0) return result;

  const featureMap = loadFeatureMap(cwd, settings.featureMap);
  result.featureMap = featureMap.status;
  if (featureMap.status === "invalid") result.warnings.push(featureMap.error);
  const map = featureMap.status === "found" ? featureMap.map : undefined;
  const mapEntries = new Set(map?.features.flatMap((feature) => feature.entryPoints) ?? []);
  const isEntry = (unit: Unit) =>
    mapEntries.has(unit.id) || settings.entryGlobs.some((glob) => matchesGlob(unit.file, glob));

  const walker = new Walker(loaded.project, loaded.resolveModule, units, loaded.fileOf, ignored);
  const drafts = new Map<string, FeatureDraft>();
  const draftFor = (key: string, make: () => Omit<FeatureDraft, "entryPoints" | "touched" | "interactions">) => {
    let draft = drafts.get(key);
    if (!draft) {
      draft = { ...make(), entryPoints: new Set(), touched: new Set(), interactions: new Map() };
      drafts.set(key, draft);
    }
    return draft;
  };
  const addTo = (draft: FeatureDraft, unit: Unit, starts: string[], up: UpWalk, down: Interaction[]) => {
    draft.touched.add(unit.id);
    starts.forEach((start) => draft.entryPoints.add(start));
    for (const interaction of [...reachableFrom(starts, up.interactions), ...down]) {
      draft.interactions.set(`${interaction.from}>${interaction.to}`, interaction);
    }
  };
  const fromMap = (feature: FeatureDefinition) => () => ({
    id: feature.id,
    name: feature.name,
    description: feature.description,
    mapped: true,
  });
  const fromEntry = (root: string) => () => {
    const { file, name } = splitUnitId(root);
    return { id: root, name: name === "default" ? file.split("/").pop()! : name, mapped: false };
  };

  for (const unit of touched) {
    const up = walkUp(walker, unit, isEntry, settings.depthUp);
    const down = walkDown(walker, unit, settings.depthDown);
    const owners = map ? featuresFor(map, up.roots, unit.file) : [];
    if (map && owners.length === 0) result.unmapped.push(unit.id);
    if (owners.length > 0) {
      for (const feature of owners) {
        const starts = feature.entryPoints.filter((entry) => up.roots.includes(entry));
        addTo(draftFor(`map:${feature.id}`, fromMap(feature)), unit, starts.length ? starts : [unit.id], up, down);
      }
    } else {
      for (const root of up.roots) addTo(draftFor(`entry:${root}`, fromEntry(root)), unit, [root], up, down);
    }
  }

  for (const draft of drafts.values()) {
    for (const interaction of draft.interactions.values()) {
      for (const id of [interaction.from, interaction.to]) {
        if (!result.units[id]) result.units[id] = { id, ...splitUnitId(id) };
      }
    }
    for (const id of draft.entryPoints) {
      if (!result.units[id]) result.units[id] = { id, ...splitUnitId(id) };
    }
  }

  result.features = [...drafts.values()]
    .map((draft) => ({
      id: draft.id,
      name: draft.name,
      ...(draft.description ? { description: draft.description } : {}),
      mapped: draft.mapped,
      entryPoints: [...draft.entryPoints],
      touched: [...draft.touched],
      interactions: [...draft.interactions.values()],
    }))
    .sort((a, b) => Number(b.mapped) - Number(a.mapped) || b.touched.length - a.touched.length || a.name.localeCompare(b.name));
  return result;
}
