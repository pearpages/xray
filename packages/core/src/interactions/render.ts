import { inlineCode } from "../dependencies/render.js";
import type { FeatureImpact, InteractionsAnalysis, InteractionUnit } from "./analyze.js";
import type { Interaction } from "./walk.js";

/** Messages per diagram; past this a diagram stops being readable. */
const MAX_MESSAGES = 40;

const MARKER = { modified: " ✏️", added: " 🆕" } as const;

/** Sequence diagram labels can't hold `;`, `#` or `:` (they end the statement or start an entity). */
function participantLabel(text: string): string {
  return text.replace(/[;#:<>]/g, " ").trim();
}

/** Messages in call order: depth-first from the entry points, each caller's uses in source order. */
function orderedMessages(feature: FeatureImpact): Interaction[] {
  const outgoing = new Map<string, Interaction[]>();
  for (const interaction of feature.interactions) {
    outgoing.set(interaction.from, [...(outgoing.get(interaction.from) ?? []), interaction]);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.order - b.order);

  const messages: Interaction[] = [];
  const done = new Set<Interaction>();
  const visit = (unit: string) => {
    for (const interaction of outgoing.get(unit) ?? []) {
      if (done.has(interaction)) continue;
      done.add(interaction);
      messages.push(interaction);
      visit(interaction.to);
    }
  };
  [...feature.entryPoints, ...feature.touched].forEach(visit);
  // Anything not reachable from those starts (shouldn't happen, but never drop an edge silently).
  feature.interactions.filter((interaction) => !done.has(interaction)).forEach((interaction) => messages.push(interaction));
  return messages;
}

export function renderSequenceDiagram(
  feature: FeatureImpact,
  units: Record<string, InteractionUnit>,
): string {
  const messages = orderedMessages(feature);
  const shown = messages.slice(0, MAX_MESSAGES);
  const participants: string[] = [];
  const add = (id: string) => {
    if (!participants.includes(id)) participants.push(id);
  };
  feature.entryPoints.forEach(add);
  shown.forEach((message) => {
    add(message.from);
    add(message.to);
  });
  feature.touched.forEach(add);

  const names = participants.map((id) => units[id]?.name ?? id);
  const label = (id: string, index: number) => {
    const unit = units[id];
    const name = names[index]!;
    // Two units with the same name in one diagram: say which file each is in.
    const file = unit && names.filter((other) => other === name).length > 1 ? ` (${unit.file.split("/").pop()})` : "";
    return participantLabel(`${name}${file}`) + (unit?.change ? MARKER[unit.change] : "");
  };
  const alias = new Map(participants.map((id, index) => [id, `p${index}`]));

  const lines = ["sequenceDiagram"];
  participants.forEach((id, index) => lines.push(`  participant ${alias.get(id)} as ${label(id, index)}`));
  for (const message of shown) {
    lines.push(`  ${alias.get(message.from)}->>${alias.get(message.to)}: ${message.kind}`);
  }
  if (shown.length === 0) lines.push(`  Note over ${alias.get(participants[0]!)}: changed`);
  for (const [id, count] of Object.entries(feature.hiddenCallees)) {
    if (alias.has(id)) lines.push(`  Note right of ${alias.get(id)}: and ${count} more`);
  }
  if (messages.length > shown.length) {
    lines.push(`  Note over ${alias.get(participants[0]!)}: ${messages.length - shown.length} more interaction(s) not shown`);
  }
  return lines.join("\n");
}

function unitList(ids: string[], units: Record<string, InteractionUnit>, limit = Infinity): string {
  const more = ids.length > limit ? ` and ${ids.length - limit} more` : "";
  return ids
    .slice(0, limit)
    .map((id) => {
      const unit = units[id];
      const name = unit?.name ?? id.slice(id.lastIndexOf("#") + 1);
      return `${inlineCode(name)}${unit?.change ? MARKER[unit.change] : ""}`;
    })
    .join(", ") + more;
}

const MISSING_MAP =
  "> [!WARNING]\n" +
  "> No `xray.features.json` found: features are named after the code's entry points.\n" +
  "> Run the xray skill in Claude Code to create the feature map and get named features.";

export function renderInteractionsSection(analysis: InteractionsAnalysis, maxDiagrams: number): string {
  const out: string[] = [];
  const { units } = analysis;

  if (analysis.touched.length === 0) {
    out.push("No function, component or hook changed in this PR.");
  } else if (analysis.skipped) {
    out.push(
      `> [!NOTE]\n> ${analysis.touched.length} functions, components or hooks changed: more than ` +
        `${analysis.skipped.limit} (\`interactions.maxTouchedUnits\`), so diagrams are skipped.`,
      "",
      ...analysis.touched.map((id) => `- ${inlineCode(id)}`),
    );
  } else {
    if (analysis.featureMap === "missing") out.push(MISSING_MAP, "");
    out.push(
      "| Feature | Changed | Entry point |",
      "|---|---|---|",
      ...analysis.features.map(
        (feature) =>
          `| ${feature.name}${feature.mapped ? "" : " *(entry point)*"} | ${unitList(feature.touched, units)} | ` +
          `${feature.entryPoints.map((id) => inlineCode(id)).join("<br>")} |`,
      ),
    );
    analysis.features.slice(0, maxDiagrams).forEach((feature, index) => {
      const diagram = ["```mermaid", renderSequenceDiagram(feature, units), "```"];
      const title = feature.description ? `${feature.name} — ${feature.description}` : feature.name;
      const shared = feature.sharedBy
        ? [`Used by ${feature.sharedBy.length}: ${unitList(feature.sharedBy, units, 12)}`, ""]
        : [];
      if (index === 0) out.push("", `### ${title}`, "", ...shared, ...diagram);
      else out.push("", `<details><summary>${title}</summary>`, "", ...shared, ...diagram, "", "</details>");
    });
    if (analysis.features.length > maxDiagrams) {
      out.push(
        "",
        `<sub>${analysis.features.length - maxDiagrams} more feature(s) in the table have no diagram ` +
          "(`interactions.maxDiagrams`).</sub>",
      );
    }
    out.push("", "<sub>✏️ changed · 🆕 new</sub>");
  }

  if (analysis.unmapped.length > 0) {
    out.push(
      "",
      `<details><summary>${analysis.unmapped.length} changed unit(s) not in the feature map</summary>`,
      "",
      ...analysis.unmapped.map((id) => `- ${inlineCode(id)}`),
      "",
      "Run the xray skill to add them to `xray.features.json`.",
      "",
      "</details>",
    );
  }
  if (analysis.deleted.length > 0) {
    out.push("", `**Removed:** ${analysis.deleted.map((id) => inlineCode(id)).join(", ")}`);
  }
  for (const warning of analysis.warnings) out.push("", `> [!WARNING]\n> ${warning}`);
  return out.join("\n");
}
