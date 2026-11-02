import { Badge } from "@pearpages/pulp-react/badge";
import { Heading } from "@pearpages/pulp-react/heading";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@pearpages/pulp-react/table";
import { Text } from "@pearpages/pulp-react/text";
import type { LintRun } from "@xray/quality";
import type { MetricResult, QualityReport } from "../reports";
import { Findings } from "./Findings";
import "./LintView.css";

interface LintData {
  runs: LintRun[];
  rules: { rule: string; count: number }[];
}

const STATUS = { ok: "success", failed: "error", "not installed": "warning" } as const;
const RULES = 10;

/** Which tool ran where, the rules that fire most, then the findings themselves. */
export function LintView({ metric, report }: { metric: MetricResult; report: QualityReport }) {
  const data = metric.data as LintData | undefined;
  if (!data) return <Findings report={report} metric={metric.id} />;

  return (
    <div className="lint">
      <section aria-labelledby="lint-runs-heading" className="lint__section">
        <Heading level={2} size="md" id="lint-runs-heading">
          Runs
        </Heading>
        <Text tone="muted" size="sm">
          The project's own ESLint and tsc, from its node_modules; a file's TypeScript errors count from its nearest tsconfig.
        </Text>
        <Table caption={`${data.runs.length} runs`} density="compact">
          <TableHeader>
            <TableRow>
              <TableColumn>Tool</TableColumn>
              <TableColumn>Where</TableColumn>
              <TableColumn>Status</TableColumn>
              <TableColumn align="end">Errors</TableColumn>
              <TableColumn align="end">Warnings</TableColumn>
            </TableRow>
          </TableHeader>
          <TableBody emptyMessage="Nothing ran" columnCount={5}>
            {data.runs.map((run) => (
              <TableRow key={`${run.tool}:${run.target}`}>
                <TableCell>{run.tool === "eslint" ? "ESLint" : "tsc"}</TableCell>
                <TableCell rowHeader>
                  <code>{run.target}</code>
                  {run.reason && (
                    <Text size="xs" tone="muted">
                      {run.reason}
                    </Text>
                  )}
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS[run.status]}>{run.status}</Badge>
                </TableCell>
                <TableCell align="end">{run.errors}</TableCell>
                <TableCell align="end">{run.warnings}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      {data.rules.length > 0 && (
        <section aria-labelledby="lint-rules-heading" className="lint__section">
          <Heading level={2} size="md" id="lint-rules-heading">
            Most frequent
          </Heading>
          <ol className="lint__rules">
            {data.rules.slice(0, RULES).map((rule) => (
              <li key={rule.rule}>
                <code>{rule.rule.replace(/^eslint:/, "")}</code> <Text as="span" tone="muted" size="sm">{`× ${rule.count}`}</Text>
              </li>
            ))}
          </ol>
        </section>
      )}
      <Findings report={report} metric={metric.id} />
    </div>
  );
}
