// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { report } from "../testing/fixtures";
import { Findings } from "./Findings";

afterEach(cleanup);

const caption = () => screen.getByText(/of 4 findings$/).textContent;

describe("Findings", () => {
  it("shows high and medium findings first, and filters by severity and metric", async () => {
    render(<Findings report={report()} />);
    expect(caption()).toBe("3 of 4 findings");
    expect(screen.getByText("src/features/cart/Cart.tsx:3")).toBeTruthy();
    expect(screen.queryByText("4 commits × complexity 30")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "low (1)" }));
    expect(caption()).toBe("4 of 4 findings");

    await userEvent.selectOptions(screen.getByLabelText("Metric"), "architecture");
    expect(caption()).toBe("2 of 4 findings");

    await userEvent.click(screen.getByRole("button", { name: "high (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "medium (1)" }));
    expect(caption()).toBe("0 of 4 findings");
    expect(screen.getByText("No findings match these filters")).toBeTruthy();
  });
});
