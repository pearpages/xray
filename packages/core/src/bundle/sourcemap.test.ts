import { describe, expect, it } from "vitest";
import { bytesPerSource, decodeSegment, packageOfSource } from "./sourcemap.js";

describe("decodeSegment", () => {
  it("decodes base64 VLQ fields, including negatives and continuations", () => {
    expect(decodeSegment("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeSegment("IACJ")).toEqual([4, 0, 1, -4]);
    expect(decodeSegment("gBAAA")).toEqual([16, 0, 0, 0]);
  });
});

describe("bytesPerSource", () => {
  it("gives each segment the code up to the next one, per line", () => {
    // Line 1: cols 0-4 from a.ts, cols 5-9 from b.ts; line 2: all from a.ts.
    const code = "aaaaabbbbb\naaa";
    const map = { sources: ["a.ts", "b.ts"], mappings: "AAAA,KCAA;ADAA" };
    expect(Object.fromEntries(bytesPerSource(code, map))).toEqual({ "a.ts": 8, "b.ts": 5 });
  });
});

describe("packageOfSource", () => {
  it("names the npm package, scoped or not, through pnpm's layout", () => {
    expect(packageOfSource("../node_modules/.pnpm/react-dom@19.1.0/node_modules/react-dom/cjs/x.js")).toBe("react-dom");
    expect(packageOfSource("node_modules/@tanstack/react-query/build/index.js")).toBe("@tanstack/react-query");
    expect(packageOfSource("../src/App.tsx")).toBeUndefined();
  });
});
