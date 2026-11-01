import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { discoverWorkspace } from "../workspaces.js";

/** Hits per line, per file (root-relative POSIX path). */
export type Coverage = Map<string, Map<number, number>>;

const toPosix = (path: string) => path.split(sep).join("/");

/**
 * Maps an lcov `SF:` path to a root-relative one. Relative paths are relative to the
 * project the report was made in (the folder holding `coverage/`); absolute paths may
 * come from another machine, so the longest suffix that exists under the root wins.
 */
function resolveSource(cwd: string, projectDir: string, source: string): string | undefined {
  if (!isAbsolute(source)) {
    for (const candidate of [join(projectDir, source), join(cwd, source)]) {
      if (existsSync(candidate)) return toPosix(relative(cwd, candidate));
    }
    return undefined;
  }
  const inside = relative(cwd, source);
  if (!inside.startsWith("..") && !isAbsolute(inside)) return toPosix(inside);
  const parts = source.split(/[\\/]/).filter(Boolean);
  for (let start = 1; start < parts.length; start++) {
    const candidate = parts.slice(start).join("/");
    if (existsSync(join(cwd, candidate))) return candidate;
  }
  return undefined;
}

export function parseLcov(text: string, cwd: string, projectDir: string, into: Coverage = new Map()): Coverage {
  let file: string | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      file = resolveSource(cwd, projectDir, line.slice(3).trim());
    } else if (line.startsWith("DA:") && file) {
      const [lineNumber, hits] = line.slice(3).split(",").map(Number);
      if (lineNumber === undefined || hits === undefined || Number.isNaN(lineNumber)) continue;
      const lines = into.get(file) ?? new Map<number, number>();
      lines.set(lineNumber, Math.max(lines.get(lineNumber) ?? 0, hits));
      into.set(file, lines);
    } else if (line.startsWith("end_of_record")) {
      file = undefined;
    }
  }
  return into;
}

/** `risk.coverage` when set; otherwise `coverage/lcov.info` at the root and in each workspace package. */
export function coverageFiles(cwd: string, configured?: string[]): string[] {
  const candidates = configured ?? [
    "coverage/lcov.info",
    ...(discoverWorkspace(cwd) ?? []).map((pkg) => `${pkg.dir}/coverage/lcov.info`),
  ];
  return candidates.filter((file) => existsSync(join(cwd, file)));
}

export function loadCoverage(cwd: string, configured?: string[]): { coverage?: Coverage; files: string[] } {
  const files = coverageFiles(cwd, configured);
  if (files.length === 0) return { files };
  const coverage: Coverage = new Map();
  for (const file of files) {
    // `<project>/coverage/lcov.info`: relative SF paths are relative to <project>.
    parseLcov(readFileSync(join(cwd, file), "utf8"), cwd, join(cwd, dirname(dirname(file))), coverage);
  }
  return { coverage, files };
}
