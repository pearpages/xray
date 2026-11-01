import { describe, expect, it } from "vitest";
import { parseNameStatus } from "./git.js";

describe("parseNameStatus", () => {
  it("maps git status letters, including renames", () => {
    const output = ["M\tsrc/a.ts", "A\tsrc/b.ts", "D\tsrc/c.ts", "R087\tsrc/old.ts\tsrc/new.ts", ""].join("\n");
    expect(parseNameStatus(output)).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
      { path: "src/c.ts", status: "deleted" },
      { path: "src/new.ts", status: "renamed", previousPath: "src/old.ts" },
    ]);
  });
});
