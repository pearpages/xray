// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { architectureMetric, coverageMetric, duplicationMetric, hotspotsMetric, MemoryStorage, report, reportFile, unavailableMetric } from "./testing/fixtures";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const open = async (...files: File[]) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, files);
};
const tab = (name: string | RegExp) => screen.getByRole("tab", { name });
const scores = () => screen.getByRole("region", { name: "Scores" });

describe("App", () => {
  it("starts with a place to open reports, then shows the overview of one", async () => {
    render(<App storage={new MemoryStorage()} />);
    expect(screen.getByText("No report open")).toBeTruthy();

    await open(reportFile(report()));
    expect(screen.getByRole("heading", { level: 1, name: "shop" })).toBeTruthy();
    expect(screen.getByText(/main · /)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Quality score" })).getByText("77")).toBeTruthy();
    expect(within(scores()).getByText("Not measured: the registry can't be reached")).toBeTruthy();
    // One tab per measured metric, plus the overview and every finding.
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["Overview", "Hotspots", "Architecture", "Findings (4)"]);
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
  });

  it("opens a metric's tab from its card, and keeps it in the URL", async () => {
    render(<App storage={new MemoryStorage()} />);
    await open(reportFile(report()));
    // jsdom doesn't follow fragment links on click; the card's link is what it would follow.
    const card = within(scores()).getByRole("link", { name: /Hotspots: 72, open its tab/ });
    expect(card.getAttribute("href")).toBe("#hotspots");
    // An unmeasured metric has no tab, so its card links nowhere.
    expect(within(scores()).queryByRole("link", { name: /Dependencies/ })).toBeNull();
    window.location.hash = "hotspots";
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => expect(tab("Hotspots").getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("heading", { level: 2, name: "Hotspots" })).toBeTruthy();

    await userEvent.click(tab(/Findings/));
    expect(window.location.hash).toBe("#findings");
    expect(screen.getByText("3 of 4 findings")).toBeTruthy();
  });

  it("explains a file that isn't a report and keeps the rest", async () => {
    render(<App storage={new MemoryStorage()} />);
    await open(reportFile("{", "broken.json"), reportFile(report()));
    expect(screen.getByRole("heading", { level: 1, name: "shop" })).toBeTruthy();
  });

  it("adds reports dropped anywhere on the page once one is open", async () => {
    render(<App storage={new MemoryStorage()} />);
    await open(reportFile(report()));
    fireEvent.drop(window, { dataTransfer: { files: [reportFile(report({ name: "blog", score: 90 })), reportFile("nope", "x.json")], types: ["Files"] } });
    expect(await screen.findByText("x.json isn't JSON.")).toBeTruthy();
    expect(screen.getByLabelText("Repository")).toBeTruthy();
  });

  it("keeps opened reports after a reload until they're closed", async () => {
    const storage = new MemoryStorage();
    const first = render(<App storage={storage} />);
    await open(reportFile(report()));
    first.unmount();

    render(<App storage={storage} />);
    expect(screen.getByText("Open reports are kept in this browser until you close them.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close all" }));
    expect(screen.getByText("No report open")).toBeTruthy();
    cleanup();

    render(<App storage={storage} />);
    expect(screen.getByText("No report open")).toBeTruthy();
  });

  it("says when the browser can't keep the reports", async () => {
    render(<App storage={new MemoryStorage(true)} />);
    await open(reportFile(report()));
    expect(screen.getByText(/This browser can't keep the reports/)).toBeTruthy();
  });

  it("shows the evolution and switches between reports and repositories", async () => {
    render(<App storage={new MemoryStorage()} />);
    await open(
      reportFile(report({ commit: "aaa1111", generatedAt: "2026-10-01T00:00:00.000Z", score: 60 })),
      reportFile(report({ commit: "bbb2222", generatedAt: "2026-11-01T00:00:00.000Z", score: 77 })),
      reportFile(report({ name: "blog", score: 90 })),
    );
    expect(screen.getByRole("img", { name: "aaa1111: 60, bbb2222: 77" })).toBeTruthy();
    const hero = () => screen.getByRole("region", { name: "Quality score" });

    await userEvent.selectOptions(screen.getByLabelText("Report"), screen.getByRole("option", { name: /aaa1111/ }));
    expect(within(hero()).getByText("60")).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Repository"), "blog");
    expect(within(hero()).getByText("90")).toBeTruthy();
    expect(screen.queryByLabelText("Report")).toBeNull();
  });

  it("gives coverage and duplication their own tabs when they ran", async () => {
    render(<App storage={new MemoryStorage()} />);
    await open(reportFile(report({ metrics: [hotspotsMetric(), architectureMetric(), unavailableMetric(), coverageMetric(), duplicationMetric()] })));
    await userEvent.click(tab("Coverage"));
    expect(screen.getByRole("heading", { level: 2, name: "Coverage" })).toBeTruthy();
    await userEvent.click(tab("Duplication"));
    expect(screen.getByRole("heading", { level: 2, name: "Duplication" })).toBeTruthy();
  });
});
