import { loadConfig, type XrayConfig } from "./config.js";
import { analyzeDependencies, type DependencyAnalysis } from "./dependencies/analyze.js";
import { renderDependencySection } from "./dependencies/render.js";
import { getChangedFiles, git, resolveMergeBase, type ChangedFile } from "./git.js";
import { renderReport, type ReportMeta, type ReportSection } from "./report.js";

export * from "./config.js";
export * from "./git.js";
export * from "./report.js";
export * from "./dependencies/analyze.js";
export * from "./dependencies/render.js";

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
  };
}

export function reportSections(result: XrayResult): ReportSection[] {
  return [
    {
      id: "dependencies",
      title: "🧭 Dependencies",
      markdown: renderDependencySection(result.dependencies),
    },
  ];
}

export function renderMarkdown(result: XrayResult): string {
  return renderReport(result.meta, reportSections(result));
}
