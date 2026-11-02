import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import type { EvolutionPoint } from "../reports";
import "./ScoreEvolution.css";

const WIDTH = 640;
const HEIGHT = 200;
const PAD = 32;

/** The global score per report of one repository, oldest to newest (pulp has no line chart). */
export function ScoreEvolution({ points }: { points: EvolutionPoint[] }) {
  const step = points.length > 1 ? (WIDTH - 2 * PAD) / (points.length - 1) : 0;
  const x = (index: number) => PAD + index * step;
  const y = (score: number) => Math.round((HEIGHT - PAD - (score / 100) * (HEIGHT - 2 * PAD)) * 10) / 10;
  const scored = points.map((point, index) => ({ ...point, index })).filter((point) => point.score !== null);
  const path = scored.map((point, i) => `${i === 0 ? "M" : "L"}${x(point.index)},${y(point.score!)}`).join(" ");

  return (
    <section aria-labelledby="evolution-heading">
      <Heading level={2} size="md" id="evolution-heading">
        Evolution
      </Heading>
      <Text tone="muted" size="sm">
        Global score per analysed commit.
      </Text>
      <svg className="evolution" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={points.map((p) => `${p.commit}: ${p.score ?? "n/a"}`).join(", ")}>
        {[0, 50, 100].map((mark) => (
          <g key={mark}>
            <line className="evolution__grid" x1={PAD} x2={WIDTH - PAD} y1={y(mark)} y2={y(mark)} />
            <text className="evolution__label" x={PAD - 6} y={y(mark)} textAnchor="end" dominantBaseline="middle">
              {mark}
            </text>
          </g>
        ))}
        <path className="evolution__line" d={path} />
        {scored.map((point) => (
          <g key={`${point.commit}-${point.index}`}>
            <circle className="evolution__point" cx={x(point.index)} cy={y(point.score!)} r={4} />
            <text className="evolution__label" x={x(point.index)} y={HEIGHT - PAD + 16} textAnchor="middle">
              {point.commit}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}
