import { matchesGlob, resolve } from "node:path";
import type { XrayConfig } from "../config.js";
import { isTestFile } from "../dependencies/analyze.js";
import { loadFeatureMap, type FeatureDefinition, type FeatureMapStatus } from "./features.js";
import { loadProject } from "./project.js";
import { UnitIndex, type Unit } from "./units.js";
import { Walker } from "./walk.js";
import { discoverWorkspace } from "../workspaces.js";

/** Why a unit might start a feature. */
export type CandidateReason = "entry-glob" | "unused-export" | "hub";

export interface EntryPointCandidate {
  id: string;
  file: string;
  name: string;
  reasons: CandidateReason[];
  /** Units that render, call, use, mount or read it (tests and stories excluded). */
  callers: number;
}

/** What the feature map skill needs: where features can start, and how the current map holds up. */
export interface Inventory {
  /** Absolute path of the analysed root. */
  root: string;
  /** Workspace packages, when the root is a workspace. */
  packages?: { name: string; dir: string }[];
  candidates: EntryPointCandidate[];
  featureMap: FeatureMapStatus;
  /** Map entry points that are not units in the code (renamed or deleted). */
  unknownEntryPoints: { feature: string; entryPoint: string }[];
  /** Entry-glob candidates no feature claims, by entry point or `files` glob. */
  uncovered: string[];
}

const STORY_FILE = /\.stories\.[cm]?[jt]sx?$/;

function covers(feature: FeatureDefinition, unit: { id: string; file: string }): boolean {
  return (
    feature.entryPoints.includes(unit.id) ||
    (feature.files ?? []).some((glob) => matchesGlob(unit.file, glob))
  );
}

/**
 * Lists entry point candidates and checks the feature map against the code.
 * Reads every exported unit's references, so it is slower than a PR run: it is
 * meant for the skill that writes the map, not for CI.
 */
export function inventory(cwd: string, config: XrayConfig): Inventory {
  const settings = config.interactions;
  const ignored = (file: string) =>
    isTestFile(file) || STORY_FILE.test(file) || settings.ignore.some((glob) => matchesGlob(file, glob));
  const loaded = loadProject(cwd, config);
  const units = new UnitIndex(loaded.fileOf);
  const walker = new Walker(loaded.project, loaded.resolveModule, units, loaded.fileOf, ignored);

  const all: Unit[] = [];
  for (const sourceFile of loaded.project.getSourceFiles()) {
    const file = loaded.fileOf(sourceFile);
    if (file === undefined || ignored(file)) continue;
    all.push(...units.of(sourceFile).filter((unit) => unit.kind === "code"));
  }

  const candidates: EntryPointCandidate[] = [];
  for (const unit of all) {
    const reasons: CandidateReason[] = [];
    if (settings.entryGlobs.some((glob) => matchesGlob(unit.file, glob))) reasons.push("entry-glob");
    const exported = unit.isDefaultExport || (Boolean(unit.nameNode) && isExported(unit));
    // Only exported units can be used from elsewhere; counting references is the slow part.
    const callers = reasons.length > 0 || exported ? walker.callersOf(unit).length : 0;
    if (exported && callers === 0 && reasons.length === 0) reasons.push("unused-export");
    if (callers > settings.hubCallers) reasons.push("hub");
    if (reasons.length > 0) candidates.push({ id: unit.id, file: unit.file, name: unit.name, reasons, callers });
  }

  const featureMap = loadFeatureMap(cwd, settings.featureMap);
  const ids = new Set(all.map((unit) => unit.id));
  const features = featureMap.status === "found" ? featureMap.map.features : [];
  const workspace = discoverWorkspace(cwd);
  return {
    root: resolve(cwd),
    ...(workspace ? { packages: workspace.map(({ name, dir }) => ({ name, dir })) } : {}),
    candidates,
    featureMap,
    unknownEntryPoints: features.flatMap((feature) =>
      feature.entryPoints.filter((entry) => !ids.has(entry)).map((entryPoint) => ({ feature: feature.id, entryPoint })),
    ),
    uncovered: featureMap.status === "found"
      ? candidates
          .filter((candidate) => candidate.reasons.includes("entry-glob"))
          .filter((candidate) => !features.some((feature) => covers(feature, candidate)))
          .map((candidate) => candidate.id)
      : [],
  };
}

function isExported(unit: Unit): boolean {
  const statement = unit.statement;
  return "isExported" in statement && typeof statement.isExported === "function" && statement.isExported();
}
