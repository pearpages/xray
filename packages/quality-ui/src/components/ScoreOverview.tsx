import { Badge } from "@pearpages/pulp-react/badge";
import { Card, CardBody, CardHeader } from "@pearpages/pulp-react/card";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import { tone, type QualityReport } from "../reports";
import "./ScoreOverview.css";

function Score({ value }: { value: number | null }) {
  return <span className={`score score--${tone(value)}`}>{value ?? "n/a"}</span>;
}

/** The global score and one card per metric. */
export function ScoreOverview({ report }: { report: QualityReport }) {
  return (
    <section className="score-overview" aria-label="Scores">
      <Card variant="raised" padding="lg" className="score-overview__global">
        <CardHeader>
          <Heading level={2} size="md">
            Quality
          </Heading>
        </CardHeader>
        <CardBody>
          <Score value={report.score} />
          <Text tone="muted" size="sm">
            out of 100, weighted over the metrics that ran
          </Text>
        </CardBody>
      </Card>
      {report.metrics.map((metric) => (
        <Card key={metric.id} variant="outlined" className="score-overview__metric">
          <CardHeader>
            <Heading level={3} size="sm">
              {metric.name}
            </Heading>
            {metric.status === "unavailable" ? (
              <Badge tone="neutral" className="score-overview__badge">unavailable</Badge>
            ) : (
              <Badge tone={tone(metric.score)} className="score-overview__badge">{metric.findings.length} findings</Badge>
            )}
          </CardHeader>
          <CardBody>
            <Score value={metric.score} />
            <Text size="sm" tone={metric.status === "unavailable" ? "muted" : "default"}>
              {metric.status === "unavailable" ? `Not measured: ${metric.reason}` : metric.summary}
            </Text>
          </CardBody>
        </Card>
      ))}
    </section>
  );
}
