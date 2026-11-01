import { describe, expect, it } from "vitest";
import { inlineCode, renderDependencySection } from "./render.js";

describe("inlineCode", () => {
  it("wraps plain text in single backticks", () => {
    expect(inlineCode("src/a.ts")).toBe("`src/a.ts`");
  });

  it("uses a longer fence when the text contains backticks", () => {
    expect(inlineCode("we`ird.md")).toBe("``we`ird.md``");
    expect(inlineCode("`x`")).toBe("`` `x` ``");
  });
});

describe("renderDependencySection", () => {
  it("keeps file names with backticks inside their code span", () => {
    const markdown = renderDependencySection({
      nodes: [],
      edges: [],
      outsideGraph: [{ path: "docs/`evil` **x**.md", status: "added" }],
      omittedNodes: 0,
      warnings: [],
    });
    expect(markdown).toContain("- ``docs/`evil` **x**.md`` (added)");
  });
});
