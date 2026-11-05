import { matchesGlob } from "node:path";
import type { XrayConfig } from "../config.js";
import type { ChangedCode } from "./changed-code.js";
import { splitUnitId } from "./ids.js";
import { featuresFor, loadFeatureMap, type FeatureDefinition } from "./features.js";
import { isEntryUnit, type Unit } from "./units.js";
import { walkDown, walkUp, type DownWalk, type Interaction, type UpWalk } from "./walk.js";

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
  /** Callees not drawn per unit (`maxCallees`). */
  hiddenCallees: Record<string, number>;
  /** Set when the feature stands for a shared unit: every unit that uses it. */
  sharedBy?: string[];
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

export { splitUnitId };

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
  hiddenCallees: Map<string, number>;
  sharedBy?: string[];
}

export function analyzeInteractions(
  cwd: string,
  code: ChangedCode | undefined,
  config: XrayConfig,
): InteractionsAnalysis {
  const settings = config.interactions;
  const result: InteractionsAnalysis = {
    featureMap: "missing",
    units: {},
    features: [],
    unmapped: [],
    deleted: [],
    touched: [],
    warnings: [],
  };
  if (!code) return result;

  const { touched, walker } = code;
  result.warnings.push(...code.loaded.warnings);
  result.deleted = code.deleted;
  for (const unit of touched) {
    result.units[unit.id] = {
      id: unit.id,
      file: unit.file,
      name: unit.name,
      change: code.baseOf.has(unit.id) ? "modified" : "added",
    };
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
    mapEntries.has(unit.id) ||
    (settings.entryGlobs.some((glob) => matchesGlob(unit.file, glob)) &&
      isEntryUnit(unit, code.units.of(unit.node.getSourceFile()), () => code.walker.callersOf(unit).length));

  const drafts = new Map<string, FeatureDraft>();
  type DraftHead = Omit<FeatureDraft, "entryPoints" | "touched" | "interactions" | "hiddenCallees">;
  const draftFor = (key: string, make: () => DraftHead) => {
    let draft = drafts.get(key);
    if (!draft) {
      draft = { ...make(), entryPoints: new Set(), touched: new Set(), interactions: new Map(), hiddenCallees: new Map() };
      drafts.set(key, draft);
    }
    return draft;
  };
  const addTo = (draft: FeatureDraft, unit: Unit, starts: string[], up: UpWalk, down: DownWalk) => {
    draft.touched.add(unit.id);
    starts.forEach((start) => draft.entryPoints.add(start));
    for (const interaction of [...reachableFrom(starts, up.interactions), ...down.interactions]) {
      draft.interactions.set(`${interaction.from}>${interaction.to}`, interaction);
    }
    down.hidden.forEach((count, id) => draft.hiddenCallees.set(id, count));
  };
  const fromMap = (feature: FeatureDefinition) => () => ({
    id: feature.id,
    name: feature.name,
    description: feature.description,
    mapped: true,
  });
  const fromEntry = (root: string, sharedBy?: string[]) => () => {
    const { file, name } = splitUnitId(root);
    const label = name === "default" ? file.split("/").pop()! : name;
    return sharedBy
      ? { id: root, name: `${label} (shared by ${sharedBy.length})`, mapped: false, sharedBy }
      : { id: root, name: label, mapped: false };
  };

  for (const unit of touched) {
    // With a map, features are bounded by the map, so hubs don't need cutting.
    const up = walkUp(walker, unit, isEntry, settings.depthUp, map ? undefined : settings.hubCallers);
    const down = walkDown(walker, unit, settings.depthDown, settings.maxCallees);
    const owners = map ? featuresFor(map, up.roots, unit.file) : [];
    if (map && owners.length === 0) result.unmapped.push(unit.id);
    if (owners.length > 0) {
      for (const feature of owners) {
        const starts = feature.entryPoints.filter((entry) => up.roots.includes(entry));
        addTo(draftFor(`map:${feature.id}`, fromMap(feature)), unit, starts.length ? starts : [unit.id], up, down);
      }
    } else {
      for (const root of up.roots) {
        addTo(draftFor(`entry:${root}`, fromEntry(root, up.hubs.get(root))), unit, [root], up, down);
      }
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
      hiddenCallees: Object.fromEntries(draft.hiddenCallees),
      ...(draft.sharedBy ? { sharedBy: draft.sharedBy } : {}),
    }))
    .sort((a, b) => Number(b.mapped) - Number(a.mapped) || b.touched.length - a.touched.length || a.name.localeCompare(b.name));
  return result;
}
