import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { XrayConfig } from "../config.js";
import { isTestFile } from "../dependencies/analyze.js";
import type { InteractionsAnalysis } from "../interactions/analyze.js";
import type { ChangedCode } from "../interactions/changed-code.js";
import type { Unit } from "../interactions/units.js";
import { cyclomaticComplexity } from "./complexity.js";
import { loadCoverage } from "./coverage.js";

import { evidenceStrength, worst, type Light } from "./lights.js";

export { evidenceStrength, worst, type Light };

/** The strongest sign that a test exercises a unit; no test is run to find it. */
export type TestEvidence =
  /** From an lcov report: covered lines among the unit's changed lines (or all its lines). */
  | {
      kind: "coverage";
      /** Lines that ran, with every branch on them taken when the report has branch data. */
      covered: number;
      total: number;
      scope: "changed lines" | "lines";
      /** Branches never taken on the measured lines. */
      untakenBranches: number;
    }
  | { kind: "direct"; tests: string[] }
  | { kind: "by-name"; tests: string[] }
  | { kind: "indirect"; via: string; depth: number; tests: string[] }
  | { kind: "none" };

export interface UnitRisk {
  id: string;
  file: string;
  /** First line of the unit's statement, 1-based. */
  line: number;
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
  /** lcov reports read, relative to the analysed root. */
  coverageFiles: string[];
  skipped?: { reason: "too-many-units"; limit: number };
}

/** The ADR-0007 table. */
export function lightFor(
  evidence: Exclude<TestEvidence["kind"], "coverage">,
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
  const result: RiskAnalysis = {
    light: "green",
    units: [],
    features: [],
    untestedFeatures: [],
    growing: [],
    coverageFiles: [],
  };
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

  const { coverage, files: coverageFiles } = loadCoverage(cwd, settings.coverage);
  result.coverageFiles = coverageFiles;
  /** Covered lines of the unit's changed lines, or of all its lines when no changed line is instrumented. */
  const coverageOf = (unit: Unit): TestEvidence | undefined => {
    const file = coverage?.get(unit.file);
    if (!file) return undefined;
    const { lines, branches } = file;
    const from = unit.statement.getStartLineNumber();
    const to = unit.statement.getEndLineNumber();
    const inUnit = [...lines.keys()].filter((line) => line >= from && line <= to);
    const ranges = code.changedLines.get(unit.file) ?? [];
    const changed = inUnit.filter((line) => ranges.some(([start, end]) => line >= start && line <= end));
    const scope = changed.length > 0 ? "changed lines" : "lines";
    const measured = changed.length > 0 ? changed : inUnit;
    if (measured.length === 0) return undefined;
    const untaken = (line: number) => {
      const branch = branches.get(line);
      return branch ? branch.total - branch.taken : 0;
    };
    return {
      kind: "coverage",
      covered: measured.filter((line) => (lines.get(line) ?? 0) > 0 && untaken(line) === 0).length,
      total: measured.length,
      scope,
      untakenBranches: measured.reduce((sum, line) => sum + untaken(line), 0),
    };
  };

  const evidenceFor = (unit: Unit): TestEvidence => {
    const covered = coverageOf(unit);
    if (covered) return covered;
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
      line: unit.statement.getStartLineNumber(),
      name: unit.name,
      change: before ? "modified" : "added",
      light: lightFor(evidenceStrength(evidence), complexity, settings),
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
    .filter((feature) => feature.units.every((id) => {
      const evidence = byId.get(id)?.evidence;
      return evidence !== undefined && evidenceStrength(evidence) === "none";
    }))
    .map((feature) => feature.id);
  result.growing = result.units
    .filter((unit) => unit.complexity.before !== undefined && unit.complexity.after > unit.complexity.before)
    .sort((a, b) => b.complexity.after - b.complexity.before! - (a.complexity.after - a.complexity.before!))
    .map((unit) => unit.id);
  result.light = worst(result.units.map((unit) => unit.light));
  return result;
}
