// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { coverageMetric } from "../testing/fixtures";
import { CoverageTable } from "./CoverageTable";

afterEach(cleanup);

const files = () => within(screen.getByRole("grid")).getAllByRole("rowheader").map((cell) => cell.textContent);

describe("CoverageTable", () => {
  it("lists the least covered tested files first, and the files no test loads apart", async () => {
    render(<CoverageTable metric={coverageMetric()} />);
    expect(files()).toEqual(["src/app.ts", "src/cart/reduce.ts"]);
    expect(within(screen.getByRole("row", { name: /src\/app\.ts/ })).getByText("40 %")).toBeTruthy();
    expect(screen.getByText(/1 file\(s\) no test loads count as 0 %.*1 file\(s\) belong to projects without a report/)).toBeTruthy();
    expect(screen.queryByText("The report is older than the last commit")).toBeNull();

    await userEvent.click(screen.getByRole("columnheader", { name: /Coverage/ }));
    expect(files()[0]).toBe("src/cart/reduce.ts");

    await userEvent.click(screen.getByRole("radio", { name: "Untested (1)" }));
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
