// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { report } from "../testing/fixtures";
import { ScoreOverview } from "./ScoreOverview";

afterEach(cleanup);

const card = (name: string) => screen.getByRole("heading", { name }).closest(".score-overview__metric") as HTMLElement;

describe("ScoreOverview", () => {
  it("shows the global score and a card per metric, coloured by band", () => {
    render(<ScoreOverview report={report()} />);
    expect(screen.getByText("77").className).toContain("score--warning");
    expect(within(card("Hotspots")).getByText("2 findings")).toBeTruthy();
    expect(within(card("Architecture")).getByText("82").className).toContain("score--success");
  });

  it("says why a metric wasn't measured", () => {
    render(<ScoreOverview report={report({ score: null })} />);
    expect(within(card("Dependencies")).getByText("unavailable")).toBeTruthy();
    expect(within(card("Dependencies")).getByText("Not measured: the registry can't be reached")).toBeTruthy();
    expect(within(card("Dependencies")).getByText("n/a").className).toContain("score--neutral");
  });
});
