import { Alert } from "@pearpages/pulp-react/alert";
import { Card, CardBody, CardHeader } from "@pearpages/pulp-react/card";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import type { FeatureViolations } from "@xray/quality";
import type { MetricResult } from "../reports";
import "./ArchitectureViolations.css";

interface ArchitectureData {
  source: string;
  features: { id: string; name: string; files: number; publicApi: string[] }[];
  violations: FeatureViolations[];
  cycles: [string, string][];
}

/** Deep imports between features, grouped by the feature that makes them. */
export function ArchitectureViolations({ metric }: { metric: MetricResult }) {
  const data = metric.data as ArchitectureData | undefined;
  if (!data) return null;
  const name = (id: string) => data.features.find((feature) => feature.id === id)?.name ?? id;
  const byFeature = new Map<string, FeatureViolations[]>();
  for (const group of data.violations) byFeature.set(group.from, [...(byFeature.get(group.from) ?? []), group]);

  return (
    <section aria-labelledby="architecture-heading" className="architecture">
      <Heading level={2} size="md" id="architecture-heading">
        Architecture
      </Heading>
      <Text tone="muted" size="sm">
        {data.features.length} features, from {data.source}. A feature imports another only through its public API.
      </Text>
      {data.cycles.map(([a, b]) => (
        <Alert key={`${a}|${b}`} tone="error" title="Features import each other">
          {name(a)} ↔ {name(b)}
        </Alert>
      ))}
      {byFeature.size === 0 ? (
        <Text>No deep imports between features.</Text>
      ) : (
        [...byFeature].map(([from, groups]) => (
          <Card key={from} variant="outlined">
            <CardHeader>
              <Heading level={3} size="sm">
                {name(from)}
              </Heading>
              <Text tone="muted" size="sm">
                {groups.reduce((sum, group) => sum + group.imports.length, 0)} deep import(s)
              </Text>
            </CardHeader>
            <CardBody>
              {groups.map((group) => (
                <div key={group.to} className="architecture__group">
                  <Text weight="semibold">into {name(group.to)}</Text>
                  <ul className="architecture__imports">
                    {group.imports.map((item) => (
                      <li key={`${item.file}:${item.imports}`}>
                        <code>
                          {item.file}
                          {item.line ? `:${item.line}` : ""}
                        </code>{" "}
                        → <code>{item.imports}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        ))
      )}
    </section>
  );
}
