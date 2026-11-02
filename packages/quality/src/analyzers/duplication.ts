import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { clamp, unavailable } from "../score.js";
import type { Analyzer, Finding } from "../types.js";

interface Location {
  sourceId: string;
  start: { line: number; position: number };
  end: { line: number; position: number };
}

interface JscpdClone {
  duplicationA: Location;
  duplicationB: Location;
}

type DetectClones = (options: Record<string, unknown>) => Promise<JscpdClone[]>;

// jscpd 4's ES module build imports `colors/safe` without an extension, which Node rejects; its
// CommonJS build works (ADR-0016).
const { detectClones } = createRequire(import.meta.url)("jscpd") as { detectClones: DetectClones };

export interface Clone {
  tokens: number;
  lines: number;
  a: { file: string; start: number; end: number };
  b: { file: string; start: number; end: number };
}

const toPosix = (path: string) => path.split(sep).join("/");

/** Duplicated blocks among `files` (root-relative), found in memory: jscpd writes nothing. */
export async function findClones(root: string, files: string[], minTokens: number): Promise<Clone[]> {
  if (files.length === 0) return [];
  const found = await detectClones({
    path: files.map((file) => join(root, file)),
    minTokens,
    format: ["javascript", "typescript", "jsx", "tsx"],
    reporters: [],
    silent: true,
    absolute: true,
    gitignore: false,
  });
  const side = (location: Location) => ({ file: toPosix(relative(root, location.sourceId)), start: location.start.line, end: location.end.line });
  return found
    .map((clone) => ({
      tokens: clone.duplicationA.end.position - clone.duplicationA.start.position,
      lines: clone.duplicationA.end.line - clone.duplicationA.start.line + 1,
      a: side(clone.duplicationA),
      b: side(clone.duplicationB),
    }))
    .sort((x, y) => y.tokens - x.tokens || x.a.file.localeCompare(y.a.file) || x.a.start - y.a.start);
}

const lineCount = (text: string) => (text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

export const duplication: Analyzer = {
  id: "duplication",
  name: "Duplication",
  phase: 2,
  async analyze({ root, config, codeFiles }) {
    const settings = config.duplication;
    const total = codeFiles.reduce((sum, file) => sum + lineCount(readFileSync(join(root, file), "utf8")), 0);
    if (total === 0) return unavailable("duplication", "Duplication", "there is no code to compare");
    const clones = await findClones(root, codeFiles, settings.minTokens);

    // Each duplicated line counts once, however many copies it has.
    const duplicated = new Map<string, Set<number>>();
    for (const clone of clones) {
      for (const { file, start, end } of [clone.a, clone.b]) {
        const lines = duplicated.get(file) ?? new Set<number>();
        for (let line = start; line <= end; line++) lines.add(line);
        duplicated.set(file, lines);
      }
    }
    const duplicatedLines = [...duplicated.values()].reduce((sum, lines) => sum + lines.size, 0);
    const percent = Math.round((duplicatedLines / total) * 1000) / 10;

    const findings: Finding[] = clones.map((clone) => ({
      file: clone.a.file,
      line: clone.a.start,
      severity: clone.tokens >= settings.mediumTokens ? "medium" : "low",
      message: `${clone.lines} lines (${clone.tokens} tokens) also in ${clone.b.file}:${clone.b.start}`,
    }));
    return {
      id: "duplication",
      name: "Duplication",
      score: clamp(Math.round(100 - 4 * percent)),
      summary:
        clones.length === 0
          ? `No duplicated block of ${settings.minTokens} tokens or more in ${total} lines of code.`
          : `${percent} % of ${total} lines of code are duplicated, in ${clones.length} block(s) of ${settings.minTokens} tokens or more.`,
      findings,
      status: "ok",
      data: { percent, lines: total, duplicatedLines, clones },
    };
  },
};
