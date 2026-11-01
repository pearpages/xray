import { Badge } from "@pearpages/pulp-react/badge";
import { Chip } from "@pearpages/pulp-react/chip";
import { Heading } from "@pearpages/pulp-react/heading";
import { Inline } from "@pearpages/pulp-react/inline";
import { Select } from "@pearpages/pulp-react/select";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@pearpages/pulp-react/table";
import { useState } from "react";
import { filterFindings, findingRows, type QualityReport, type Severity } from "../reports";

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const TONE = { high: "error", medium: "warning", low: "neutral" } as const;

/** Every finding, filterable by severity and metric. */
export function Findings({ report }: { report: QualityReport }) {
  const [severities, setSeverities] = useState<Severity[]>(["high", "medium"]);
  const [metric, setMetric] = useState("all");
  const all = findingRows(report);
  const rows = filterFindings(all, severities, metric);
  const toggle = (severity: Severity, on: boolean) =>
    setSeverities((current) => (on ? [...current, severity] : current.filter((s) => s !== severity)));

  return (
    <section aria-labelledby="findings-heading">
      <Heading level={2} size="md" id="findings-heading">
        Findings
      </Heading>
      <Inline gap={3} align="end">
        {SEVERITIES.map((severity) => (
          <Chip key={severity} selected={severities.includes(severity)} onSelectedChange={(on) => toggle(severity, on)}>
            {severity} ({all.filter((row) => row.severity === severity).length})
          </Chip>
        ))}
        <Select label="Metric" size="sm" value={metric} onChange={(event) => setMetric(event.target.value)}>
          <option value="all">All metrics</option>
          {report.metrics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Inline>
      <Table caption={`${rows.length} of ${all.length} findings`} density="compact">
        <TableHeader>
          <TableRow>
            <TableColumn>Severity</TableColumn>
            <TableColumn>Metric</TableColumn>
            <TableColumn>Where</TableColumn>
            <TableColumn>Finding</TableColumn>
          </TableRow>
        </TableHeader>
        <TableBody emptyMessage="No findings match these filters" columnCount={4}>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Badge tone={TONE[row.severity]}>{row.severity}</Badge>
              </TableCell>
              <TableCell>{row.metricName}</TableCell>
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
    </section>
  );
}
