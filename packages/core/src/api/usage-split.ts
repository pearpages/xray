import { isTestFile } from "../files.js";

/** Importers split into code and tests. Free of ts-morph, so the renderer can use it. */
export function splitUsages(usedBy: string[]): { code: string[]; tests: string[] } {
  return { code: usedBy.filter((file) => !isTestFile(file)), tests: usedBy.filter(isTestFile) };
}
