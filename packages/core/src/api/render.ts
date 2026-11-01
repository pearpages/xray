import { inlineCode } from "../dependencies/render.js";
import { splitUsages, type ApiAnalysis, type ApiChange } from "./analyze.js";
import type { Compatibility } from "./compare.js";

const DOT: Record<Compatibility, string> = { compatible: "🟢", review: "🟡", breaking: "🔴" };
const LABEL: Record<Compatibility, string> = { compatible: "compatible", review: "to review", breaking: "breaking" };

/** Long types stay readable in a table cell; the JSON keeps them whole. */
const MAX_DETAIL = 140;

function changeText(change: ApiChange): string {
  if (change.change === "added") return "added";
  if (change.change === "removed") return "removed";
  return change.details
    .map((detail) => (detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL - 1)}…\`` : detail))
    .join("; ");
}

function usedByText(change: ApiChange): string {
  if (change.change === "added") return "";
  const { code, tests } = splitUsages(change.usedBy);
  const parts = [];
  if (code.length > 0) parts.push(`${code.length} file${code.length === 1 ? "" : "s"}`);
  if (tests.length > 0) parts.push(`${tests.length} test${tests.length === 1 ? "" : "s"}`);
  return parts.join(", ") || "nothing";
}

export function renderApiSection(api: ApiAnalysis): string {
  if (api.exports.length === 0 && api.endpoints.length === 0) {
    return ["No exported API or endpoint changed.", ...api.warnings.map((w) => `\n> [!WARNING]\n> ${w}`)].join("\n");
  }
  const all = [...api.exports, ...api.endpoints];
  const counts = (["breaking", "review", "compatible"] as const)
    .map((level) => [level, all.filter((change) => change.compatibility === level).length] as const)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${DOT[level]} ${count} ${LABEL[level]}`);
  const out = [`**${counts.join(" · ")}**`];

  if (api.exports.length > 0) {
    out.push(
      "",
      "| | Export | Change | Used by |",
      "|---|---|---|---|",
      ...api.exports.map(
        (change) =>
          `| ${DOT[change.compatibility]} | ${change.public ? "📦 " : ""}${inlineCode(change.name)}<br><sub>${change.file}</sub> | ` +
          `${changeText(change)} | ${usedByText(change)} |`,
      ),
    );
    const affected = api.exports.filter((change) => change.compatibility !== "compatible" && change.usedBy.length > 0);
    if (affected.length > 0) {
      out.push(
        "",
        `<details><summary>Affected usages</summary>`,
        "",
        ...affected.map((change) => `- ${inlineCode(change.name)}: ${change.usedBy.map((file) => inlineCode(file)).join(", ")}`),
        "",
        "</details>",
      );
    }
  }
  if (api.endpoints.length > 0) {
    out.push(
      "",
      "| | Endpoint | Change | Declared in |",
      "|---|---|---|---|",
      ...api.endpoints.map(
        (endpoint) =>
          `| ${DOT[endpoint.compatibility]} | ${inlineCode(`${endpoint.method} ${endpoint.path}`)} | ${endpoint.change} | ` +
          `${inlineCode(endpoint.file)} |`,
      ),
    );
  }
  for (const warning of api.warnings) out.push("", `> [!WARNING]\n> ${warning}`);
  out.push(
    "",
    "<sub>📦 exported by a workspace package. Read from the source text: 🔴 callers must change · " +
      "🟡 types changed, check the callers · 🟢 nothing to do for callers.</sub>",
  );
  return out.join("\n");
}
