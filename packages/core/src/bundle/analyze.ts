import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { XrayConfig } from "../config.js";
import { git, showFile, type ChangedFile } from "../git.js";
import type { Light } from "../risk/analyze.js";
import { buildAt, BuildError, type BuildPlan } from "./build.js";
import { measure, type BuildMeasure, type Sizes } from "./measure.js";

export interface ChunkDiff {
  key: string;
  before?: Sizes;
  after?: Sizes;
}

export interface PackageDiff {
  name: string;
  /** Gzip-equivalent bytes: raw bytes from source maps × the PR build's gzip/raw ratio. */
  before: number;
  after: number;
}

export interface DependencyChange {
  file: string;
  name: string;
  before?: string;
  after?: string;
}

export interface BundleAnalysis {
  status: "disabled" | "measured" | "failed";
  error?: string;
  light?: Light;
  before?: Sizes;
  after?: Sizes;
  /** Chunks that changed size, biggest gzip change first. */
  chunks: ChunkDiff[];
  /** Packages whose share changed, biggest first; empty without source maps. */
  packages: PackageDiff[];
  sourceMaps: boolean;
  /** `dependencies` added, removed or re-versioned in any changed package.json. */
  dependencyChanges: DependencyChange[];
  plan?: BuildPlan;
  seconds?: number;
}

const delta = (diff: { before?: Sizes; after?: Sizes }) => (diff.after?.gzip ?? 0) - (diff.before?.gzip ?? 0);

function dependencies(text: string | undefined): Record<string, string> {
  if (!text) return {};
  try {
    return ((JSON.parse(text) as { dependencies?: Record<string, string> }).dependencies ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

function dependencyChanges(cwd: string, mergeBase: string, changed: ChangedFile[]): DependencyChange[] {
  const changes: DependencyChange[] = [];
  for (const file of changed.filter((candidate) => candidate.path.endsWith("package.json"))) {
    const before = dependencies(file.status === "added" ? undefined : showFile(cwd, mergeBase, file.previousPath ?? file.path));
    let after: Record<string, string> = {};
    try {
      after = file.status === "deleted" ? {} : dependencies(readFileSync(join(cwd, file.path), "utf8"));
    } catch {
      after = {};
    }
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[name] === after[name]) continue;
      changes.push({
        file: file.path,
        name,
        ...(before[name] ? { before: before[name] } : {}),
        ...(after[name] ? { after: after[name] } : {}),
      });
    }
  }
  return changes;
}

export function compareBuilds(before: BuildMeasure, after: BuildMeasure): Pick<BundleAnalysis, "chunks" | "packages" | "sourceMaps"> {
  const keys = new Set([...before.chunks, ...after.chunks].map((chunk) => chunk.key));
  const chunks = [...keys]
    .map((key) => {
      const was = before.chunks.find((chunk) => chunk.key === key)?.sizes;
      const now = after.chunks.find((chunk) => chunk.key === key)?.sizes;
      return { key, ...(was ? { before: was } : {}), ...(now ? { after: now } : {}) };
    })
    .filter((diff) => delta(diff) !== 0 || !diff.before || !diff.after)
    .sort((a, b) => Math.abs(delta(b)) - Math.abs(delta(a)));
  const names = new Set([...(before.packages?.keys() ?? []), ...(after.packages?.keys() ?? [])]);
  // One gzip/raw ratio for both builds: an unchanged package keeps its raw bytes, so it shows 0.
  const ratio = after.total.raw > 0 ? after.total.gzip / after.total.raw : 0;
  const packages = [...names]
    .map((name) => ({
      name,
      before: (before.packages?.get(name) ?? 0) * ratio,
      after: (after.packages?.get(name) ?? 0) * ratio,
    }))
    .filter((diff) => Math.round(diff.after - diff.before) !== 0)
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  return { chunks, packages, sourceMaps: Boolean(before.packages && after.packages) };
}

export function lightForGrowth(before: Sizes, after: Sizes, settings: XrayConfig["bundle"]): Light {
  const growth = after.gzip - before.gzip;
  const percent = before.gzip > 0 ? (growth / before.gzip) * 100 : growth > 0 ? Infinity : 0;
  if (growth > settings.thresholdBytes || percent > settings.thresholdPercent) return "red";
  return growth > 0 ? "yellow" : "green";
}

/**
 * Installs and builds the base and the PR in throwaway worktrees and compares their
 * output. Opt-in: it runs the project's own install and build scripts (PR code).
 */
export function analyzeBundle(cwd: string, mergeBase: string, changed: ChangedFile[], config: XrayConfig): BundleAnalysis {
  const empty = { chunks: [], packages: [], sourceMaps: false, dependencyChanges: [] };
  if (!config.bundle.enabled) return { status: "disabled", ...empty };
  const started = Date.now();
  const deps = dependencyChanges(cwd, mergeBase, changed);
  const sides: { measure: BuildMeasure; plan: BuildPlan }[] = [];
  try {
    for (const commit of [mergeBase, git(cwd, ["rev-parse", "HEAD"])]) {
      const build = buildAt(cwd, commit, config.bundle);
      try {
        sides.push({ measure: measure(build.outDir), plan: build.plan });
      } finally {
        build.dispose();
      }
    }
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    return { status: "failed", error: error.message, ...empty, dependencyChanges: deps };
  }
  const [base, head] = sides as [(typeof sides)[0], (typeof sides)[0]];
  return {
    status: "measured",
    light: lightForGrowth(base.measure.total, head.measure.total, config.bundle),
    before: base.measure.total,
    after: head.measure.total,
    ...compareBuilds(base.measure, head.measure),
    dependencyChanges: deps,
    plan: head.plan,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}
