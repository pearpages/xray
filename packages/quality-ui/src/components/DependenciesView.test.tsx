// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dependenciesMetric } from "../testing/fixtures";
import { DependenciesView } from "./DependenciesView";

afterEach(cleanup);

describe("DependenciesView", () => {
  it("lists vulnerable packages worst first, then the majors behind", () => {
    render(<DependenciesView metric={dependenciesMetric()} />);
    const vulnerable = within(screen.getByRole("table", { name: "3 vulnerable packages" }));
    expect(vulnerable.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["next", "semver", "zod"]);
    expect(screen.getByText("pnpm audit")).toBeTruthy();
    // One advisory shown, the rest folded.
    const next = vulnerable.getByRole("row", { name: /next/ });
    expect(within(next).getByText("2 more")).toBeTruthy();
    expect(within(next).getByText("Request smuggling")).toBeTruthy();
    const behind = within(screen.getByRole("table", { name: "1 direct dependencies a major version behind" }));
    expect(behind.getByText("react")).toBeTruthy();
    expect(behind.queryByText("vite")).toBeNull();
  });

  it("says when outdated packages weren't checked", () => {
    render(<DependenciesView metric={dependenciesMetric(false)} />);
    expect(screen.getByText(/Outdated packages weren't checked/)).toBeTruthy();
  });
});
