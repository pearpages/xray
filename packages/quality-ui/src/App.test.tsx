// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { MemoryStorage, report, reportFile } from "./testing/fixtures";

afterEach(cleanup);

const open = async (...files: File[]) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, files);
};

describe("App", () => {
  it("starts empty and shows a report once one is opened", async () => {
    render(<App storage={new MemoryStorage()} />);
    expect(screen.getByText("No report open")).toBeTruthy();

    await open(reportFile(report()));
    const scores = screen.getByRole("region", { name: "Scores" });
    expect(within(scores).getByText("77")).toBeTruthy();
    expect(within(scores).getByText("Not measured: the registry can't be reached")).toBeTruthy();
    expect(screen.getByText(/\/repos\/shop · main ·/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Hotspots" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Architecture" })).toBeTruthy();
  });

  it("explains a file that isn't a report and keeps the rest", async () => {
    render(<App storage={new MemoryStorage()} />);
    await open(reportFile("{", "broken.json"), reportFile(report()));
    expect(screen.getByText("broken.json isn't JSON.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Scores" })).toBeTruthy();
  });

  it("keeps opened reports after a reload until they're closed", async () => {
    const storage = new MemoryStorage();
    const first = render(<App storage={storage} />);
    await open(reportFile(report()));
    first.unmount();

    render(<App storage={storage} />);
    expect(screen.getByText("1 report(s) open, kept in this browser until you close them.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close all" }));
    expect(screen.getByText("No report open")).toBeTruthy();
    cleanup();

    render(<App storage={storage} />);
    expect(screen.getByText("No report open")).toBeTruthy();
  });

  it("says when the browser can't keep the reports", async () => {
    render(<App storage={new MemoryStorage(true)} />);
    await open(reportFile(report()));
    expect(screen.getByText(/This browser can't keep them/)).toBeTruthy();
  });

  it("shows the evolution and switches between reports and repositories", async () => {
    render(<App storage={new MemoryStorage()} />);
    await open(
      reportFile(report({ commit: "aaa1111", generatedAt: "2026-10-01T00:00:00.000Z", score: 60 })),
      reportFile(report({ commit: "bbb2222", generatedAt: "2026-11-01T00:00:00.000Z", score: 77 })),
      reportFile(report({ name: "blog", score: 90 })),
    );
    expect(screen.getByRole("img", { name: "aaa1111: 60, bbb2222: 77" })).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Report"), screen.getByRole("option", { name: /aaa1111/ }));
    expect(within(screen.getByRole("region", { name: "Scores" })).getByText("60")).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Repository"), "blog");
    expect(within(screen.getByRole("region", { name: "Scores" })).getByText("90")).toBeTruthy();
    expect(screen.queryByLabelText("Report")).toBeNull();
  });
});
