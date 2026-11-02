// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { coverageMetric, report } from "../testing/fixtures";
import { MetricHeader } from "./MetricHeader";
import { ScoreChip } from "./ScoreChip";

afterEach(cleanup);

describe("MetricHeader", () => {
  it("shows the score with its band, what it measures, what moves it and the next steps", async () => {
    const metric = coverageMetric();
    const one = report({ metrics: [metric] });
    render(<MetricHeader metric={metric} report={one} history={[one]} />);
    const header = screen.getByRole("region", { name: "Coverage score" });
    expect(within(header).getByText("60")).toBeTruthy();
    expect(within(header).getByText("Fair")).toBeTruthy();
    expect(within(header).getByText("60 % of lines run under a test; 1 file is loaded by no test.")).toBeTruthy();
    expect(within(header).getByRole("button", { name: "src/cart/total.ts, open its profile" })).toBeTruthy();
    expect(within(header).getByText(/Loaded by no test: about 8 lines to cover\. \+40 points\./)).toBeTruthy();

    await userEvent.click(within(header).getByRole("button", { name: "How Coverage is scored" }));
    expect(await screen.findByText(/A line counts as covered when it ran and every branch on it was taken\./)).toBeTruthy();
  });
});

describe("ScoreChip", () => {
  it("names its band, so colour isn't alone", () => {
    render(
      <>
        <ScoreChip score={95} />
        <ScoreChip score={null} />
      </>,
    );
    expect(screen.getByLabelText("95, good").getAttribute("data-band")).toBe("good");
    expect(screen.getByLabelText("not measured, not measured").textContent).toBe("–");
  });
});
