import { parseReport, type QualityReport } from "./reports";

/**
 * Every report in the reports home (ADR-0028), as the dev server serves it (`reports-home.ts`).
 * Nothing on a static copy of the app or when the server can't be reached; a damaged report is skipped.
 */
export async function loadHomeReports(fetcher: typeof fetch = fetch): Promise<QualityReport[]> {
  try {
    const index = await fetcher("reports/index.json");
    if (!index.ok || !index.headers.get("Content-Type")?.includes("application/json")) return [];
    const { reports } = (await index.json()) as { reports?: unknown };
    if (!Array.isArray(reports)) return [];
    const loaded = await Promise.all(
      reports
        .filter((path): path is string => typeof path === "string")
        .map(async (path) => {
          try {
            const response = await fetcher(`reports/${path.split("/").map(encodeURIComponent).join("/")}`);
            return response.ok ? [parseReport(await response.text(), path)] : [];
          } catch {
            return [];
          }
        }),
    );
    return loaded.flat();
  } catch {
    return [];
  }
}
