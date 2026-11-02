// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { architectureMetric } from "../testing/fixtures";
import { ArchitectureViolations } from "./ArchitectureViolations";

afterEach(cleanup);

describe("ArchitectureViolations", () => {
  it("groups deep imports by the importing feature, closed until opened, and flags cycles", async () => {
    render(<ArchitectureViolations metric={architectureMetric()} />);
    expect(screen.getByText("2 features, from folders. A feature imports another only through its public API.")).toBeTruthy();
    expect(screen.getByText("Cart ↔ Catalogue")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Cart: 1 deep import(s) into Catalogue" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("into Catalogue")).toBeTruthy();
    expect(screen.getByText("src/features/cart/Cart.tsx:3")).toBeTruthy();
  });

  it("says when features keep to each other's public API", () => {
    const metric = architectureMetric();
    render(<ArchitectureViolations metric={{ ...metric, data: { ...(metric.data as object), violations: [], cycles: [] } }} />);
    expect(screen.getByText("No deep imports between features.")).toBeTruthy();
    expect(screen.queryByText(/↔/)).toBeNull();
  });
});
