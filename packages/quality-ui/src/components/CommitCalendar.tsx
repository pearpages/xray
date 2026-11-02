import { Heading } from "@pearpages/pulp-react/heading";
import { createDateString, Heatmap, groupByWeeks, type ContributionData, type Period } from "@pearpages/pulp-react/heatmap";
import { Text } from "@pearpages/pulp-react/text";
import "./CommitCalendar.css";

interface Props {
  /** Commits per day, `YYYY-MM-DD`. */
  activity: Record<string, number>;
  windowMonths: number;
  /** When the report was made: the calendar ends that day. */
  generatedAt: string;
}

/** The report's window as local calendar days, ending the day it was made. */
export function windowPeriod(generatedAt: string, windowMonths: number): Period {
  const at = new Date(generatedAt);
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const start = new Date(at.getFullYear(), at.getMonth() - windowMonths, at.getDate() + 1);
  return { start, end };
}

/** 0 for no commit, else 1–4 by the day's share of the busiest day. */
export function dayLevel(count: number, max: number): ContributionData["level"] {
  return count === 0 ? 0 : (Math.max(1, Math.ceil((count / max) * 4)) as ContributionData["level"]);
}

/** One entry per day of the period, oldest first: `groupByWeeks` spans its first to its last entry. */
export function dailyContributions(activity: Record<string, number>, period: Period): ContributionData[] {
  const max = Math.max(1, ...Object.values(activity));
  const days: ContributionData[] = [];
  for (const day = new Date(period.start); day <= period.end; day.setDate(day.getDate() + 1)) {
    const date = createDateString(day);
    const count = activity[date] ?? 0;
    days.push({ date, count, level: dayLevel(count, max) });
  }
  return days;
}

/** When the code changed: one square per day of the hotspot window. */
export function CommitCalendar({ activity, windowMonths, generatedAt }: Props) {
  const period = windowPeriod(generatedAt, windowMonths);
  const contribution = dailyContributions(activity, period);
  const total = Object.values(activity).reduce((sum, count) => sum + count, 0);
  const busiest = Object.entries(activity).sort(([, a], [, b]) => b - a)[0];
  return (
    <section aria-labelledby="calendar-heading" className="commit-calendar">
      <Heading level={3} size="sm" id="calendar-heading">
        When the code changed
      </Heading>
      <Text tone="muted" size="sm">
        One square per day: {total} commit(s) in the last {windowMonths} months, on {Object.keys(activity).length} day(s)
        {busiest ? `; the busiest, ${busiest[0]}, had ${busiest[1]}` : ""}. A stronger colour is a busier day, relative to that one. Long
        quiet stretches and sudden bursts show where the hotspots' commits came from.
      </Text>
      <div className="commit-calendar__scroll">
        <Heatmap
          data={{ contribution, period, weeks: groupByWeeks(contribution, { weekStartsOn: 1 }) }}
          labels={{ contributions: (count) => `${count} commit${count === 1 ? "" : "s"}`, noContributions: "No commits" }}
        />
      </div>
    </section>
  );
}
