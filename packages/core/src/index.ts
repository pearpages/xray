import { analyzeApi, type ApiAnalysis } from "./api/analyze.js";
import { renderApiSection } from "./api/render.js";
import { analyzeBundle, type BundleAnalysis } from "./bundle/analyze.js";
import { renderBundleSection } from "./bundle/render.js";
import { loadConfig, type XrayConfig } from "./config.js";
import { analyzeDependencies, type DependencyAnalysis } from "./dependencies/analyze.js";
import { renderDependencySection } from "./dependencies/render.js";
import { getChangedFiles, getChangedLines, git, resolveMergeBase, type ChangedFile } from "./git.js";
import { analyzeInteractions, type InteractionsAnalysis } from "./interactions/analyze.js";
import { loadChangedCode } from "./interactions/changed-code.js";
import { renderInteractionsSection } from "./interactions/render.js";
import { renderReport, type ReportMeta, type ReportSection } from "./report.js";
import { analyzeRisk, type RiskAnalysis } from "./risk/analyze.js";
import { renderRiskSection } from "./risk/render.js";

export * from "./config.js";
export * from "./git.js";
export * from "./report.js";
export * from "./dependencies/analyze.js";
export * from "./dependencies/render.js";
export * from "./interactions/analyze.js";
export * from "./interactions/features.js";
export * from "./interactions/inventory.js";
export * from "./interactions/render.js";
export type { Interaction, RelationKind } from "./interactions/walk.js";
export * from "./api/analyze.js";
export * from "./api/compare.js";
export * from "./api/exports.js";
export * from "./api/render.js";
export * from "./bundle/analyze.js";
export * from "./bundle/measure.js";
export * from "./bundle/render.js";
export * from "./risk/analyze.js";
export * from "./risk/render.js";

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
}

/** Everything xray knows about a PR, as data. Renderers turn it into Markdown. */
export interface XrayResult {
  meta: ReportMeta;
  changed: ChangedFile[];
  dependencies: DependencyAnalysis;
  interactions: InteractionsAnalysis;
  risk: RiskAnalysis;
  api: ApiAnalysis;
  bundle: BundleAnalysis;
  /** Kept so renderers can apply the same limits the analyses used. */
  config: XrayConfig;
}

export async function analyzePullRequest(options: AnalyzeOptions): Promise<XrayResult> {
  const { cwd, base } = options;
  const config = options.config ?? loadConfig(cwd);
  const mergeBase = resolveMergeBase(cwd, base);
  const head = options.head ?? git(cwd, ["rev-parse", "HEAD"]);
  const changed = getChangedFiles(cwd, mergeBase);
  // Loaded once, shared by the ts-morph analyses.
  const code = loadChangedCode(cwd, changed, getChangedLines(cwd, mergeBase), mergeBase, config);
  const interactions = analyzeInteractions(cwd, code, config);
  return {
    meta: { base, mergeBase, head },
    changed,
    dependencies: await analyzeDependencies(cwd, changed, config),
    interactions,
    risk: analyzeRisk(cwd, code, interactions, config),
    api: analyzeApi(cwd, mergeBase, changed, code),
    bundle: analyzeBundle(cwd, mergeBase, changed, config),
    config,
  };
}

export function reportSections(result: XrayResult): ReportSection[] {
  const sections: ReportSection[] = [
    {
      id: "dependencies",
      title: "🧭 Dependencies",
      markdown: renderDependencySection(result.dependencies),
    },
    {
      id: "interactions",
      title: "🔀 Interactions",
      markdown: renderInteractionsSection(
        result.interactions,
        result.config.interactions.maxDiagrams,
      ),
    },
    {
      id: "risk",
      title: "🚦 Impact and risk",
      markdown: renderRiskSection(result.risk),
    },
    {
      id: "api",
      title: "📜 Public API",
      markdown: renderApiSection(result.api),
    },
  ];
  // Opt-in: no section at all when the bundle wasn't measured.
  if (result.bundle.status !== "disabled") {
    sections.push({ id: "bundle", title: "📦 Bundle size", markdown: renderBundleSection(result.bundle) });
  }
  return sections;
}

export function renderMarkdown(result: XrayResult): string {
  return renderReport(result.meta, reportSections(result));
}
