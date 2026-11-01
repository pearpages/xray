import { join, matchesGlob } from "node:path";
import { Project } from "ts-morph";
import type { XrayConfig } from "../config.js";
import { isTestFile } from "../dependencies/analyze.js";
import { showFile, type ChangedFile, type LineRange } from "../git.js";
import { loadProject, type LoadedProject } from "./project.js";
import { unitsOf, UnitIndex, type Unit } from "./units.js";
import { Walker } from "./walk.js";

const CODE_FILE = /\.(c|m)?[jt]sx?$/;
const STORY_FILE = /\.stories\.[cm]?[jt]sx?$/;

/**
 * The PR's code as the ts-morph analyses see it, loaded once and shared:
 * the project, the units the diff touches, and their versions on the base.
 */
export interface ChangedCode {
  loaded: LoadedProject;
  units: UnitIndex;
  walker: Walker;
  /** Tests, stories and `interactions.ignore` globs: never callers. */
  ignored: (file: string) => boolean;
  touched: Unit[];
  /** The same unit on the base, parsed from `git show`; missing for new units. */
  baseOf: Map<string, Unit>;
  /** Units the PR removed (`path#name` on the base). */
  deleted: string[];
}

function overlaps(unit: Unit, ranges: LineRange[]): boolean {
  const from = unit.statement.getStartLineNumber();
  const to = unit.statement.getEndLineNumber();
  return ranges.some(([start, end]) => start <= to && end >= from);
}

/** Units per changed file on the base, without touching the working tree. */
function baseUnits(cwd: string, mergeBase: string, files: ChangedFile[]): Map<string, Unit[]> {
  const scratch = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const units = new Map<string, Unit[]>();
  for (const file of files) {
    if (file.status === "added") continue;
    const path = file.previousPath ?? file.path;
    const text = showFile(cwd, mergeBase, path);
    if (text === undefined) continue;
    const sourceFile = scratch.createSourceFile(`/${path}`, text, { overwrite: true });
    units.set(file.path, unitsOf(sourceFile, path));
  }
  return units;
}

/** Loads the changed code, or returns undefined when the PR changes no analysable code. */
export function loadChangedCode(
  cwd: string,
  changed: ChangedFile[],
  changedLines: Map<string, LineRange[]>,
  mergeBase: string,
  config: XrayConfig,
): ChangedCode | undefined {
  const settings = config.interactions;
  const ignored = (file: string) =>
    isTestFile(file) || STORY_FILE.test(file) || settings.ignore.some((glob) => matchesGlob(file, glob));
  const codeChanges = changed.filter((file) => CODE_FILE.test(file.path) && !ignored(file.path));
  if (codeChanges.length === 0) return undefined;

  const loaded = loadProject(cwd, config);
  const units = new UnitIndex(loaded.fileOf);
  const before = baseUnits(cwd, mergeBase, codeChanges);
  const touched: Unit[] = [];
  const baseOf = new Map<string, Unit>();
  const deleted: string[] = [];

  for (const file of codeChanges) {
    const sourceFile =
      file.status === "deleted" ? undefined : loaded.project.getSourceFile(join(cwd, file.path));
    const now = sourceFile ? units.of(sourceFile) : [];
    const was = new Map((before.get(file.path) ?? []).map((unit) => [unit.name, unit]));
    const nowNames = new Set(now.map((unit) => unit.name));
    for (const unit of was.values()) {
      if (!nowNames.has(unit.name)) deleted.push(unit.id);
    }
    for (const unit of now) {
      if (!overlaps(unit, changedLines.get(file.path) ?? [])) continue;
      touched.push(unit);
      const previous = was.get(unit.name);
      if (previous) baseOf.set(unit.id, previous);
    }
  }

  const walker = new Walker(loaded.project, loaded.resolveModule, units, loaded.fileOf, ignored);
  return { loaded, units, walker, ignored, touched, baseOf, deleted };
}
