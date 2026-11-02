// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { report, reportFile } from "../testing/fixtures";
import { ReportLoader } from "./ReportLoader";

afterEach(cleanup);

describe("ReportLoader", () => {
  it("reads dropped files and reports the ones that aren't reports", async () => {
    const onLoad = vi.fn();
    const { container } = render(<ReportLoader onLoad={onLoad} />);
    const zone = container.querySelector(".report-loader")!;

    fireEvent.dragOver(zone);
    expect(zone.className).toContain("report-loader--dragging");
    fireEvent.drop(zone, { dataTransfer: { files: [reportFile(report()), reportFile('{"version":2}', "old.json")] } });

    expect(await screen.findByText("old.json isn't an xray-quality report (version 1).")).toBeTruthy();
    expect(onLoad).toHaveBeenCalledWith([report()]);
    expect(zone.className).not.toContain("report-loader--dragging");
  });

  it("calls back only when something loaded", async () => {
    const onLoad = vi.fn();
    const { container } = render(<ReportLoader onLoad={onLoad} />);
    fireEvent.drop(container.querySelector(".report-loader")!, { dataTransfer: { files: [reportFile("nope", "x.json")] } });
    expect(await screen.findByText("x.json isn't JSON.")).toBeTruthy();
    expect(onLoad).not.toHaveBeenCalled();
  });
});
