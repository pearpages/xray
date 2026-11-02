// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { coverageMetric } from "../testing/fixtures";
import { CoverageTable } from "./CoverageTable";

afterEach(cleanup);

const files = () => within(screen.getByRole("grid")).getAllByRole("rowheader").map((cell) => cell.textContent);

describe("CoverageTable", () => {
  it("lists tested files by the lines no test runs, the files no test loads apart, and says what it can't see", async () => {
    render(<CoverageTable metric={coverageMetric()} />);
    // app.ts misses 6 of 20 instrumented lines in all: fully covered, it would add 30 points.
    expect(files()).toEqual(["src/app.ts", "src/cart/reduce.ts"]);
    const app = screen.getByRole("row", { name: /src\/app\.ts/ });
    expect(within(app).getByText("40 %")).toBeTruthy();
    expect(within(app).getByText("+30")).toBeTruthy();
    expect(screen.getByText("What this number can't see")).toBeTruthy();
    expect(screen.getByText(/1 file\(s\) belong to projects without a coverage report/)).toBeTruthy();
    expect(screen.queryByText("The report is older than the last commit")).toBeNull();

    // Sorting by coverage: lowest first, then highest.
    await userEvent.click(screen.getByRole("columnheader", { name: /^Coverage/ }));
    expect(files()[0]).toBe("src/app.ts");
    await userEvent.click(screen.getByRole("columnheader", { name: /^Coverage/ }));
    expect(files()[0]).toBe("src/cart/reduce.ts");

    await userEvent.click(screen.getByRole("radio", { name: "Loaded by no test (1)" }));
    expect(files()).toEqual(["src/cart/total.ts"]);
    const untested = screen.getByRole("row", { name: /src\/cart\/total\.ts/ });
    expect(within(untested).getByText("no test loads it")).toBeTruthy();
    expect(within(untested).getByText("≈ 8")).toBeTruthy();
  });

  it("has no switch when every file is loaded by a test", () => {
    const metric = coverageMetric();
    const data = metric.data as { rows: { untested?: boolean }[] };
    render(<CoverageTable metric={{ ...metric, data: { ...data, untested: 0, rows: data.rows.filter((row) => !row.untested) } }} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("warns when the report is older than the last commit", () => {
    render(<CoverageTable metric={coverageMetric(true)} />);
    expect(screen.getByText("The report is older than the last commit")).toBeTruthy();
  });

  it("draws nothing without coverage data", () => {
    const { container } = render(<CoverageTable metric={{ ...coverageMetric(), data: undefined }} />);
    expect(container.innerHTML).toBe("");
  });
});
