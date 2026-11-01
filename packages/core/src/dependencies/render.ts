import { dirname, basename } from "node:path";
import type { DependencyAnalysis, DependencyNode } from "./analyze.js";

const CLASS_DEFS = [
  "classDef modified fill:#fde68a,stroke:#b45309,stroke-width:2px,color:#000",
  "classDef added fill:#bbf7d0,stroke:#15803d,stroke-width:2px,color:#000",
  "classDef renamed fill:#bfdbfe,stroke:#1d4ed8,stroke-width:2px,color:#000",
  "classDef test stroke-dasharray:4 3",
  "classDef external fill:#e5e7eb,stroke:#6b7280,color:#000",
];

function label(text: string): string {
  return `"${text.replace(/"/g, "#quot;")}"`;
}

function groupOf(node: DependencyNode): string {
  return node.kind === "external" ? "external dependencies" : dirname(node.id);
}

function classesOf(node: DependencyNode): string[] {
  const classes: string[] = [];
  if (node.change) classes.push(node.change);
  if (node.kind !== "source") classes.push(node.kind);
  return classes;
}

/** Flowchart of the changed modules and their direct neighbours, grouped by folder. */
export function renderDependencyMermaid(analysis: DependencyAnalysis): string {
  const ids = new Map(analysis.nodes.map((node, index) => [node.id, `n${index}`]));
  const groups = new Map<string, DependencyNode[]>();
  for (const node of analysis.nodes) {
    const group = groupOf(node);
    groups.set(group, [...(groups.get(group) ?? []), node]);
  }

  const lines = ["flowchart LR", ...CLASS_DEFS.map((line) => `  ${line}`)];
  [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([group, nodes], index) => {
      lines.push(`  subgraph g${index}[${label(group)}]`);
      for (const node of nodes) {
        const name = node.kind === "external" ? node.id : basename(node.id);
        lines.push(`    ${ids.get(node.id)}[${label(name)}]`);
      }
      lines.push("  end");
    });
  for (const edge of analysis.edges) {
    const arrow = edge.typeOnly ? "-.->" : edge.dynamic ? "-->|lazy|" : "-->";
    lines.push(`  ${ids.get(edge.from)} ${arrow} ${ids.get(edge.to)}`);
  }
  for (const node of analysis.nodes) {
    const classes = classesOf(node);
    if (classes.length) lines.push(`  class ${ids.get(node.id)} ${classes.join(",")}`);
  }
  return lines.join("\n");
}

/** Inline code span that survives backticks in the text (file names come from the PR). */
export function inlineCode(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

const STATUS_LABEL = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
} as const;

export function renderDependencySection(analysis: DependencyAnalysis): string {
  const changed = analysis.nodes.filter((node) => node.change);
  const neighbours = analysis.nodes.length - changed.length;
  const out: string[] = [];

  if (changed.length === 0) {
    out.push("No module in the dependency graph changed in this PR.");
  } else {
    out.push(
      `**${changed.length}** changed module(s) · **${neighbours}** direct neighbour(s) · ` +
        `**${analysis.edges.length}** dependenc${analysis.edges.length === 1 ? "y" : "ies"}`,
      "",
      "```mermaid",
      renderDependencyMermaid(analysis),
      "```",
      "",
      "<sub>🟨 modified · 🟩 added · 🟦 renamed · dashed border = test · " +
        "dashed arrow = type-only · `lazy` = dynamic import</sub>",
    );
    if (analysis.omittedNodes > 0) {
      out.push(
        "",
        `> [!NOTE]\n> ${analysis.omittedNodes} node(s) left out to stay within the diagram limit ` +
          "(`dependencies.maxNodes`).",
      );
    }
  }

  if (analysis.outsideGraph.length > 0) {
    const items = analysis.outsideGraph.map((file) =>
      file.previousPath
        ? `- ${inlineCode(file.previousPath)} → ${inlineCode(file.path)} (${STATUS_LABEL[file.status]})`
        : `- ${inlineCode(file.path)} (${STATUS_LABEL[file.status]})`,
    );
    out.push(
      "",
      `<details><summary>${analysis.outsideGraph.length} changed file(s) outside the graph</summary>`,
      "",
      ...items,
      "",
      "</details>",
    );
  }

  for (const warning of analysis.warnings) {
    out.push("", `> [!WARNING]\n> ${warning}`);
  }
  return out.join("\n");
}
