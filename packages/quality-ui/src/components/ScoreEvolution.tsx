import { Heading } from "@pearpages/pulp-react/heading";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@pearpages/pulp-react/table";
import { Text } from "@pearpages/pulp-react/text";
import { useState } from "react";
import type { EvolutionPoint } from "../reports";
import "./ScoreEvolution.css";

interface ChartProps {
  points: EvolutionPoint[];
  /** The score to draw: the global one, or a metric's. */
  value: (point: EvolutionPoint) => number | null;
  label: string;
  size: "large" | "small";
}

const SIZE = { large: { width: 640, height: 200, pad: 32 }, small: { width: 240, height: 80, pad: 10 } };

/** The hovered point's value, drawn in the chart: its position is geometry, not styling. */
function Tooltip({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const boxWidth = text.length * 6.4 + 16;
  const left = x + 10 + boxWidth > width ? x - 10 - boxWidth : x + 10;
  return (
    <g className="evolution__tooltip" aria-hidden="true">
      <rect x={left} y={y - 12} width={boxWidth} height={24} rx={4} />
      <text x={left + 8} y={y} dominantBaseline="middle">
        {text}
      </text>
    </g>
  );
}

/** One line on a fixed 0–100 scale, every point with a hover and focus tooltip. */
function LineChart({ points, value, label, size }: ChartProps) {
  const [active, setActive] = useState<number>();
  const { width, height, pad } = SIZE[size];
  const step = points.length > 1 ? (width - 2 * pad) / (points.length - 1) : 0;
  const x = (index: number) => pad + index * step;
  const y = (score: number) => Math.round((height - pad - (score / 100) * (height - 2 * pad)) * 10) / 10;
  const scored = points.map((point, index) => ({ point, index, score: value(point) })).filter((item) => item.score !== null);
  const path = scored.map((item, i) => `${i === 0 ? "M" : "L"}${x(item.index)},${y(item.score!)}`).join(" ");
  const shown = scored.find((item) => item.index === active);

  return (
    <div className={`evolution evolution--${size}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${points.map((p) => `${p.commit}: ${value(p) ?? "n/a"}`).join(", ")}`}>
        {/* Small multiples share the large chart's 0–100 scale: gridlines only, no repeated labels. */}
        {(size === "large" ? [0, 50, 100] : [0, 100]).map((mark) => (
          <g key={mark}>
            <line className="evolution__grid" x1={pad} x2={width - pad} y1={y(mark)} y2={y(mark)} />
            {size === "large" && (
              <text className="evolution__label" x={pad - 6} y={y(mark)} textAnchor="end" dominantBaseline="middle">
                {mark}
              </text>
            )}
          </g>
        ))}
        <path className="evolution__line" d={path} />
        {scored.map((item) => (
          <g
            key={`${item.point.commit}-${item.index}`}
            className="evolution__mark"
            tabIndex={0}
            aria-label={`${item.point.commit}, ${item.point.date}: ${item.score}`}
            onMouseEnter={() => setActive(item.index)}
            onMouseLeave={() => setActive(undefined)}
            onFocus={() => setActive(item.index)}
            onBlur={() => setActive(undefined)}
          >
            {/* A hit area bigger than the mark. */}
            <circle className="evolution__hit" cx={x(item.index)} cy={y(item.score!)} r={12} />
            <circle className="evolution__point" cx={x(item.index)} cy={y(item.score!)} r={item.index === active ? 6 : 4} />
            {size === "large" && (
              <text className="evolution__label" x={x(item.index)} y={height - pad + 16} textAnchor="middle">
                {item.point.commit}
              </text>
            )}
          </g>
        ))}
        {shown && <Tooltip x={x(shown.index)} y={y(shown.score!)} width={width} text={`${shown.score} · ${shown.point.commit} · ${shown.point.date}`} />}
      </svg>
    </div>
  );
}

interface Props {
  points: EvolutionPoint[];
  /** Metric names by id, in report order: one small chart each. */
  metrics?: { id: string; name: string }[];
}

/** The global score per analysed commit, then one small chart per metric on the same scale. */
export function ScoreEvolution({ points, metrics = [] }: Props) {
  // A metric no report measured has nothing to draw.
  const measured = metrics.filter((metric) => points.some((point) => point.metrics[metric.id] != null));
  return (
    <section aria-labelledby="evolution-heading" className="evolution-section">
      <Heading level={2} size="md" id="evolution-heading">
        Evolution
      </Heading>
      <Text tone="muted" size="sm">
        Score per analysed commit, oldest to newest; below, each metric on the same 0–100 scale.
      </Text>
      <LineChart points={points} value={(point) => point.score} label="Global score" size="large" />
      {measured.length > 0 && (
        <div className="evolution-section__multiples" aria-label="Each metric, on the same 0–100 scale">
          {measured.map((metric) => {
            const last = points.at(-1)?.metrics[metric.id] ?? null;
            return (
              <figure key={metric.id} className="evolution-section__multiple">
                <figcaption>
                  <Text size="sm" weight="semibold" as="span">
                    {metric.name}
                  </Text>{" "}
                  <Text size="sm" tone="muted" as="span">
                    {last ?? "n/a"}
                  </Text>
                </figcaption>
                <LineChart points={points} value={(point) => point.metrics[metric.id] ?? null} label={metric.name} size="small" />
              </figure>
            );
          })}
        </div>
      )}
      <details className="evolution-section__table">
        <summary>
          <Text as="span" size="sm">
            Show as a table
          </Text>
        </summary>
        <Table caption="Scores per analysed commit" density="compact">
          <TableHeader>
            <TableRow>
              <TableColumn>Commit</TableColumn>
              <TableColumn>Date</TableColumn>
              <TableColumn align="end">Global</TableColumn>
              {metrics.map((metric) => (
                <TableColumn key={metric.id} align="end">
                  {metric.name}
                </TableColumn>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody columnCount={3 + metrics.length}>
            {points.map((point, index) => (
              <TableRow key={`${point.commit}-${index}`}>
                <TableCell rowHeader>
                  <code>{point.commit}</code>
                </TableCell>
                <TableCell>{point.date}</TableCell>
                <TableCell align="end">{point.score ?? "n/a"}</TableCell>
                {metrics.map((metric) => (
                  <TableCell key={metric.id} align="end">
                    {point.metrics[metric.id] ?? "n/a"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </section>
  );
}
