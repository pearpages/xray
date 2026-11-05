import { buildDependencyGraph, checkBoundaries, detectFeatures } from "@xray/core";
import { findingsScore, unavailable } from "../score.js";
import type { Analyzer, Finding } from "../types.js";

// The rules live in core (`dependencies/boundaries.ts`): the PR report checks them too (ADR-0021).
export { importLine, type Feature, type FeatureViolations } from "@xray/core";

export const architecture: Analyzer = {
  id: "architecture",
  name: "Architecture",
  phase: 1,
  async analyze({ root, config, codeFiles }) {
    const { source, features } = detectFeatures(root, config.xray.interactions.featureMap, config.architecture, codeFiles);
    if (features.length < 2) {
      return unavailable(
        "architecture",
        "Architecture",
        `fewer than two features (no xray.features.json features with \`files\`, and no folders matching ${config.architecture.features.join(", ")})`,
      );
    }
    const graph = await buildDependencyGraph(root, config.xray);
    const { violations, groups, cycles } = checkBoundaries(root, features, graph.edges);
    const findings: Finding[] = violations.map((violation) => ({
      file: violation.file,
      ...(violation.line ? { line: violation.line } : {}),
      severity: violation.kind === "cycle" ? "high" : "medium",
      message: violation.message,
    }));

    const deep = findings.filter((finding) => finding.severity === "medium").length;
    return {
      id: "architecture",
      name: "Architecture",
      score: findingsScore(findings, codeFiles.length, config.severityPenalty),
      summary:
        deep === 0 && cycles.length === 0
          ? `${features.length} features (from ${source}); every import between them goes through a public API.`
          : `${features.length} features (from ${source}): ${deep} deep import(s), ${cycles.length} cycle(s) between features.`,
      findings,
      status: "ok",
      data: {
        source,
        features: features.map((feature) => ({ id: feature.id, name: feature.name, files: feature.files.length, publicApi: feature.publicApi })),
        violations: groups,
        cycles,
      },
    };
  },
};
