// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { architectureMetric } from "../testing/fixtures";
import { ArchitectureViolations } from "./ArchitectureViolations";

afterEach(cleanup);

describe("ArchitectureViolations", () => {
  it("groups deep imports by the importing feature and flags cycles", () => {
    render(<ArchitectureViolations metric={architectureMetric()} />);
    expect(screen.getByText("2 features, from folders. A feature imports another only through its public API.")).toBeTruthy();
    expect(screen.getByText("Cart ↔ Catalogue")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Cart" })).toBeTruthy();
    expect(screen.getByText("1 deep import(s)")).toBeTruthy();
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
