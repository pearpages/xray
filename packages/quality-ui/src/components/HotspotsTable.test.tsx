// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { hotspotsMetric } from "../testing/fixtures";
import { HotspotsTable } from "./HotspotsTable";

afterEach(cleanup);

const files = () => within(screen.getByRole("grid")).getAllByRole("rowheader").map((cell) => cell.textContent);

describe("HotspotsTable", () => {
  it("orders files by hotspot and re-sorts by any column", async () => {
    render(<HotspotsTable metric={hotspotsMetric()} />);
    expect(screen.getByText(/Commits in the last 12 months × complexity, for the 3 files changed in that time; the\s+hottest first\./)).toBeTruthy();
    expect(files()).toEqual(["src/cart/reduce.ts", "src/cart/total.ts", "src/app.ts"]);

    await userEvent.click(screen.getByRole("columnheader", { name: /Commits/ }));
    const byCommits = files();
    expect([byCommits[0], byCommits.at(-1)].sort()).toEqual(["src/cart/reduce.ts", "src/cart/total.ts"]);
    expect(byCommits[1]).toBe("src/app.ts");
  });

  it("draws nothing without hotspot data", () => {
    const { container } = render(<HotspotsTable metric={{ ...hotspotsMetric(), data: undefined }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("HotspotMatrix", () => {
  it("counts files by commits and complexity, and filters the table to a cell", async () => {
    render(<HotspotsTable metric={hotspotsMetric()} />);
    // reduce.ts: 18 commits × 216; total.ts: 4 × 30; app.ts: 9 × 2.
    const reduce = screen.getByRole("button", { name: "1 file(s) with 11–20 commits and complexity 200+" });
    expect(reduce.closest("td")?.getAttribute("data-level")).toBe("4");
    expect(screen.getByRole("button", { name: "1 file(s) with 3–5 commits and complexity 25–49" })).toBeTruthy();
    await userEvent.click(reduce);
    expect(reduce.getAttribute("aria-pressed")).toBe("true");
    expect(files()).toEqual(["src/cart/reduce.ts"]);
    await userEvent.click(screen.getByRole("button", { name: "Show every file" }));
    expect(files()).toHaveLength(3);
  });
});
