// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { report } from "../testing/fixtures";
import { globalVerdict, Overview, weakestFirst } from "./Overview";

afterEach(cleanup);

const card = (name: string) => screen.getByRole("heading", { name }).closest(".overview__metric") as HTMLElement;

describe("Overview", () => {
  it("puts the global score first, says what holds it down, then the metrics weakest first", () => {
    const one = report();
    render(<Overview report={one} history={[one]} tabs={["overview", "hotspots", "architecture", "dependencies", "findings"]} />);
    const hero = screen.getByRole("region", { name: "Quality score" });
    expect(within(hero).getByText("77").className).toContain("score--fair");
    expect(within(hero).getByText("Fair. One metric holds the score down: hotspots.")).toBeTruthy();
    expect(within(hero).getByText(/the 2 of 3 metrics that ran, each weighing the same/)).toBeTruthy();
    expect(within(hero).getByText(/The only report of shop open/)).toBeTruthy();

    const names = within(screen.getByRole("region", { name: "Scores" })).getAllByRole("heading").map((heading) => heading.textContent);
    expect(names).toEqual(["Hotspots", "Architecture", "Dependencies"]);
    expect(within(card("Hotspots")).getByText("Fair")).toBeTruthy();
    expect(within(card("Hotspots")).getByText("1 high")).toBeTruthy();
    expect(within(card("Hotspots")).getByRole("button", { name: "How Hotspots is scored" })).toBeTruthy();
    expect(within(card("Architecture")).getByText("82").className).toContain("score--good");
    expect(within(card("Architecture")).getByText(/Each high costs 10 points/)).toBeTruthy();
  });

  it("says why a metric wasn't measured", () => {
    const one = report({ score: null });
    render(<Overview report={one} history={[one]} tabs={["overview", "findings"]} />);
    const dependencies = card("Dependencies");
    expect(within(dependencies).getByText("Not measured: the registry can't be reached")).toBeTruthy();
    expect(within(dependencies).getByText("n/a").className).toContain("score--none");
    expect(within(dependencies).queryByRole("link")).toBeNull();
  });

  it("shows how each score moved since the report before", () => {
    const before = report({ commit: "aaa1111", generatedAt: "2026-10-01T00:00:00.000Z", score: 70 });
    const now = report({ commit: "bbb2222", generatedAt: "2026-11-01T00:00:00.000Z", score: 77 });
    render(<Overview report={now} history={[before, now]} tabs={["overview"]} />);
    expect(within(screen.getByRole("region", { name: "Quality score" })).getByText("↑ 7 since aaa1111")).toBeTruthy();
    expect(within(card("Hotspots")).getByText("unchanged since aaa1111")).toBeTruthy();
  });

  it("orders metrics weakest first and words an all-good score", () => {
    const one = report();
    expect(weakestFirst(one.metrics).map((metric) => metric.id)).toEqual(["hotspots", "architecture", "dependencies"]);
    expect(globalVerdict({ ...one, score: 90, metrics: [one.metrics[1]!] })).toBe("Good: every metric that ran scores 80 or more.");
  });
});
