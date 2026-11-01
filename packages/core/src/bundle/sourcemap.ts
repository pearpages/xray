const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((char, index) => [char, index]));

/** Decodes one source map segment (base64 VLQ) into its numeric fields. */
export function decodeSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = DIGIT.get(char);
    if (digit === undefined) throw new Error(`Invalid VLQ character "${char}"`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

export interface SourceMapLike {
  sources: string[];
  mappings: string;
}

/**
 * Generated characters per original source: each mapped segment owns the code
 * up to the next segment on its line. Unmapped code (runtime helpers) goes to "".
 */
export function bytesPerSource(code: string, map: SourceMapLike): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (source: string, bytes: number) => totals.set(source, (totals.get(source) ?? 0) + bytes);
  const lines = code.split("\n");
  let sourceIndex = 0;
  map.mappings.split(";").forEach((line, lineNumber) => {
    const length = (lines[lineNumber] ?? "").length;
    let column = 0;
    let previousColumn = 0;
    let previousSource: string | undefined;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const fields = decodeSegment(segment);
      column += fields[0] ?? 0;
      add(previousSource ?? "", column - previousColumn);
      previousColumn = column;
      if (fields.length >= 4) {
        sourceIndex += fields[1] ?? 0;
        previousSource = map.sources[sourceIndex] ?? "";
      } else {
        previousSource = "";
      }
    }
    add(previousSource ?? "", Math.max(0, length - previousColumn));
  });
  totals.delete("");
  return totals;
}

/** `../node_modules/.pnpm/react-dom@19/node_modules/react-dom/cjs/x.js` → `react-dom`; app code → undefined. */
export function packageOfSource(source: string): string | undefined {
  const parts = source.split("/");
  const at = parts.lastIndexOf("node_modules");
  if (at === -1) return undefined;
  const name = parts[at + 1];
  if (!name) return undefined;
  return name.startsWith("@") ? `${name}/${parts[at + 2] ?? ""}` : name;
}
