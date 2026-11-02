import { Badge } from "@pearpages/pulp-react/badge";
import { Heading } from "@pearpages/pulp-react/heading";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@pearpages/pulp-react/table";
import { Text } from "@pearpages/pulp-react/text";
import { useState } from "react";
import { pageOf, type MetricResult } from "../reports";
import { Paged } from "./Paged";
import "./DependenciesView.css";

interface Vulnerability {
  package: string;
  severity: string;
  title: string;
}

interface Outdated {
  package: string;
  current: string;
  latest: string;
  major: boolean;
}

interface DependenciesData {
  packageManager: string;
  vulnerabilities: Vulnerability[];
  outdated: Outdated[] | null;
}

const RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
const TONE: Record<string, "error" | "warning" | "neutral"> = { critical: "error", high: "error", moderate: "warning" };
const PAGE = 25;

/** A package's advisories (joined with "; " in the report): the first, and the rest on demand. */
function Advisories({ title }: { title: string }) {
  const [first, ...rest] = title.split("; ").filter(Boolean);
  if (rest.length === 0) return <>{first ?? "vulnerable"}</>;
  return (
    <>
      {first}
      <details className="dependencies__more">
        <summary>{`${rest.length} more`}</summary>
        <ul>
          {rest.map((advisory) => (
            <li key={advisory}>{advisory}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

/** Vulnerable packages by severity, then the direct dependencies a major version behind. */
export function DependenciesView({ metric }: { metric: MetricResult }) {
  const [page, setPage] = useState(1);
  const [behindPage, setBehindPage] = useState(1);
  const data = metric.data as DependenciesData | undefined;
  if (!data) return null;
  const vulnerable = [...data.vulnerabilities].sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || a.package.localeCompare(b.package));
  const shown = pageOf(vulnerable, page, PAGE);
  const behind = (data.outdated ?? []).filter((row) => row.major);
  const behindShown = pageOf(behind, behindPage, PAGE);

  return (
    <div className="dependencies">
      <section aria-labelledby="vulnerabilities-heading" className="dependencies__section">
        <Heading level={2} size="md" id="vulnerabilities-heading">
          Vulnerable packages
        </Heading>
        <Text tone="muted" size="sm">
          From <code>{data.packageManager} audit</code>, the worst advisory of each package first.
        </Text>
        <Table caption={`${vulnerable.length} vulnerable packages`} density="compact">
          <TableHeader>
            <TableRow>
              <TableColumn>Severity</TableColumn>
              <TableColumn>Package</TableColumn>
              <TableColumn>Advisory</TableColumn>
            </TableRow>
          </TableHeader>
          <TableBody emptyMessage="No known vulnerability" columnCount={3}>
            {shown.items.map((row) => (
              <TableRow key={row.package}>
                <TableCell>
                  <Badge tone={TONE[row.severity] ?? "neutral"}>{row.severity}</Badge>
                </TableCell>
                <TableCell rowHeader>
                  <code>{row.package}</code>
                </TableCell>
                <TableCell>
                  <Advisories title={row.title} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Paged label="Vulnerable packages" page={shown.page} count={shown.count} total={vulnerable.length} size={PAGE} onPageChange={setPage} />
      </section>
      <section aria-labelledby="outdated-heading" className="dependencies__section">
        <Heading level={2} size="md" id="outdated-heading">
          A major version behind
        </Heading>
        {data.outdated === null ? (
          <Text tone="muted">Outdated packages weren't checked (dependencies.outdated is off).</Text>
        ) : (
          <Table caption={`${behind.length} direct dependencies a major version behind`} density="compact">
            <TableHeader>
              <TableRow>
                <TableColumn>Package</TableColumn>
                <TableColumn align="end">Installed</TableColumn>
                <TableColumn align="end">Latest</TableColumn>
              </TableRow>
            </TableHeader>
            <TableBody emptyMessage="Every direct dependency is on its latest major" columnCount={3}>
              {behindShown.items.map((row) => (
                <TableRow key={`${row.package}@${row.current}`}>
                  <TableCell rowHeader>
                    <code>{row.package}</code>
                  </TableCell>
                  <TableCell align="end">{row.current}</TableCell>
                  <TableCell align="end">{row.latest}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Paged label="Packages behind" page={behindShown.page} count={behindShown.count} total={behind.length} size={PAGE} onPageChange={setBehindPage} />
      </section>
    </div>
  );
}
