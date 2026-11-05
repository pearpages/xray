import type { ApiAnalysis } from "./api/analyze.js";
import { renderApiSection } from "./api/render.js";
import { analyzeBundle, type BundleAnalysis } from "./bundle/analyze.js";
import { renderBundleSection } from "./bundle/render.js";
import { loadConfig, type XrayConfig } from "./config.js";
import { analyzeDependencies, type DependencyAnalysis } from "./dependencies/analyze.js";
import { renderDependencySection } from "./dependencies/render.js";
import { getChangedFiles, getChangedLines, git, resolveMergeBase, type ChangedFile } from "./git.js";
import type { InteractionsAnalysis } from "./interactions/analyze.js";
import { renderInteractionsSection } from "./interactions/render.js";
import { renderReport, type ReportMeta, type ReportSection } from "./report.js";
import type { RiskAnalysis } from "./risk/analyze.js";
import { renderRiskSection } from "./risk/render.js";

/**
 * The PR report without a static path to ts-morph: the ts-morph analyses are imported only
 * when selected, so `--only dependencies` never loads them (ADR-0021). The CLI imports this
 * entry (`@xray/core/pr`); `@xray/core` re-exports it with everything else.
 */

export const PR_ANALYZERS = ["dependencies", "interactions", "risk", "api", "bundle"] as const;
export type PrAnalyzerId = (typeof PR_ANALYZERS)[number];

export function isPrAnalyzer(id: string): id is PrAnalyzerId {
  return (PR_ANALYZERS as readonly string[]).includes(id);
}

export interface AnalyzeOptions {
  cwd: string;
  /** Branch the PR targets, e.g. `main`. */
  base: string;
  /** Overrides `xray.config.json`. */
  config?: XrayConfig;
  /**
   * Commit reported as the PR head. Defaults to HEAD. CI checkouts of a PR
   * sit on a temporary merge commit, so the caller passes the PR's real head.
   */
  head?: string;
  /** Analyses to run; default all. The others are neither run nor in the result. */
  only?: PrAnalyzerId[];
}

/** Everything xray knows about a PR, as data. Renderers turn it into Markdown. */
export interface XrayResult {
  /** The JSON contract's version (ADR-0019, ADR-0021). */
  version: 1;
  meta: ReportMeta;
  changed: ChangedFile[];
  /** Each analysis is absent when `only` left it out. */
  dependencies?: DependencyAnalysis;
  interactions?: InteractionsAnalysis;
  risk?: RiskAnalysis;
  api?: ApiAnalysis;
  bundle?: BundleAnalysis;
  /** Kept so renderers can apply the same limits the analyses used. */
  config: XrayConfig;
}

export async function analyzePullRequest(options: AnalyzeOptions): Promise<XrayResult> {
  const { cwd, base } = options;
  const selected = new Set<PrAnalyzerId>(options.only ?? PR_ANALYZERS);
  const config = options.config ?? loadConfig(cwd);
  const mergeBase = resolveMergeBase(cwd, base);
  const head = options.head ?? git(cwd, ["rev-parse", "HEAD"]);
  const changed = getChangedFiles(cwd, mergeBase);
  const result: XrayResult = { version: 1, meta: { base, mergeBase, head }, changed, config };

  if (selected.has("dependencies")) result.dependencies = await analyzeDependencies(cwd, changed, config);
  if (selected.has("interactions") || selected.has("risk") || selected.has("api")) {
    // Loaded once, shared by the ts-morph analyses.
    const { loadChangedCode } = await import("./interactions/changed-code.js");
    const code = loadChangedCode(cwd, changed, getChangedLines(cwd, mergeBase), mergeBase, config);
    if (selected.has("interactions") || selected.has("risk")) {
      const { analyzeInteractions } = await import("./interactions/analyze.js");
      // Risk lights features, so it needs the interactions even when they aren't reported.
      const interactions = analyzeInteractions(cwd, code, config);
      if (selected.has("interactions")) result.interactions = interactions;
      if (selected.has("risk")) {
        const { analyzeRisk } = await import("./risk/analyze.js");
        result.risk = analyzeRisk(cwd, code, interactions, config);
      }
    }
    if (selected.has("api")) {
      const { analyzeApi } = await import("./api/analyze.js");
      result.api = analyzeApi(cwd, mergeBase, changed, code);
    }
  }
  if (selected.has("bundle")) result.bundle = analyzeBundle(cwd, mergeBase, changed, config);
  return result;
}

export function reportSections(result: XrayResult): ReportSection[] {
  const sections: ReportSection[] = [];
  if (result.dependencies) {
    sections.push({ id: "dependencies", title: "🧭 Dependencies", markdown: renderDependencySection(result.dependencies) });
  }
  if (result.interactions) {
    sections.push({
      id: "interactions",
      title: "🔀 Interactions",
      markdown: renderInteractionsSection(result.interactions, result.config.interactions.maxDiagrams),
    });
  }
  if (result.risk) sections.push({ id: "risk", title: "🚦 Impact and risk", markdown: renderRiskSection(result.risk) });
  if (result.api) sections.push({ id: "api", title: "📜 Public API", markdown: renderApiSection(result.api) });
  // Opt-in: no section at all when the bundle wasn't measured.
  if (result.bundle && result.bundle.status !== "disabled") {
    sections.push({ id: "bundle", title: "📦 Bundle size", markdown: renderBundleSection(result.bundle) });
  }
  return sections;
}

export function renderMarkdown(result: XrayResult): string {
  return renderReport(result.meta, reportSections(result));
}

// What the CLI needs besides the analyses, from this ts-morph-free entry.
export { loadConfig, type XrayConfig } from "./config.js";
export * from "./agent/report.js";
export { prAgentResults } from "./agent/pr.js";
export type * from "./agent/types.js";
