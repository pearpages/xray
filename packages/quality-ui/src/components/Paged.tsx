import { Inline } from "@pearpages/pulp-react/inline";
import { Pagination } from "@pearpages/pulp-react/pagination";
import { Text } from "@pearpages/pulp-react/text";

interface Props {
  /** What is paged, for the landmark's name ("Findings pages"). */
  label: string;
  page: number;
  count: number;
  total: number;
  size: number;
  onPageChange: (page: number) => void;
}

/** "21–40 of 458" and the page controls, under a paged list. Nothing when it fits on one page. */
export function Paged({ label, page, count, total, size, onPageChange }: Props) {
  if (count <= 1) return null;
  const first = (page - 1) * size + 1;
  return (
    <Inline gap={3} align="center" justify="between" wrap className="paged">
      <Text tone="muted" size="sm">
        {first}–{Math.min(total, page * size)} of {total}
      </Text>
      <Pagination aria-label={`${label} pages`} page={page} count={count} onPageChange={onPageChange} size="sm" />
    </Inline>
  );
}
