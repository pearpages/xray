import { inlineCode } from "../dependencies/render.js";
import { splitUnitId } from "../interactions/analyze.js";
import type { Light, RiskAnalysis, TestEvidence, UnitRisk } from "./analyze.js";

const DOT: Record<Light, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const VERDICT: Record<Light, string> = { green: "Low risk", yellow: "Medium risk", red: "High risk" };

function evidenceText(evidence: TestEvidence): string {
  switch (evidence.kind) {
    case "direct":
      return `direct (${evidence.tests.length} test file${evidence.tests.length === 1 ? "" : "s"})`;
    case "by-name":
      return `by name (${evidence.tests.map((test) => inlineCode(test.split("/").pop()!)).join(", ")})`;
    case "indirect": {
      const test = evidence.tests[0]?.split("/").pop();
      const more = evidence.tests.length > 1 ? ` +${evidence.tests.length - 1}` : "";
      return `via ${inlineCode(splitUnitId(evidence.via).name)} (+${evidence.depth}, ${inlineCode(test ?? "?")}${more})`;
    }
    case "none":
      return "**none**";
  }
}

function complexityText({ complexity }: UnitRisk): string {
  if (complexity.before === undefined) return `${complexity.after} (new)`;
  const growth = complexity.after - complexity.before;
  if (growth === 0) return String(complexity.after);
  return `${complexity.before} → ${complexity.after} (${growth > 0 ? "+" : ""}${growth})`;
}

function summary(risk: RiskAnalysis): string {
  const untested = risk.units.filter((unit) => unit.evidence.kind === "none").length;
  const parts = [
    untested === 0
      ? `a test reaches every changed unit (${risk.units.length})`
      : `${untested} of ${risk.units.length} changed unit(s) have no test reaching them`,
  ];
  if (risk.growing.length > 0) parts.push(`${risk.growing.length} got more complex`);
  return `**${DOT[risk.light]} ${VERDICT[risk.light]}** — ${parts.join(", ")}.`;
}

export function renderRiskSection(risk: RiskAnalysis): string {
  if (risk.skipped) {
    return (
      `> [!NOTE]\n> Too many changed units (more than ${risk.skipped.limit}, ` +
      "`interactions.maxTouchedUnits`): risk is not assessed."
    );
  }
  if (risk.units.length === 0) return "No function, component or hook changed in this PR.";

  const byId = new Map(risk.units.map((unit) => [unit.id, unit]));
  const out = [summary(risk)];
  if (risk.features.length > 0) {
    // Green features only as a count: on a broad PR they are most of the list.
    const flagged = risk.features.filter((feature) => feature.light !== "green");
    const green = risk.features.length - flagged.length;
    const items = [...flagged]
      .sort((a, b) => (a.light === b.light ? 0 : a.light === "red" ? -1 : 1))
      .map((feature) => `${DOT[feature.light]} ${feature.name}`);
    if (green > 0) items.push(flagged.length > 0 ? `🟢 ${green} more` : risk.features.map((f) => `🟢 ${f.name}`).join(" · "));
    out.push("", `Features: ${items.join(" · ")}`);
  }
  out.push(
    "",
    "| | Changed | Tests | Complexity |",
    "|---|---|---|---|",
    ...[...risk.units]
      .sort((a, b) => ({ red: 0, yellow: 1, green: 2 })[a.light] - ({ red: 0, yellow: 1, green: 2 })[b.light])
      .map(
        (unit) =>
          `| ${DOT[unit.light]} | ${inlineCode(unit.name)}${unit.change === "added" ? " 🆕" : ""} | ` +
          `${evidenceText(unit.evidence)} | ${complexityText(unit)} |`,
      ),
  );

  const untested = risk.features.filter((feature) => risk.untestedFeatures.includes(feature.id));
  if (untested.length > 0) {
    out.push("", `**Features without tests:** ${untested.map((feature) => feature.name).join(", ")}`);
  }
  if (risk.growing.length > 0) {
    const growing = risk.growing.map((id) => {
      const unit = byId.get(id)!;
      return `${inlineCode(unit.name)} ${unit.complexity.before} → ${unit.complexity.after}`;
    });
    out.push("", `**Growing complexity:** ${growing.join(", ")}`);
  }
  out.push(
    "",
    "<sub>Tests are found statically (a test file uses the unit, is named after its file, or uses " +
      "a caller); none are run. Complexity is cyclomatic. 🔴 untested and complex or much more " +
      "complex · 🟡 untested, or only indirectly tested and more complex · 🟢 otherwise.</sub>",
  );
  return out.join("\n");
}
