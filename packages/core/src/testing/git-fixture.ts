import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A throwaway git repository for tests: write files, commit, branch. */
export class GitFixture {
  readonly root = mkdtempSync(join(tmpdir(), "xray-fixture-"));

  constructor() {
    this.git("init", "-q", "-b", "main");
  }

  git(...args: string[]): void {
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
      cwd: this.root,
      stdio: "ignore",
    });
  }

  write(files: Record<string, string>): this {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(this.root, path)), { recursive: true });
      writeFileSync(join(this.root, path), content);
    }
    return this;
  }

  remove(path: string): this {
    rmSync(join(this.root, path));
    return this;
  }

  commit(message: string): this {
    this.git("add", "-A");
    this.git("commit", "-q", "-m", message);
    return this;
  }

  branch(name: string): this {
    this.git("checkout", "-q", "-b", name);
    return this;
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
