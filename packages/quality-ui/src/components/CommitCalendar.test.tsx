// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommitCalendar, dailyContributions, dayLevel, windowPeriod } from "./CommitCalendar";

afterEach(cleanup);

describe("CommitCalendar", () => {
  it("ends on the report's day and spans its window, in local days", () => {
    const { start, end } = windowPeriod("2026-11-02T10:00:00.000Z", 12);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 10, 2]);
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2025, 10, 3]);
  });

  it("grades a day by its share of the busiest one", () => {
    expect([0, 1, 2, 5, 8].map((count) => dayLevel(count, 8))).toEqual([0, 1, 1, 3, 4]);
  });

  it("lists every day of the window oldest first, whatever order git gave", () => {
    const period = windowPeriod("2026-11-02T10:00:00.000Z", 1);
    const days = dailyContributions({ "2026-11-01": 8, "2026-10-30": 2 }, period);
    expect(days[0]!.date).toBe("2026-10-03");
    expect(days.at(-1)).toEqual({ date: "2026-11-02", count: 0, level: 0 });
    expect(days.find((day) => day.date === "2026-11-01")).toEqual({ date: "2026-11-01", count: 8, level: 4 });
  });

  it("draws the days and says what the colours mean", () => {
    render(<CommitCalendar activity={{ "2026-10-30": 2, "2026-11-01": 8 }} windowMonths={1} generatedAt="2026-11-02T10:00:00.000Z" />);
    expect(screen.getByText(/10 commit\(s\) in the last 1 months, on 2 day\(s\); the busiest, 2026-11-01, had 8/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /8 commits/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /No commits/ }).length).toBeGreaterThan(20);
  });
});
