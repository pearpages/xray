import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `<root>/.xray/cache/`: repo-wide inputs a scoped run would otherwise recompute (ADR-0021).
 * The folder ignores itself (`.xray/.gitignore` = `*`), so it never shows in `git status`
 * nor makes a report `dirty`. Every failure is a cache miss, never an error.
 */
export class Cache {
  constructor(
    private readonly root: string,
    private readonly enabled: boolean,
  ) {}

  private get dir(): string {
    return join(this.root, ".xray", "cache");
  }

  /** `kind-key.json`, or the computed value, which is then stored as the only one of its kind. */
  get<T>(kind: string, key: string | undefined, compute: () => T): T {
    if (!this.enabled || !key) return compute();
    const file = join(this.dir, `${kind}-${key}.json`);
    try {
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch {
      // Corrupt or unreadable: recompute.
    }
    const value = compute();
    try {
      mkdirSync(this.dir, { recursive: true });
      const ignore = join(this.root, ".xray", ".gitignore");
      if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
      // One entry per kind: an older commit's churn is never read again.
      for (const old of readdirSync(this.dir)) if (old.startsWith(`${kind}-`)) rmSync(join(this.dir, old), { force: true });
      writeFileSync(file, JSON.stringify(value));
    } catch {
      // A read-only checkout still gets its report.
    }
    return value;
  }
}
