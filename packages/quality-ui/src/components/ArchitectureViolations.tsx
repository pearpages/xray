import { Alert } from "@pearpages/pulp-react/alert";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@pearpages/pulp-react/accordion";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import type { FeatureViolations } from "@xray/quality";
import type { MetricResult } from "../reports";
import { FileLink } from "./FileLink";
import "./ArchitectureViolations.css";

interface ArchitectureData {
  source: string;
  features: { id: string; name: string; files: number; publicApi: string[] }[];
  violations: FeatureViolations[];
  cycles: [string, string][];
}

/** Deep imports between features, one closed section per importing feature, the worst first. */
export function ArchitectureViolations({ metric }: { metric: MetricResult }) {
  const data = metric.data as ArchitectureData | undefined;
  if (!data) return null;
  const name = (id: string) => data.features.find((feature) => feature.id === id)?.name ?? id;
  const byFeature = new Map<string, FeatureViolations[]>();
  for (const group of data.violations) byFeature.set(group.from, [...(byFeature.get(group.from) ?? []), group]);
  const count = (groups: FeatureViolations[]) => groups.reduce((sum, group) => sum + group.imports.length, 0);

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
        <Accordion type="multiple" headingLevel={3} className="architecture__features">
          {[...byFeature]
            .sort(([, a], [, b]) => count(b) - count(a))
            .map(([from, groups]) => (
              <AccordionItem key={from} value={from}>
                <AccordionTrigger>
                  {name(from)}: {count(groups)} deep import(s) into {groups.map((group) => name(group.to)).join(", ")}
                </AccordionTrigger>
                <AccordionPanel>
                  {groups.map((group) => (
                    <div key={group.to} className="architecture__group">
                      <Text weight="semibold">into {name(group.to)}</Text>
                      <ul className="architecture__imports">
                        {group.imports.map((item) => (
                          <li key={`${item.file}:${item.imports}`}>
                            <FileLink file={item.file} line={item.line} /> → <FileLink file={item.imports} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </AccordionPanel>
              </AccordionItem>
            ))}
        </Accordion>
      )}
    </section>
  );
}
