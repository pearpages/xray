import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { XrayConfig } from "../config.js";
import { isTestFile } from "../dependencies/analyze.js";
import type { InteractionsAnalysis } from "../interactions/analyze.js";
import type { ChangedCode } from "../interactions/changed-code.js";
import type { Unit } from "../interactions/units.js";
import { cyclomaticComplexity } from "./complexity.js";

export type Light = "green" | "yellow" | "red";

/** The strongest sign that a test exercises a unit; no test is run to find it. */
export type TestEvidence =
  | { kind: "direct"; tests: string[] }
  | { kind: "by-name"; tests: string[] }
  | { kind: "indirect"; via: string; depth: number; tests: string[] }
  | { kind: "none" };

export interface UnitRisk {
  id: string;
  file: string;
  name: string;
  change: "modified" | "added";
  light: Light;
  evidence: TestEvidence;
  /** Undefined `before` for new units. */
  complexity: { before?: number; after: number };
}

export interface FeatureRisk {
  id: string;
  name: string;
  light: Light;
  units: string[];
}

export interface RiskAnalysis {
  light: Light;
  units: UnitRisk[];
  features: FeatureRisk[];
  /** Features whose changed units no test reaches. */
  untestedFeatures: string[];
  /** Units whose complexity grew, biggest growth first. */
  growing: string[];
  skipped?: { reason: "too-many-units"; limit: number };
}

const ORDER: Record<Light, number> = { green: 0, yellow: 1, red: 2 };

export function worst(lights: Light[]): Light {
  return lights.reduce<Light>((a, b) => (ORDER[b] > ORDER[a] ? b : a), "green");
}

/** The ADR-0007 table. */
export function lightFor(
  evidence: TestEvidence["kind"],
  complexity: UnitRisk["complexity"],
  settings: XrayConfig["risk"],
): Light {
  const growth = complexity.before === undefined ? 0 : complexity.after - complexity.before;
  const high = complexity.after >= settings.complexityHigh;
  if (evidence === "none") return high || growth >= settings.complexityJump ? "red" : "yellow";
  if ((evidence === "indirect" && growth > 0) || (high && growth > 0)) return "yellow";
  return "green";
}

/** `src/a/Cart.test.tsx` or `src/a/__tests__/Cart.spec.ts` for `src/a/Cart.tsx`. */
function testsNamedAfter(cwd: string, file: string): string[] {
  const dir = dirname(file);
  const stem = basename(file, extname(file));
  const found: string[] = [];
  for (const folder of [dir, join(dir, "__tests__")]) {
    for (const kind of ["test", "spec"]) {
      for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
        const candidate = join(folder, `${stem}.${kind}${ext}`);
        if (existsSync(join(cwd, candidate))) found.push(candidate.split("\\").join("/"));
      }
    }
  }
  return found;
}

export function analyzeRisk(
  cwd: string,
  code: ChangedCode | undefined,
  interactions: InteractionsAnalysis,
  config: XrayConfig,
): RiskAnalysis {
  const settings = config.risk;
  const result: RiskAnalysis = { light: "green", units: [], features: [], untestedFeatures: [], growing: [] };
  if (!code || code.touched.length === 0) return result;
  if (interactions.skipped) {
    result.skipped = interactions.skipped;
    return result;
  }

  const testsCache = new Map<string, string[]>();
  /** Test files that reference the unit by name. */
  const testsReferencing = (unit: Unit): string[] => {
    let tests = testsCache.get(unit.id);
    if (!tests) {
      const files = (unit.nameNode?.findReferencesAsNodes() ?? [])
        .map((reference) => code.loaded.fileOf(reference.getSourceFile()))
        .filter((file): file is string => file !== undefined && isTestFile(file));
      tests = [...new Set(files)].sort();
      testsCache.set(unit.id, tests);
    }
    return tests;
  };

  const evidenceFor = (unit: Unit): TestEvidence => {
    const direct = testsReferencing(unit);
    if (direct.length > 0) return { kind: "direct", tests: direct };
    const named = testsNamedAfter(cwd, unit.file);
    if (named.length > 0) return { kind: "by-name", tests: named };
    // Nearest tested caller, breadth first.
    const seen = new Set([unit.id]);
    let level = [unit];
    for (let depth = 1; depth <= settings.indirectDepth && level.length > 0; depth++) {
      const next: Unit[] = [];
      for (const caller of level.flatMap((current) => code.walker.callersOf(current).map((link) => link.unit))) {
        if (seen.has(caller.id)) continue;
        seen.add(caller.id);
        const tests = testsReferencing(caller);
        const evidence = tests.length > 0 ? tests : testsNamedAfter(cwd, caller.file);
        if (evidence.length > 0) return { kind: "indirect", via: caller.id, depth, tests: evidence };
        next.push(caller);
      }
      level = next;
    }
    return { kind: "none" };
  };

  for (const unit of code.touched) {
    const before = code.baseOf.get(unit.id);
    const complexity = {
      ...(before ? { before: cyclomaticComplexity(before.node) } : {}),
      after: cyclomaticComplexity(unit.node),
    };
    const evidence = evidenceFor(unit);
    result.units.push({
      id: unit.id,
      file: unit.file,
      name: unit.name,
      change: before ? "modified" : "added",
      light: lightFor(evidence.kind, complexity, settings),
      evidence,
      complexity,
    });
  }

  const byId = new Map(result.units.map((unit) => [unit.id, unit]));
  result.features = interactions.features.map((feature) => ({
    id: feature.id,
    name: feature.name,
    light: worst(feature.touched.map((id) => byId.get(id)?.light ?? "green")),
    units: feature.touched,
  }));
  result.untestedFeatures = result.features
    .filter((feature) => feature.units.every((id) => byId.get(id)?.evidence.kind === "none"))
    .map((feature) => feature.id);
  result.growing = result.units
    .filter((unit) => unit.complexity.before !== undefined && unit.complexity.after > unit.complexity.before)
    .sort((a, b) => b.complexity.after - b.complexity.before! - (a.complexity.after - a.complexity.before!))
    .map((unit) => unit.id);
  result.light = worst(result.units.map((unit) => unit.light));
  return result;
}
