import { Badge } from "@pearpages/pulp-react/badge";
import { Card, CardBody, CardHeader } from "@pearpages/pulp-react/card";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import type { Clone } from "@xray/quality";
import type { MetricResult } from "../reports";
import "./DuplicationBlocks.css";

const LIMIT = 20;

interface DuplicationData {
  percent: number;
  lines: number;
  duplicatedLines: number;
  clones: Clone[];
}

const where = (side: Clone["a"]) => `${side.file}:${side.start}–${side.end}`;

/** The biggest copied blocks, each copy next to the other. */
export function DuplicationBlocks({ metric }: { metric: MetricResult }) {
  const data = metric.data as DuplicationData | undefined;
  if (!data) return null;
  const shown = data.clones.slice(0, LIMIT);

  return (
    <section aria-labelledby="duplication-heading" className="duplication">
      <Heading level={2} size="md" id="duplication-heading">
        Duplication
      </Heading>
      <Text tone="muted" size="sm">
        {data.duplicatedLines} of {data.lines} lines of code ({data.percent} %) are copies.{" "}
        {data.clones.length > shown.length ? `The ${shown.length} biggest of ${data.clones.length} blocks.` : `${data.clones.length} block(s).`}
      </Text>
      {shown.length === 0 ? (
        <Text>No duplicated block.</Text>
      ) : (
        <ol className="duplication__list">
          {shown.map((clone) => (
            <li key={`${where(clone.a)}|${where(clone.b)}`}>
              <Card variant="outlined">
                <CardHeader>
                  <Badge tone={clone.tokens >= 200 ? "warning" : "neutral"} className="duplication__size">
                    {`${clone.lines} lines · ${clone.tokens} tokens`}
                  </Badge>
                </CardHeader>
                <CardBody>
                  <div className="duplication__pair">
                    <code className="duplication__copy">{where(clone.a)}</code>
                    <span className="duplication__same" aria-label="is the same as">
                      =
                    </span>
                    <code className="duplication__copy">{where(clone.b)}</code>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
