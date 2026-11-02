import { Badge } from "@pearpages/pulp-react/badge";
import { Card, CardBody, CardHeader } from "@pearpages/pulp-react/card";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import { Tooltip } from "@pearpages/pulp-react/tooltip";
import { SCORING, evolution, shortSummary, tone, type MetricResult, type QualityReport } from "../reports";
import { ScoreEvolution } from "./ScoreEvolution";
import "./Overview.css";

function Score({ value, size = "md" }: { value: number | null; size?: "md" | "lg" }) {
  return <span className={`score score--${tone(value)} score--${size}`}>{value ?? "n/a"}</span>;
}

function MetricCard({ metric, href }: { metric: MetricResult; href?: string }) {
  const high = metric.findings.filter((finding) => finding.severity === "high").length;
  const body = (
    <>
      <CardHeader>
        <Heading level={3} size="sm">
          {metric.name}
        </Heading>
        {SCORING[metric.id] && (
          <Tooltip content={SCORING[metric.id]}>
            <span className="overview__how" tabIndex={0}>
              How it's scored
            </span>
          </Tooltip>
        )}
      </CardHeader>
      <CardBody>
        <Score value={metric.score} />
        <Text size="sm" tone={metric.status === "unavailable" ? "muted" : "default"} className="overview__summary">
          {metric.status === "unavailable" ? `Not measured: ${shortSummary(metric)}` : shortSummary(metric)}
        </Text>
        {metric.status === "ok" && (
          <div className="overview__badges">
            <Badge tone="neutral">{`${metric.findings.length} findings`}</Badge>
            {high > 0 && <Badge tone="error">{`${high} high`}</Badge>}
          </div>
        )}
      </CardBody>
    </>
  );
  // A measured metric opens its tab; an unmeasured one has nothing more to show.
  return href ? (
    <Card asChild variant="outlined" interactive className="overview__metric">
      <a href={href} aria-label={`${metric.name}: ${metric.score ?? "n/a"}, open its tab`}>
        {body}
      </a>
    </Card>
  ) : (
    <Card variant="outlined" className="overview__metric overview__metric--muted">
      {body}
    </Card>
  );
}

interface Props {
  report: QualityReport;
  history: QualityReport[];
  /** Tabs that exist, by metric id: a card links to its metric's tab. */
  tabs: string[];
}

/** The global score first, then one card per metric, then the score's evolution. */
export function Overview({ report, history, tabs }: Props) {
  const ran = report.metrics.filter((metric) => metric.status === "ok").length;
  return (
    <div className="overview">
      <Card variant="raised" padding="lg" className="overview__hero" aria-label="Quality score">
        <CardBody>
          <Text tone="muted" size="sm" weight="semibold">
            Quality
          </Text>
          <Score value={report.score} size="lg" />
          <Text tone="muted" size="sm">
            out of 100: the weighted average of the {ran} of {report.metrics.length} metrics that ran
          </Text>
        </CardBody>
      </Card>
      <section className="overview__metrics" aria-label="Scores">
        {report.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} href={tabs.includes(metric.id) ? `#${metric.id}` : undefined} />
        ))}
      </section>
      {history.length > 1 && <ScoreEvolution points={evolution(history)} />}
    </div>
  );
}
