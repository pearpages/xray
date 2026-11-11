// A repository's quality history: one saved report per commit, compared with the newest earlier
// one (ADR-0027). The folder is the caller's (the plugin passes its data folder), never the
// analysed repository.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareReports, type QualityComparison } from "./compare.js";
import type { QualityReport } from "./types.js";

/** The file system, as the snapshot store needs it. Tests count calls through it. */
export interface SnapshotFiles {
  /** File names in `dir`; none when it doesn't exist. */
  list(dir: string): string[];
  read(file: string): string;
  /** Writes whole or not at all: a reader never sees half a file. Creates the folder. */
  write(file: string, text: string): void;
  remove(file: string): void;
}

export const nodeFiles: SnapshotFiles = {
  list: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
  read: (file) => readFileSync(file, "utf8"),
  write: (file, text) => {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(`${file}.tmp`, text);
    renameSync(`${file}.tmp`, file);
  },
  remove: (file) => rmSync(file, { force: true }),
};

export interface SnapshotOutcome {
  /** Against the newest snapshot of another commit; null when there is none. */
  comparison: QualityComparison | null;
  /** The snapshot compared with. */
  previous: string | null;
  /** Where this report was saved; null when it wasn't (see `skipped`). */
  saved: string | null;
  /** Why it wasn't saved: uncommitted changes, a partial run, or no commit to name it by. */
  skipped?: "dirty" | "partial" | "no-commit";
}

export interface SnapshotOptions {
  /** False for a partial run (`--only`, `--files`): compared, never saved. Default true. */
  save?: boolean;
  /** How many snapshots to keep, newest first. Default 30. */
  keep?: number;
  files?: SnapshotFiles;
}

export const KEEP = 30;
const NAME = /^(\d{8}T\d{9}Z)-([0-9a-f]{12})\.json$/;

/** `20261110T231200000Z-<first 12 of the sha>.json`: sorting the names sorts by time. */
const nameOf = (report: QualityReport) => `${report.generatedAt.replace(/[-:.]/g, "")}-${report.repo.commit.slice(0, 12)}.json`;

/** A saved report, or null when the file is damaged or not a version 1 report. */
function parse(text: string): QualityReport | null {
  try {
    const report = JSON.parse(text) as Partial<QualityReport>;
    return report.version === 1 && Array.isArray(report.metrics) && typeof report.repo?.commit === "string" ? (report as QualityReport) : null;
  } catch {
    return null;
  }
}

/**
 * Compares `report` with the newest snapshot of an earlier commit in `dir`, then saves it there
 * (replacing a snapshot of the same commit) and keeps the newest {@link KEEP}. Reads one listing
 * and one file, however many snapshots there are; a damaged snapshot is skipped for the next.
 * A report with uncommitted changes, of a partial run or without a commit is compared, not saved.
 * @example recordSnapshot("~/.claude/plugins/data/xray-xray/snapshots/pearpages-xray", report)
 *   // → { comparison: { score: { before: 82, after: 85, change: 3 }, added: [...], ... }, saved: ".../20261111T...-c219327....json", ... }
 */
export function recordSnapshot(dir: string, report: QualityReport, options: SnapshotOptions = {}): SnapshotOutcome {
  const files = options.files ?? nodeFiles;
  const keep = options.keep ?? KEEP;
  const sha = report.repo.commit.slice(0, 12);
  const snapshots = files.list(dir).filter((name) => NAME.test(name)).sort().reverse();

  let comparison: QualityComparison | null = null;
  let previous: string | null = null;
  for (const name of snapshots) {
    if (NAME.exec(name)![2] === sha) continue;
    let text: string;
    try {
      text = files.read(join(dir, name));
    } catch {
      continue; // Removed or unreadable since the listing: try the next.
    }
    const old = parse(text);
    if (!old) continue;
    comparison = compareReports(old, report);
    previous = join(dir, name);
    break;
  }

  const skipped = options.save === false ? "partial" : !/^[0-9a-f]{12}$/.test(sha) ? "no-commit" : report.repo.dirty ? "dirty" : undefined;
  if (skipped) return { comparison, previous, saved: null, skipped };

  const saved = join(dir, nameOf(report));
  files.write(saved, `${JSON.stringify(report, null, 2)}\n`);
  const others = snapshots.filter((name) => name !== nameOf(report));
  for (const name of others.filter((name) => NAME.exec(name)![2] === sha)) files.remove(join(dir, name));
  for (const name of others.filter((name) => NAME.exec(name)![2] !== sha).slice(keep - 1)) files.remove(join(dir, name));
  return { comparison, previous, saved };
}
