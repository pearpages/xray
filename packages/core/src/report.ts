export interface ReportSection {
  /** Stable id, used as an HTML anchor and by tools that read the JSON. */
  id: string;
  title: string;
  markdown: string;
}

export interface ReportMeta {
  base: string;
  mergeBase: string;
  head: string;
}

/** Hidden marker the GitHub Action uses to find and update its own comment. */
export const REPORT_MARKER = "<!-- xray:report -->";

export function renderReport(meta: ReportMeta, sections: ReportSection[]): string {
  const parts = [
    REPORT_MARKER,
    "# 🩻 xray",
    "",
    `<sub>Comparing \`${meta.head.slice(0, 7)}\` with \`${meta.base}\` ` +
      `(merge-base \`${meta.mergeBase.slice(0, 7)}\`)</sub>`,
  ];
  for (const section of sections) {
    parts.push("", `## ${section.title}`, "", section.markdown);
  }
  return `${parts.join("\n")}\n`;
}
