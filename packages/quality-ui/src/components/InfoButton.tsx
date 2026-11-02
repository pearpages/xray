import { IconButton } from "@pearpages/pulp-react/icon-button";
import { Popover } from "@pearpages/pulp-react/popover";
import { Text } from "@pearpages/pulp-react/text";
import { Info } from "@pearpages/pulp-icons";
import { howScored } from "../explain";
import type { QualityReport } from "../reports";
import "./InfoButton.css";

/** The (i) beside a metric's name: how it becomes a score. A popover, not a tooltip, so it opens on touch too. */
export function InfoButton({ id, name, report }: { id: string; name: string; report: QualityReport }) {
  const { paragraphs, caveat } = howScored(id, report);
  if (paragraphs.length === 0) return null;
  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <IconButton label={`How ${name} is scored`} icon={<Info />} variant="ghost" size="sm" />
      </Popover.Trigger>
      <Popover.Content title={`How ${name} is scored`} className="info-button__content">
        {paragraphs.map((paragraph) => (
          <Text key={paragraph} size="sm">
            {paragraph}
          </Text>
        ))}
        <Text size="xs" tone="muted">
          {caveat}
        </Text>
      </Popover.Content>
    </Popover>
  );
}
