import { Badge } from "@pearpages/pulp-react/badge";
import { Card, CardBody, CardHeader } from "@pearpages/pulp-react/card";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import { band, BAND_LABEL, delta, moves } from "../explain";
import { evolution, shortSummary, type MetricResult, type QualityReport } from "../reports";
import { InfoButton } from "./InfoButton";
import { Change } from "./MetricHeader";
import { ScoreEvolution } from "./ScoreEvolution";
import "./Overview.css";

/** Measured metrics by score, the weakest first; unmeasured ones last. */
export function weakestFirst(metrics: MetricResult[]): MetricResult[] {
  return [...metrics].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
}

/** The global score in words: which metrics hold it down. */
export function globalVerdict(report: QualityReport): string {
  const b = band(report.score);
  if (b === "none") return "Nothing could be measured: each tab says why.";
  const weak = weakestFirst(report.metrics).filter((metric) => metric.score !== null && metric.score < 80);
  if (weak.length === 0) return `${BAND_LABEL[b]}: every metric that ran scores 80 or more.`;
  const names = weak.map((metric) => metric.name.toLowerCase());
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${BAND_LABEL[b]}. ${names.length === 1 ? "One metric holds" : `${names.length} metrics hold`} the score down: ${list}.`;
}

function MetricCard({ metric, report, history, since, href }: { metric: MetricResult; report: QualityReport; history: QualityReport[]; since?: string; href?: string }) {
  const b = band(metric.score);
  const high = metric.findings.filter((finding) => finding.severity === "high").length;
  return (
    <Card variant="outlined" className="overview__metric" data-linked={href ? "true" : undefined}>
      <CardHeader className="overview__metric-header">
        <Heading level={3} size="sm">
          {href ? (
            <a href={href} className="overview__link">
              {metric.name}
            </a>
          ) : (
            metric.name
          )}
        </Heading>
        <span className="overview__info">
          <InfoButton id={metric.id} name={metric.name} report={report} />
        </span>
      </CardHeader>
      <CardBody>
        <div className="overview__value">
          <span className={`score score--${b}`}>{metric.score ?? "n/a"}</span>
          <Text as="span" size="sm" weight="semibold" className={`overview__band overview__band--${b}`}>
            {BAND_LABEL[b]}
          </Text>
        </div>
        <Change value={delta(history, report, metric.id)} since={since} />
        <Text size="sm" tone={metric.status === "unavailable" ? "muted" : "default"} className="overview__summary">
          {metric.status === "unavailable" ? `Not measured: ${shortSummary(metric)}` : shortSummary(metric)}
        </Text>
        {metric.status === "ok" && (
          <>
            <Text size="sm" tone="muted">
              {moves(metric, report)}
            </Text>
            <div className="overview__badges">
              <Badge tone="neutral">{`${metric.findings.length} findings`}</Badge>
              {high > 0 && <Badge tone="error">{`${high} high`}</Badge>}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

interface Props {
  report: QualityReport;
  history: QualityReport[];
  /** Tabs that exist, by metric id: a card links to its metric's tab. */
  tabs: string[];
}

/** The global score and what holds it down, then one card per metric, the weakest first, then the evolution. */
export function Overview({ report, history, tabs }: Props) {
  const ran = report.metrics.filter((metric) => metric.status === "ok").length;
  const same = new Set(Object.values(report.weights)).size <= 1;
  const b = band(report.score);
  const index = history.indexOf(report);
  const since = index > 0 ? history[index - 1]!.repo.commit.slice(0, 7) : undefined;
  return (
    <div className="overview">
      <Card variant="raised" padding="lg" aria-label="Quality score">
        <CardBody>
          <div className="overview__hero">
            <div className="overview__hero-score">
              <Text tone="muted" size="sm" weight="semibold">
                Quality
              </Text>
              <span className={`score score--${b} score--lg`}>{report.score ?? "n/a"}</span>
              <Change value={delta(history, report)} since={since} />
            </div>
            <div className="overview__hero-text">
              <Text size="md">{globalVerdict(report)}</Text>
              <Text size="sm" tone="muted">
                {`Out of 100: the average of the ${ran} of ${report.metrics.length} metrics that ran, ${same ? "each weighing the same" : "weighted as configured"}. 80 or more reads as good, 50 to 79 as fair, under 50 as poor.`}
              </Text>
              {!since && (
                <Text size="sm" tone="faint">
                  {`The only report of ${report.repo.name} open: with an earlier one, every score shows how much it moved.`}
                </Text>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
      <div className="overview__intro">
        <Heading level={2} size="md">
          Metrics, the weakest first
        </Heading>
        <Text size="sm" tone="muted">
          Each card opens its tab. The (i) says what the metric measures and how it turns into a score.
        </Text>
      </div>
      <section className="overview__metrics" aria-label="Scores">
        {weakestFirst(report.metrics).map((metric) => (
          <MetricCard key={metric.id} metric={metric} report={report} history={history} since={since} href={tabs.includes(metric.id) ? `#${metric.id}` : undefined} />
        ))}
      </section>
      {history.length > 1 && <ScoreEvolution points={evolution(history)} metrics={report.metrics.map(({ id, name }) => ({ id, name }))} />}
    </div>
  );
}
