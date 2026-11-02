import { parseReport, type QualityReport } from "./reports";

const KEY = "xray-quality:reports";

/** The browser's localStorage, or undefined where it can't be used (private mode, blocked site data). */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Reports kept from the last visit; anything unreadable is dropped. */
export function loadSaved(storage: Storage | undefined): QualityReport[] {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? "[]") as unknown[];
    return saved.flatMap((report) => {
      try {
        return [parseReport(JSON.stringify(report), "saved report")];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Keeps the reports for the next visit. False when the browser refuses (full or blocked). */
export function save(storage: Storage | undefined, reports: QualityReport[]): boolean {
  if (!storage) return false;
  try {
    if (reports.length === 0) storage.removeItem(KEY);
    else storage.setItem(KEY, JSON.stringify(reports));
    return true;
  } catch {
    return false;
  }
}
