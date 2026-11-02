import { Badge } from "@pearpages/pulp-react/badge";
import { Card, CardBody, CardHeader } from "@pearpages/pulp-react/card";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import type { Clone } from "@xray/quality";
import { useState } from "react";
import { pageOf, type MetricResult } from "../reports";
import { FileLink } from "./FileLink";
import { Paged } from "./Paged";
import "./DuplicationBlocks.css";

const PAGE = 10;

interface DuplicationData {
  percent: number;
  lines: number;
  duplicatedLines: number;
  clones: Clone[];
}

const where = (side: Clone["a"]) => `${side.file}:${side.start}–${side.end}`;

/** Copied blocks, the biggest first, each copy next to the other. */
export function DuplicationBlocks({ metric }: { metric: MetricResult }) {
  const [page, setPage] = useState(1);
  const data = metric.data as DuplicationData | undefined;
  if (!data) return null;
  const paged = pageOf(data.clones, page, PAGE);
  const shown = paged.items;

  return (
    <section aria-labelledby="duplication-heading" className="duplication">
      <Heading level={2} size="md" id="duplication-heading">
        Duplication
      </Heading>
      <Text tone="muted" size="sm">
        {data.duplicatedLines} of {data.lines} lines of code ({data.percent} %) are copies, in {data.clones.length} block(s), the biggest
        first.
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
                    <span className="duplication__copy">
                      <FileLink file={clone.a.file} label={where(clone.a)} />
                    </span>
                    <span className="duplication__same" aria-label="is the same as">
                      =
                    </span>
                    <span className="duplication__copy">
                      <FileLink file={clone.b.file} label={where(clone.b)} />
                    </span>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
      <Paged label="Duplicated blocks" page={paged.page} count={paged.count} total={data.clones.length} size={PAGE} onPageChange={setPage} />
    </section>
  );
}
