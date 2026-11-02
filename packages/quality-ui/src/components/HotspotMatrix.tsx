import { Text } from "@pearpages/pulp-react/text";
import type { HotspotRow } from "@xray/quality";
import "./HotspotMatrix.css";

/** Bins of commits (columns) and complexity (rows, highest first). */
export const CHURN = [
  { label: "1", min: 1, max: 1 },
  { label: "2", min: 2, max: 2 },
  { label: "3–5", min: 3, max: 5 },
  { label: "6–10", min: 6, max: 10 },
  { label: "11–20", min: 11, max: 20 },
  { label: "21+", min: 21, max: Infinity },
];
export const COMPLEXITY = [
  { label: "200+", min: 200, max: Infinity },
  { label: "100–199", min: 100, max: 199 },
  { label: "50–99", min: 50, max: 99 },
  { label: "25–49", min: 25, max: 49 },
  { label: "10–24", min: 10, max: 24 },
  { label: "1–9", min: 1, max: 9 },
];

export interface MatrixCell {
  churn: number;
  complexity: number;
}

const within = (value: number, bin: { min: number; max: number }) => value >= bin.min && value <= bin.max;

/** Rows that fall in a cell (by bin index). */
export function inCell(rows: HotspotRow[], cell: MatrixCell): HotspotRow[] {
  return rows.filter((row) => within(row.churn, CHURN[cell.churn]!) && within(row.complexity, COMPLEXITY[cell.complexity]!));
}

/** 0 for an empty cell, else 1–4 by its share of the fullest cell. */
const level = (count: number, max: number) => (count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4)));

interface Props {
  rows: HotspotRow[];
  selected: MatrixCell | undefined;
  onSelect: (cell: MatrixCell | undefined) => void;
}

/** How many changed files sit at each mix of commits and complexity; the top right is where it hurts. */
export function HotspotMatrix({ rows, selected, onSelect }: Props) {
  const counts = COMPLEXITY.map((_, y) => CHURN.map((_, x) => inCell(rows, { churn: x, complexity: y }).length));
  const max = Math.max(1, ...counts.flat());
  return (
    <div className="hotspot-matrix">
      <table className="hotspot-matrix__table">
        <caption>
          <Text as="span" size="sm" tone="muted">
            Files by commits (across) and complexity (down). A stronger colour holds more files; the top right is often changed and complex. Pick a cell
            to list its files.
          </Text>
        </caption>
        <thead>
          <tr>
            <td />
            {CHURN.map((bin) => (
              <th key={bin.label} scope="col">
                {bin.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPLEXITY.map((bin, y) => (
            <tr key={bin.label}>
              <th scope="row">{bin.label}</th>
              {CHURN.map((churn, x) => {
                const count = counts[y]![x]!;
                const active = selected?.churn === x && selected.complexity === y;
                return (
                  <td key={churn.label} className="hotspot-matrix__cell" data-level={level(count, max)}>
                    {count > 0 ? (
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-label={`${count} file(s) with ${churn.label} commits and complexity ${bin.label}`}
                        onClick={() => onSelect(active ? undefined : { churn: x, complexity: y })}
                      >
                        {count}
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
