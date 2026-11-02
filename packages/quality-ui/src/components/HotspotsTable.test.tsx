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
    expect(screen.getByText(/Commits in the last 12 months × complexity. The 3 hottest of 3 changed files./)).toBeTruthy();
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
