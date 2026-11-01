import { describe, expect, it } from "vitest";
import { fitComment, MAX_COMMENT_LENGTH } from "./comment.js";

describe("fitComment", () => {
  it("leaves short bodies untouched", () => {
    expect(fitComment("hello")).toBe("hello");
  });

  it("truncates long bodies and closes an open code fence", () => {
    const body = `intro\n\`\`\`mermaid\n${"  a --> b\n".repeat(10_000)}\`\`\`\n`;
    const fitted = fitComment(body);
    expect(fitted.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    expect(fitted.match(/^```/gm)).toHaveLength(2);
    expect(fitted).toContain("Informe truncado");
  });
});
