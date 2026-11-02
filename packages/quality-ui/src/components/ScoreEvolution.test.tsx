// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreEvolution } from "./ScoreEvolution";

afterEach(cleanup);

const point = (commit: string, score: number | null, coverage: number | null = null) => ({ commit, date: "2026-11-01", score, metrics: { coverage } });

describe("ScoreEvolution", () => {
  it("plots each scored report in order and skips the ones without a score", () => {
    render(<ScoreEvolution points={[point("aaa1111", 40), point("bbb2222", null), point("ccc3333", 90)]} />);
    const chart = screen.getByRole("img", { name: "Global score: aaa1111: 40, bbb2222: n/a, ccc3333: 90" });
    expect(chart.querySelectorAll(".evolution__point")).toHaveLength(2);
    // 0 → y 168, 100 → y 32; x spreads three reports over 32…608.
    expect(chart.querySelector(".evolution__line")?.getAttribute("d")).toBe("M32,113.6 L608,45.6");
  });

  it("shows a point's value on hover or focus", () => {
    render(<ScoreEvolution points={[point("aaa1111", 40), point("ccc3333", 90)]} />);
    const mark = screen.getByLabelText("ccc3333, 2026-11-01: 90");
    fireEvent.focus(mark);
    expect(document.querySelector(".evolution__tooltip")?.textContent).toBe("90 · ccc3333 · 2026-11-01");
    fireEvent.blur(mark);
    expect(document.querySelector(".evolution__tooltip")).toBeNull();
  });

  it("draws one small chart per metric and a table of every score", () => {
    render(<ScoreEvolution points={[point("aaa1111", 40, 50), point("ccc3333", 90, 70)]} metrics={[{ id: "coverage", name: "Coverage" }]} />);
    expect(screen.getByRole("img", { name: "Coverage: aaa1111: 50, ccc3333: 70" })).toBeTruthy();
    const table = within(screen.getByRole("table", { name: "Scores per analysed commit" }));
    expect(table.getByRole("row", { name: /ccc3333/ }).textContent).toContain("9070");
  });
});
