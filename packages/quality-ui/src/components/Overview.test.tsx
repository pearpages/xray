// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { report } from "../testing/fixtures";
import { Overview } from "./Overview";

afterEach(cleanup);

const card = (name: string) => screen.getByRole("heading", { name }).closest(".overview__metric") as HTMLElement;

describe("Overview", () => {
  it("puts the global score first, then a card per metric with a short summary", () => {
    render(<Overview report={report()} history={[report()]} tabs={["overview", "hotspots", "architecture", "findings"]} />);
    const hero = screen.getByRole("region", { name: "Quality score" });
    expect(within(hero).getByText("77").className).toContain("score--warning");
    expect(within(hero).getByText(/the 2 of 3 metrics that ran/)).toBeTruthy();

    expect(within(card("Hotspots")).getByText("2 hotspots; the hottest is reduce.ts.")).toBeTruthy();
    expect(within(card("Hotspots")).getByText("2 findings")).toBeTruthy();
    expect(within(card("Hotspots")).getByText("1 high")).toBeTruthy();
    expect(within(card("Architecture")).getByText("2 features · 1 deep import · 1 cycle")).toBeTruthy();
    expect(within(card("Architecture")).getByText("82").className).toContain("score--success");
    expect(within(card("Hotspots")).getByText("How it's scored")).toBeTruthy();
  });

  it("says why a metric wasn't measured, without a link", () => {
    render(<Overview report={report({ score: null })} history={[]} tabs={["overview", "findings"]} />);
    const dependencies = card("Dependencies");
    expect(within(dependencies).getByText("Not measured: the registry can't be reached")).toBeTruthy();
    expect(within(dependencies).getByText("n/a").className).toContain("score--neutral");
    expect(dependencies.tagName).not.toBe("A");
    expect(screen.queryByRole("img")).toBeNull();
  });
});
