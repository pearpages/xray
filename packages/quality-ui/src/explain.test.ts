import { describe, expect, it } from "vitest";
import { band, delta, howScored, moves, nextSteps, verdict } from "./explain";
import { architectureMetric, coverageMetric, dependenciesMetric, duplicationMetric, hotspotsMetric, lintMetric, report } from "./testing/fixtures";

// 200 code files: penalty points count half.
const scored = (metrics = [hotspotsMetric()]) => ({ ...report({ metrics }), scoring: { codeFiles: 200, severityPenalty: { high: 10, medium: 3, low: 1 } } });

describe("explain", () => {
  it("bands scores as the overview reads them", () => {
    expect([100, 80, 79, 50, 49, 0, null].map(band)).toEqual(["good", "good", "fair", "fair", "poor", "poor", "none"]);
  });

  it("explains scoring in the report's own numbers", () => {
    expect(howScored("hotspots", scored()).paragraphs.at(-1)).toBe(
      "Score: 100 minus 10 per high, 3 per medium and 1 per low hotspot, for every 100 files of code (this repository has 200).",
    );
    expect(howScored("unknown", scored()).paragraphs).toEqual([]);
  });

  it("reads each metric in one sentence", () => {
    expect(verdict(hotspotsMetric())).toBe("1 file is both changed very often and very complex.");
    expect(verdict(architectureMetric())).toBe("2 features, with 1 deep import and 1 cycle between them.");
    expect(verdict(dependenciesMetric())).toBe("3 vulnerable packages, 1 of them high or critical; 1 a major version behind.");
    expect(verdict(coverageMetric())).toBe("60 % of lines run under a test; 1 file is loaded by no test.");
    expect(verdict(duplicationMetric())).toBe("4 % of the code is a copy, in 2 blocks.");
    expect(verdict(lintMetric())).toBe("1 error and 1 warning in 2 runs.");
  });

  it("says what each finding costs and what fixing them brings", () => {
    const report = scored();
    expect(moves(hotspotsMetric(), report)).toBe("Points lost: the 1 high 5 and the 1 low 0.5. A file drops a grade when it changes less or gets simpler.");
    expect(moves(architectureMetric(), report)).toBe("Points lost: the 1 high 5 and the 1 medium 1.5. Breaking the 1 cycle brings it to 99.");
    expect(moves(dependenciesMetric(), report)).toBe("Fixing the 1 high or critical brings it to 100; the 0 moderate too, 100.");
    expect(moves(coverageMetric(), report)).toBe("Every 1 lines a test starts running add 1 point.");
  });

  it("lists the next steps, the most useful first", () => {
    const report = scored();
    expect(nextSteps(hotspotsMetric(), report)).toEqual([
      { file: "src/cart/reduce.ts", text: "18 commits × complexity 216 = 3888, high. Under complexity 56 it drops a grade." },
      { file: "src/cart/total.ts", text: "4 commits × complexity 30 = 120, low. Under complexity 25 it drops a grade." },
    ]);
    expect(nextSteps(coverageMetric(), report).map((step) => [step.file, step.gain])).toEqual([
      ["src/cart/total.ts", 40],
      ["src/app.ts", 30],
    ]);
    expect(nextSteps(architectureMetric(), report)[0]!.text).toBe("Break the cycle between Cart and Catalogue: one of them must stop importing the other.");
    expect(nextSteps(dependenciesMetric(), report)[0]!.text).toBe("Update next (critical): SSRF.");
    expect(nextSteps(duplicationMetric(), report)[0]!.text).toBe("Lines 10–21 are also in src/cart/undo.ts:3–14 (240 tokens): keep one copy.");
    expect(nextSteps(lintMetric(), report)[0]!.text).toBe("Fix the 1 report of TS2322.");
  });

  it("measures the change since the report before", () => {
    const a = report({ commit: "aaa", generatedAt: "2026-10-01", score: 60 });
    const b = report({ commit: "bbb", generatedAt: "2026-11-01", score: 77 });
    expect(delta([a, b], b)).toBe(17);
    expect(delta([a, b], a)).toBeNull();
    expect(delta([a, b], b, "hotspots")).toBe(0);
  });

  it("gives costs per finding, not totals, for a report without its file count", () => {
    expect(moves(hotspotsMetric(), report())).toBe("Each high costs 10 points, each medium 3 and each low 1, per 100 files of code. A file drops a grade when it changes less or gets simpler.");
  });
});
