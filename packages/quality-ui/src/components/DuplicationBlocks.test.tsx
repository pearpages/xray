// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { duplicationMetric } from "../testing/fixtures";
import { DuplicationBlocks } from "./DuplicationBlocks";

afterEach(cleanup);

describe("DuplicationBlocks", () => {
  it("shows each copied block with both of its places, biggest first", () => {
    render(<DuplicationBlocks metric={duplicationMetric()} />);
    expect(screen.getByText(/20 of 500 lines of code \(4 %\) are copies\. 2 block\(s\)\./)).toBeTruthy();
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first!).getByText("12 lines · 240 tokens")).toBeTruthy();
    expect(within(first!).getByText("src/cart/reduce.ts:10–21")).toBeTruthy();
    expect(within(first!).getByText("src/cart/undo.ts:3–14")).toBeTruthy();
    expect(within(second!).getByText("src/app.ts:1–4")).toBeTruthy();
  });

  it("shows the 20 biggest of many", () => {
    render(<DuplicationBlocks metric={duplicationMetric(30)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByText(/The 20 biggest of 30 blocks\./)).toBeTruthy();
  });

  it("says when nothing is copied", () => {
    render(<DuplicationBlocks metric={duplicationMetric(0)} />);
    expect(screen.getByText("No duplicated block.")).toBeTruthy();
  });
});
