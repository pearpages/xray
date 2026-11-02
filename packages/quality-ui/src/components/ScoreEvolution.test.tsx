// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreEvolution } from "./ScoreEvolution";

afterEach(cleanup);

const point = (commit: string, score: number | null) => ({ commit, date: "2026-11-01", score, metrics: {} });

describe("ScoreEvolution", () => {
  it("plots each scored report in order and skips the ones without a score", () => {
    render(<ScoreEvolution points={[point("aaa1111", 40), point("bbb2222", null), point("ccc3333", 90)]} />);
    const chart = screen.getByRole("img", { name: "aaa1111: 40, bbb2222: n/a, ccc3333: 90" });
    expect(chart.querySelectorAll("circle")).toHaveLength(2);
    // 0 → y 168, 100 → y 32; x spreads three reports over 32…608.
    expect(chart.querySelector("path")?.getAttribute("d")).toBe("M32,113.6 L608,45.6");
  });
});
