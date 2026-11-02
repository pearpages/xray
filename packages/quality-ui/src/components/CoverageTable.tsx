import { Alert } from "@pearpages/pulp-react/alert";
import { Badge } from "@pearpages/pulp-react/badge";
import { DataGrid, DataGridBody, DataGridCell, DataGridColumn, DataGridHeader, DataGridRow, type DataGridSort } from "@pearpages/pulp-react/data-grid";
import { Heading } from "@pearpages/pulp-react/heading";
import { SegmentedControl } from "@pearpages/pulp-react/segmented-control";
import { Text } from "@pearpages/pulp-react/text";
import type { CoverageRow } from "@xray/quality";
import { useMemo, useState } from "react";
import { pageOf, tone, type MetricResult } from "../reports";
import { FileLink } from "./FileLink";
import { Paged } from "./Paged";
import "./CoverageTable.css";

const PAGE = 25;

interface CoverageData {
  files: string[];
  rows: CoverageRow[];
  untested: number;
  missing: string[];
  reportDate: string;
  stale: boolean;
}

type View = "tested" | "untested";

/**
 * Files by line coverage, least covered first. Files no test loads (their size estimated) are a
 * second view: in a project with few tests they would fill the table and hide the weak tested ones.
 */
export function CoverageTable({ metric }: { metric: MetricResult }) {
  const [sort, setSort] = useState<DataGridSort>({ column: "percent", direction: "ascending" });
  const [view, setView] = useState<View>("tested");
  const [page, setPage] = useState(1);
  const data = metric.data as CoverageData | undefined;
  const tested = (data?.rows ?? []).filter((row) => !row.untested);
  const untested = (data?.rows ?? []).filter((row) => row.untested);
  const current = view === "untested" ? untested : tested;
  const rows = useMemo(() => {
    const key = sort.column as keyof CoverageRow;
    const sorted = [...current].sort((a, b) =>
      typeof a[key] === "number" ? (a[key] as number) - (b[key] as number) || b.lines - a.lines : String(a[key]).localeCompare(String(b[key])),
    );
    return (sort.direction === "descending" ? sorted.reverse() : sorted).map((row) => ({ ...row, id: row.file }));
  }, [current, sort]);
  const shown = pageOf(rows, page, PAGE);
  if (!data) return null;

  return (
    <section aria-labelledby="coverage-heading" className="coverage">
      <Heading level={2} size="md" id="coverage-heading">
        Coverage
      </Heading>
      <Text tone="muted" size="sm">
        From {data.files.join(", ")}, {new Date(data.reportDate).toLocaleDateString()}.
        {data.untested > 0 && ` ${data.untested} file(s) no test loads count as 0 %, their lines estimated.`}
        {data.missing.length > 0 && ` ${data.missing.length} file(s) belong to projects without a report and aren't counted.`}
      </Text>
      {untested.length > 0 && (
        <SegmentedControl<View>
          label="Files: tested, or loaded by no test"
          className="coverage__view"
          size="sm"
          value={view}
          onValueChange={(next) => {
            setView(next);
            setPage(1);
          }}
          options={[
            { value: "tested", label: `Tested (${tested.length})` },
            { value: "untested", label: `Untested (${untested.length})` },
          ]}
        />
      )}
      {data.stale && (
        <Alert tone="warning" title="The report is older than the last commit">
          It may describe code that has changed since. Run the tests with coverage again.
        </Alert>
      )}
      <DataGrid
        aria-labelledby="coverage-heading"
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        density="compact"
        stickyHeader
      >
        <DataGridHeader>
          <DataGridColumn id="file" isRowHeader allowsSorting>
            File
          </DataGridColumn>
          <DataGridColumn id="lines" allowsSorting align="end">
            Lines
          </DataGridColumn>
          <DataGridColumn id="covered" allowsSorting align="end">
            Covered
          </DataGridColumn>
          <DataGridColumn id="percent" allowsSorting align="end">
            Coverage
          </DataGridColumn>
        </DataGridHeader>
        <DataGridBody items={shown.items} emptyMessage="No instrumented file">
          {(row) => (
            <DataGridRow id={row.id}>
              <DataGridCell>
                <FileLink file={row.file} />
              </DataGridCell>
              <DataGridCell align="end">{row.untested ? `≈ ${row.lines}` : row.lines}</DataGridCell>
              <DataGridCell align="end">{row.covered}</DataGridCell>
              <DataGridCell align="end">
                {row.untested ? <Badge tone="error">no test loads it</Badge> : <Badge tone={tone(row.percent)}>{`${row.percent} %`}</Badge>}
              </DataGridCell>
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
      <Paged label="Coverage" page={shown.page} count={shown.count} total={rows.length} size={PAGE} onPageChange={setPage} />
    </section>
  );
}
