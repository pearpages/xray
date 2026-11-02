import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Writes the report to `file`, creating the folders it needs. */
export function writeReport(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
