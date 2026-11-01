import { loadConfig, type XrayConfig } from "./config.js";
import { analyzeDependencies, type DependencyAnalysis } from "./dependencies/analyze.js";
import { renderDependencySection } from "./dependencies/render.js";
import { getChangedFiles, getChangedLines, git, resolveMergeBase, type ChangedFile } from "./git.js";
import { analyzeInteractions, type InteractionsAnalysis } from "./interactions/analyze.js";
import { renderInteractionsSection } from "./interactions/render.js";
import { renderReport, type ReportMeta, type ReportSection } from "./report.js";

export * from "./config.js";
export * from "./git.js";
export * from "./report.js";
export * from "./dependencies/analyze.js";
export * from "./dependencies/render.js";
export * from "./interactions/analyze.js";
export * from "./interactions/features.js";
export * from "./interactions/render.js";
export type { Interaction, RelationKind } from "./interactions/walk.js";

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
  /** Kept so renderers can apply the same limits the analyses used. */
  config: XrayConfig;
}

export async function analyzePullRequest(options: AnalyzeOptions): Promise<XrayResult> {
  const { cwd, base } = options;
  const config = options.config ?? loadConfig(cwd);
  const mergeBase = resolveMergeBase(cwd, base);
  const head = options.head ?? git(cwd, ["rev-parse", "HEAD"]);
  const changed = getChangedFiles(cwd, mergeBase);
  return {
    meta: { base, mergeBase, head },
    changed,
    dependencies: await analyzeDependencies(cwd, changed, config),
    interactions: await analyzeInteractions(
      cwd,
      changed,
      getChangedLines(cwd, mergeBase),
      mergeBase,
      config,
    ),
    config,
  };
}

export function reportSections(result: XrayResult): ReportSection[] {
  return [
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
  ];
}

export function renderMarkdown(result: XrayResult): string {
  return renderReport(result.meta, reportSections(result));
}
