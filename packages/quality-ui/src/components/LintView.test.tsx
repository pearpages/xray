// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { lintMetric, report } from "../testing/fixtures";
import { LintView } from "./LintView";

afterEach(cleanup);

describe("LintView", () => {
  it("shows each run with its status, the most frequent rules and the findings", () => {
    const metric = lintMetric();
    render(<LintView metric={metric} report={report({ metrics: [metric] })} />);
    const runs = within(screen.getByRole("table", { name: "3 runs" }));
    const missing = runs.getByRole("row", { name: /apps\/web/ });
    expect(within(missing).getByText("not installed")).toBeTruthy();
    expect(within(missing).getByText("eslint isn't installed (xray doesn't install)")).toBeTruthy();
    expect(screen.getByText("prefer-const")).toBeTruthy();
    expect(screen.getAllByText("× 1")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 2, name: "Findings" })).toBeTruthy();
    expect(screen.queryByLabelText("Metric")).toBeNull();
  });
});
