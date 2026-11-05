import type { AgentAnalyzerResult } from "./report.js";
import type { AgentFinding, AgentSeverity } from "./types.js";
import type { PrAnalyzerId, XrayResult } from "../pr.js";
import { splitUnitId } from "../interactions/ids.js";
import { evidenceStrength } from "../risk/lights.js";

/**
 * The PR report as agent findings: the mapping table of ADR-0021. Changing a severity here
 * changes the agent contract, so it bumps `AgentReport.version`.
 */
export function prAgentResults(result: XrayResult): AgentAnalyzerResult[] {
  const out: AgentAnalyzerResult[] = [];
  const add = (analyzer: PrAnalyzerId, summary: string, findings: Omit<AgentFinding, "analyzer">[], status: "ok" | "unavailable" = "ok") =>
    out.push({ analyzer, status, summary, findings: findings.map((finding) => ({ analyzer, ...finding })) });

  const { dependencies, interactions, risk, api, bundle } = result;

  if (dependencies) {
    const changed = dependencies.nodes.filter((node) => node.change).length;
    const findings = (dependencies.boundaries ?? []).map((violation) => ({
      file: violation.file,
      ...(violation.line ? { line: violation.line } : {}),
      severity: (violation.kind === "cycle" ? "high" : "medium") as AgentSeverity,
      message: violation.message,
    }));
    const boundaries = dependencies.boundaries === undefined ? "no feature boundaries to check (fewer than two features)" : `${findings.length} boundary violation(s)`;
    add("dependencies", `${changed} changed module(s) in a ${dependencies.level}-level graph of ${dependencies.nodes.length} node(s); ${boundaries}.`, findings);
  }

  if (interactions) {
    const findings: Omit<AgentFinding, "analyzer">[] = [];
    if (interactions.featureMap === "invalid") {
      findings.push({ file: result.config.interactions.featureMap, severity: "medium", message: "the feature map is invalid; features fall back to entry points" });
    }
    for (const id of interactions.unmapped) {
      const { file, name } = splitUnitId(id);
      findings.push({ file, severity: "low", message: `\`${name}\` is in no feature of the feature map` });
    }
    const skipped = interactions.skipped ? ` Walk skipped: more than ${interactions.skipped.limit} touched units.` : "";
    add(
      "interactions",
      `${interactions.touched.length} touched unit(s) in ${interactions.features.length} feature(s); feature map ${interactions.featureMap}.${skipped}`,
      findings,
    );
  }

  if (risk) {
    const findings = risk.units.flatMap((unit) =>
      unit.light === "green"
        ? []
        : [
            {
              file: unit.file,
              line: unit.line,
              severity: (unit.light === "red" ? "high" : "medium") as AgentSeverity,
              message: `\`${unit.name}\` (${unit.change}) is ${unit.light}: ${evidenceText(evidenceStrength(unit.evidence))}, complexity ${complexityText(unit.complexity)}`,
            },
          ],
    );
    const red = risk.units.filter((unit) => unit.light === "red").length;
    const yellow = risk.units.filter((unit) => unit.light === "yellow").length;
    const skipped = risk.skipped ? ` Skipped: more than ${risk.skipped.limit} touched units.` : "";
    add("risk", `PR is ${risk.light}: ${red} red and ${yellow} yellow of ${risk.units.length} touched unit(s).${skipped}`, findings);
  }

  if (api) {
    const severityOf = (change: { change: string; compatibility: string }): AgentSeverity | undefined =>
      change.compatibility === "breaking" ? "high" : change.compatibility === "review" ? "medium" : change.change === "added" ? "low" : undefined;
    const findings: Omit<AgentFinding, "analyzer">[] = [];
    for (const change of api.exports) {
      const severity = severityOf(change);
      if (!severity) continue;
      const usedBy = change.usedBy.length > 0 ? `; used by ${change.usedBy.length} file(s)` : "";
      const details = change.details.length > 0 ? `: ${change.details.join("; ")}` : "";
      findings.push({ file: change.file, severity, message: `export \`${change.name}\` ${change.change} (${change.compatibility})${details}${usedBy}` });
    }
    for (const endpoint of api.endpoints) {
      const severity = severityOf(endpoint);
      if (severity) findings.push({ file: endpoint.file, severity, message: `endpoint ${endpoint.method} ${endpoint.path} ${endpoint.change} (${endpoint.compatibility})` });
    }
    const breaking = findings.filter((finding) => finding.severity === "high").length;
    add("api", `API is ${api.compatibility}: ${breaking} breaking of ${api.exports.length} export and ${api.endpoints.length} endpoint change(s).`, findings);
  }

  if (bundle) {
    if (bundle.status === "disabled") {
      add("bundle", "Not measured: pass --bundle (it installs and builds the base and the PR).", [], "unavailable");
    } else if (bundle.status === "failed") {
      add("bundle", `Not measured: the build failed: ${(bundle.error ?? "unknown error").split("\n")[0]}`, [], "unavailable");
    } else {
      const findings: Omit<AgentFinding, "analyzer">[] = [];
      const growth = bundle.before && bundle.after ? bundle.after.gzip - bundle.before.gzip : 0;
      if (bundle.light === "red" || bundle.light === "yellow") {
        const top = bundle.chunks
          .slice(0, 3)
          .map((chunk) => `${chunk.key} ${signed((chunk.after?.gzip ?? 0) - (chunk.before?.gzip ?? 0))}`)
          .join(", ");
        findings.push({
          file: "package.json",
          severity: bundle.light === "red" ? "high" : "medium",
          message: `bundle grew ${signed(growth)} gzip${top ? ` (${top})` : ""}`,
        });
      }
      for (const change of bundle.dependencyChanges) {
        if (change.after === undefined) continue;
        findings.push({
          file: change.file,
          severity: "low",
          message: change.before === undefined ? `adds dependency ${change.name}@${change.after}` : `${change.name} ${change.before} → ${change.after}`,
        });
      }
      add("bundle", `Bundle is ${bundle.light ?? "green"}: ${signed(growth)} gzip in total, ${bundle.chunks.length} chunk(s) changed.`, findings);
    }
  }
  return out;
}

function signed(bytes: number): string {
  const kb = Math.abs(bytes) >= 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${bytes} B`;
  return bytes > 0 ? `+${kb}` : kb;
}

function evidenceText(kind: string): string {
  return kind === "none" ? "no test reaches it" : `only ${kind} test evidence`;
}

function complexityText(complexity: { before?: number; after: number }): string {
  return complexity.before === undefined ? `${complexity.after}` : `${complexity.before} → ${complexity.after}`;
}
