// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { duplicationMetric } from "../testing/fixtures";
import { DuplicationBlocks } from "./DuplicationBlocks";

afterEach(cleanup);

describe("DuplicationBlocks", () => {
  it("shows each copied block with both of its places, biggest first", () => {
    render(<DuplicationBlocks metric={duplicationMetric()} />);
    expect(screen.getByText(/20 of 500 lines of code \(4 %\) are copies, in 2 block\(s\), the biggest first\./)).toBeTruthy();
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first!).getByText("12 lines · 240 tokens")).toBeTruthy();
    expect(within(first!).getByText("src/cart/reduce.ts:10–21")).toBeTruthy();
    expect(within(first!).getByText("src/cart/undo.ts:3–14")).toBeTruthy();
    expect(within(second!).getByText("src/app.ts:1–4")).toBeTruthy();
  });

  it("shows many blocks ten at a time", async () => {
    render(<DuplicationBlocks metric={duplicationMetric(30)} />);
    expect(document.querySelectorAll(".duplication__list > li")).toHaveLength(10);
    expect(screen.getByText("1–10 of 30")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getByText("21–30 of 30")).toBeTruthy();
    expect(screen.getByText("src/gen/a27.ts:1–3")).toBeTruthy();
  });

  it("says when nothing is copied", () => {
    render(<DuplicationBlocks metric={duplicationMetric(0)} />);
    expect(screen.getByText("No duplicated block.")).toBeTruthy();
  });
});
