import { DataGrid, DataGridBody, DataGridCell, DataGridColumn, DataGridHeader, DataGridRow, type DataGridSort } from "@pearpages/pulp-react/data-grid";
import { Heading } from "@pearpages/pulp-react/heading";
import { Text } from "@pearpages/pulp-react/text";
import type { HotspotRow } from "@xray/quality";
import { useMemo, useState } from "react";
import { pageOf, type MetricResult } from "../reports";
import { CommitCalendar } from "./CommitCalendar";
import { FileLink } from "./FileLink";
import { HotspotMatrix, inCell, type MatrixCell } from "./HotspotMatrix";
import { Paged } from "./Paged";
import "./HotspotsTable.css";

const PAGE = 25;

/** Files ordered by churn × complexity, the first ones to look at. */
export function HotspotsTable({ metric, generatedAt }: { metric: MetricResult; generatedAt?: string }) {
  const [sort, setSort] = useState<DataGridSort>({ column: "hotspot", direction: "descending" });
  const [page, setPage] = useState(1);
  const [cell, setCell] = useState<MatrixCell>();
  const data = metric.data as { rows: HotspotRow[]; windowMonths: number; activity?: Record<string, number> } | undefined;
  const rows = useMemo(() => {
    const key = sort.column as keyof HotspotRow;
    const pool = cell ? inCell(data?.rows ?? [], cell) : (data?.rows ?? []);
    const sorted = [...pool].sort((a, b) =>
      typeof a[key] === "number" ? (a[key] as number) - (b[key] as number) : String(a[key]).localeCompare(String(b[key])),
    );
    return (sort.direction === "descending" ? sorted.reverse() : sorted).map((row) => ({ ...row, id: row.file }));
  }, [data, sort, cell]);
  const shown = pageOf(rows, page, PAGE);
  if (!data) return null;

  return (
    <section aria-labelledby="hotspots-heading" className="hotspots">
      <Heading level={2} size="md" id="hotspots-heading">
        Hotspots
      </Heading>
      <Text tone="muted" size="sm">
        Commits in the last {data.windowMonths} months × complexity, for the {data.rows.length} files changed in that time; the
        hottest first.
      </Text>
      {data.activity && generatedAt && <CommitCalendar activity={data.activity} windowMonths={data.windowMonths} generatedAt={generatedAt} />}
      <HotspotMatrix
        rows={data.rows}
        selected={cell}
        onSelect={(next) => {
          setCell(next);
          setPage(1);
        }}
      />
      {cell && (
        <Text size="sm">
          {`${rows.length} file(s) in the chosen cell. `}
          <button type="button" className="hotspots__clear" onClick={() => setCell(undefined)}>
            Show every file
          </button>
        </Text>
      )}
      <DataGrid
        aria-labelledby="hotspots-heading"
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
          <DataGridColumn id="churn" allowsSorting align="end">
            Commits
          </DataGridColumn>
          <DataGridColumn id="complexity" allowsSorting align="end">
            Complexity
          </DataGridColumn>
          <DataGridColumn id="hotspot" allowsSorting align="end">
            Hotspot
          </DataGridColumn>
        </DataGridHeader>
        <DataGridBody items={shown.items} emptyMessage="No file changed in the window">
          {(row) => (
            <DataGridRow id={row.id}>
              <DataGridCell>
                <FileLink file={row.file} />
              </DataGridCell>
              <DataGridCell align="end">{row.churn}</DataGridCell>
              <DataGridCell align="end">{row.complexity}</DataGridCell>
              <DataGridCell align="end">{row.hotspot}</DataGridCell>
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
      <Paged label="Hotspots" page={shown.page} count={shown.count} total={rows.length} size={PAGE} onPageChange={setPage} />
    </section>
  );
}
