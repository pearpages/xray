import { Card, CardBody } from "@pearpages/pulp-react/card";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import { band, BAND_LABEL, delta, HOW_TO_MEASURE, MEASURES, moves, nextSteps, verdict } from "../explain";
import type { MetricResult, QualityReport } from "../reports";
import { FileLink } from "./FileLink";
import { InfoButton } from "./InfoButton";
import "./MetricHeader.css";

interface Props {
  metric: MetricResult;
  report: QualityReport;
  history: QualityReport[];
}

/** The change since the previous report, as words and an arrow: "↑ 3 since abc1234". */
export function Change({ value, since }: { value: number | null; since: string | undefined }) {
  if (value === null || !since) return null;
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  const words = value === 0 ? "unchanged" : `${arrow} ${Math.abs(value)}`;
  return (
    <Text as="span" size="sm" tone="muted" className="change" data-direction={value > 0 ? "up" : value < 0 ? "down" : "flat"}>
      {`${words} since ${since}`}
    </Text>
  );
}

/** Every metric's tab opens the same way: the score, what it means, what moves it, what to do next. */
export function MetricHeader({ metric, report, history }: Props) {
  const b = band(metric.score);
  const steps = nextSteps(metric, report);
  const index = history.indexOf(report);
  const since = index > 0 ? history[index - 1]!.repo.commit.slice(0, 7) : undefined;
  const moving = moves(metric, report);
  return (
    <Card variant="raised" padding="lg" className="metric-header" aria-label={`${metric.name} score`}>
      <CardBody>
        <div className="metric-header__layout">
          <div className="metric-header__score">
            <div className="metric-header__title">
              <Heading level={2} size="md">
                {metric.name}
              </Heading>
              <InfoButton id={metric.id} name={metric.name} report={report} />
            </div>
            <div className="metric-header__value">
              <span className={`metric-header__number metric-header__number--${b}`}>{metric.score ?? "n/a"}</span>
              <Text as="span" weight="semibold" className={`metric-header__band metric-header__band--${b}`}>
                {BAND_LABEL[b]}
              </Text>
            </div>
            <Change value={delta(history, report, metric.id)} since={since} />
          </div>
          <div className="metric-header__text">
            <Text size="md">{verdict(metric)}</Text>
            {MEASURES[metric.id] && (
              <Text size="sm" tone="muted">
                <strong>What it measures:</strong> {MEASURES[metric.id]}
              </Text>
            )}
            {metric.status === "unavailable" ? (
              <Text size="sm" tone="muted">
                <strong>How to measure it:</strong> {HOW_TO_MEASURE[metric.id] ?? "See the reason above."}
              </Text>
            ) : (
              moving && (
                <Text size="sm" tone="muted">
                  <strong>What moves the score:</strong> {moving}
                </Text>
              )
            )}
            {steps.length > 0 && (
              <div className="metric-header__steps">
                <Text size="sm" weight="semibold">
                  Next steps, the most useful first
                </Text>
                <ol className="metric-header__list">
                  {steps.map((step) => (
                    <li key={`${step.file ?? ""}${step.text}`}>
                      {step.file && (
                        <>
                          <FileLink file={step.file} />{" "}
                        </>
                      )}
                      <Text as="span" size="sm">
                        {step.text}
                        {step.gain !== undefined ? ` +${step.gain} points.` : ""}
                      </Text>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
