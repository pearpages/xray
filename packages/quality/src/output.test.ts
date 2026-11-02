import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeReport } from "./output.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("writeReport", () => {
  it("creates the folders the report goes in", () => {
    dir = mkdtempSync(join(tmpdir(), "xray-quality-out-"));
    const file = join(dir, "reports", "2026", "repo.json");
    writeReport(file, "{}\n");
    expect(readFileSync(file, "utf8")).toBe("{}\n");
  });
});
