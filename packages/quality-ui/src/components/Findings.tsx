import { Badge } from "@pearpages/pulp-react/badge";
import { Chip } from "@pearpages/pulp-react/chip";
import { Heading } from "@pearpages/pulp-react/heading";
import { Inline } from "@pearpages/pulp-react/inline";
import { Select } from "@pearpages/pulp-react/select";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@pearpages/pulp-react/table";
import { useState } from "react";
import { filterFindings, findingRows, pageOf, type QualityReport, type Severity } from "../reports";
import { Paged } from "./Paged";
import "./Findings.css";

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const TONE = { high: "error", medium: "warning", low: "neutral" } as const;
const PAGE = 25;

interface Props {
  report: QualityReport;
  /** Only this metric's findings, without the metric filter (a metric's own tab). */
  metric?: string;
}

/** Findings, filterable by severity and metric, a page at a time. */
export function Findings({ report, metric: fixed }: Props) {
  const [severities, setSeverities] = useState<Severity[]>(["high", "medium"]);
  const [chosen, setChosen] = useState("all");
  const [page, setPage] = useState(1);
  const metric = fixed ?? chosen;
  const all = findingRows(report).filter((row) => !fixed || row.metric === fixed);
  const rows = filterFindings(all, severities, metric);
  const shown = pageOf(rows, page, PAGE);
  const toggle = (severity: Severity, on: boolean) => {
    setSeverities((current) => (on ? [...current, severity] : current.filter((s) => s !== severity)));
    setPage(1);
  };

  return (
    <section aria-labelledby="findings-heading" className="findings">
      <Heading level={2} size="md" id="findings-heading">
        Findings
      </Heading>
      <Inline gap={3} align="end" wrap>
        {SEVERITIES.map((severity) => (
          <Chip key={severity} selected={severities.includes(severity)} onSelectedChange={(on) => toggle(severity, on)}>
            {severity} ({all.filter((row) => row.severity === severity).length})
          </Chip>
        ))}
        {!fixed && (
          <Select
            label="Metric"
            size="sm"
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All metrics</option>
            {report.metrics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </Inline>
      <Table caption={`${rows.length} of ${all.length} findings`} density="compact">
        <TableHeader>
          <TableRow>
            <TableColumn>Severity</TableColumn>
            {!fixed && <TableColumn>Metric</TableColumn>}
            <TableColumn>Where</TableColumn>
            <TableColumn>Finding</TableColumn>
          </TableRow>
        </TableHeader>
        <TableBody emptyMessage="No findings match these filters" columnCount={fixed ? 3 : 4}>
          {shown.items.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Badge tone={TONE[row.severity]}>{row.severity}</Badge>
              </TableCell>
              {!fixed && <TableCell>{row.metricName}</TableCell>}
              <TableCell rowHeader>
                <code>
                  {row.file}
                  {row.line ? `:${row.line}` : ""}
                </code>
              </TableCell>
              <TableCell>{row.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Paged label="Findings" page={shown.page} count={shown.count} total={rows.length} size={PAGE} onPageChange={setPage} />
    </section>
  );
}
