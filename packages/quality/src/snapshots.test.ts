import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeFiles, recordSnapshot, type SnapshotFiles } from "./snapshots.js";
import type { QualityReport } from "./types.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
const folder = () => (dir = mkdtempSync(join(tmpdir(), "xray-snapshots-")));

/** A report of commit `sha` made `minute` minutes into the day, with one hotspot per file given. */
const report = (sha: string, minute: number, files: string[] = [], dirty = false): QualityReport => ({
  version: 1,
  repo: { path: "/repo", name: "repo", commit: sha.padEnd(40, "0"), dirty },
  generatedAt: new Date(Date.UTC(2026, 10, 10, 0, minute)).toISOString(),
  score: 80,
  weights: {},
  metrics: [{ id: "hotspots", name: "Hotspots", score: 80, summary: "", status: "ok", findings: files.map((file) => ({ file, severity: "high" as const, message: "4 commits" })) }],
});

/** The real file system, counting each call. */
function counting(): SnapshotFiles & { calls: Record<string, number> } {
  const calls: Record<string, number> = { list: 0, read: 0, write: 0, remove: 0 };
  return {
    calls,
    list: (d) => (calls.list!++, nodeFiles.list(d)),
    read: (f) => (calls.read!++, nodeFiles.read(f)),
    write: (f, t) => (calls.write!++, nodeFiles.write(f, t)),
    remove: (f) => (calls.remove!++, nodeFiles.remove(f)),
  };
}

describe("recordSnapshot", () => {
  it("saves the first report, with nothing to compare yet", () => {
    const d = folder();
    const outcome = recordSnapshot(d, report("aaa", 1));
    expect(outcome.comparison).toBeNull();
    expect(outcome.previous).toBeNull();
    expect(readdirSync(d)).toEqual(["20261110T000100000Z-aaa000000000.json"]);
    expect(outcome.saved).toBe(join(d, "20261110T000100000Z-aaa000000000.json"));
  });

  it("compares a new commit with the newest earlier one", () => {
    const d = folder();
    recordSnapshot(d, report("aaa", 1, ["src/old.ts"]));
    recordSnapshot(d, report("bbb", 2, ["src/old.ts"]));
    const outcome = recordSnapshot(d, report("ccc", 3, ["src/new.ts"]));
    expect(outcome.comparison?.previous.commit).toBe("bbb".padEnd(40, "0"));
    expect(outcome.comparison?.added.map((finding) => finding.file)).toEqual(["src/new.ts"]);
    expect(outcome.comparison?.fixed.map((finding) => finding.file)).toEqual(["src/old.ts"]);
  });

  it("replaces a snapshot of the same commit, and compares with the commit before it", () => {
    const d = folder();
    recordSnapshot(d, report("aaa", 1));
    recordSnapshot(d, report("bbb", 2));
    const outcome = recordSnapshot(d, report("bbb", 5));
    expect(outcome.comparison?.previous.commit).toBe("aaa".padEnd(40, "0"));
    expect(readdirSync(d).sort()).toEqual(["20261110T000100000Z-aaa000000000.json", "20261110T000500000Z-bbb000000000.json"]);
  });

  it("compares a report with uncommitted changes but doesn't save it", () => {
    const d = folder();
    recordSnapshot(d, report("aaa", 1));
    const outcome = recordSnapshot(d, report("bbb", 2, [], true));
    expect(outcome.comparison).not.toBeNull();
    expect(outcome.saved).toBeNull();
    expect(outcome.skipped).toBe("dirty");
    expect(readdirSync(d)).toHaveLength(1);
  });

  it("doesn't save a partial run (--only, --files) or a report without a commit", () => {
    const d = folder();
    expect(recordSnapshot(d, report("aaa", 1), { save: false }).skipped).toBe("partial");
    expect(recordSnapshot(d, { ...report("x", 2), repo: { ...report("x", 2).repo, commit: "unknown" } }).skipped).toBe("no-commit");
    expect(readdirSync(d)).toEqual([]);
  });

  it("keeps the newest 30", () => {
    const d = folder();
    for (let i = 0; i < 35; i++) recordSnapshot(d, report(`c${String(i).padStart(2, "0")}`, i));
    const kept = readdirSync(d).sort();
    expect(kept).toHaveLength(30);
    expect(kept[0]).toContain("-c05");
    expect(kept.at(-1)).toContain("-c34");
  });

  it("reads one folder listing and one file, with 1 snapshot kept or 30", () => {
    for (const kept of [1, 30]) {
      const d = folder();
      for (let i = 0; i < kept; i++) recordSnapshot(d, report(`c${String(i).padStart(2, "0")}`, i));
      const files = counting();
      const outcome = recordSnapshot(d, report("new", 59), { files });
      expect(outcome.comparison).not.toBeNull();
      expect({ list: files.calls.list, read: files.calls.read }, `${kept} kept`).toEqual({ list: 1, read: 1 });
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("skips a damaged newest snapshot and compares with the one before, ignoring other files", () => {
    const d = folder();
    recordSnapshot(d, report("aaa", 1));
    writeFileSync(join(d, "20261110T000200000Z-bbb000000000.json"), "{ not json");
    writeFileSync(join(d, "notes.txt"), "mine");
    const outcome = recordSnapshot(d, report("ccc", 3));
    expect(outcome.comparison?.previous.commit).toBe("aaa".padEnd(40, "0"));
    expect(readdirSync(d)).toContain("notes.txt");
  });

  it("creates the folder when it doesn't exist", () => {
    const d = join(folder(), "a", "b");
    expect(recordSnapshot(d, report("aaa", 1)).saved).not.toBeNull();
  });
});
