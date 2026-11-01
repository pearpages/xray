import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { bytesPerSource, packageOfSource, type SourceMapLike } from "./sourcemap.js";

export interface Sizes {
  raw: number;
  gzip: number;
  brotli: number;
}

export interface Chunk {
  /** Path in the output folder with the content hash removed, so builds can be matched. */
  key: string;
  file: string;
  sizes: Sizes;
}

export interface BuildMeasure {
  chunks: Chunk[];
  total: Sizes;
  /** Raw bytes per npm package (`(app)` for project code), from source maps. */
  packages?: Map<string, number>;
}

const ASSET = /\.(m?js|cjs|css)$/;

/** `assets/index-BqX3k2aL.js` → `assets/index.js`; `main.3f2a9c1b.chunk.js` → `main.chunk.js`. */
export function chunkKey(file: string): string {
  return file.replace(/[-.][A-Za-z0-9_-]{8,}(?=(\.chunk)?\.(m?js|cjs|css)$)/, "");
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function sizesOf(content: Buffer): Sizes {
  return {
    raw: content.length,
    gzip: gzipSync(content, { level: 9 }).length,
    brotli: brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

export function measure(outDir: string): BuildMeasure {
  const chunks: Chunk[] = [];
  const packages = new Map<string, number>();
  let mapped = false;
  for (const path of files(outDir).filter((file) => ASSET.test(file)).sort()) {
    const file = relative(outDir, path).split(sep).join("/");
    const content = readFileSync(path);
    const sizes = sizesOf(content);
    chunks.push({ key: chunkKey(file), file, sizes });

    const mapPath = `${path}.map`;
    if (!file.endsWith(".css") && existsSync(mapPath)) {
      mapped = true;
      const code = content.toString("utf8");
      const perSource = bytesPerSource(code, JSON.parse(readFileSync(mapPath, "utf8")) as SourceMapLike);
      for (const [source, bytes] of perSource) {
        const name = packageOfSource(source) ?? "(app)";
        packages.set(name, (packages.get(name) ?? 0) + bytes);
      }
    }
  }
  const total = chunks.reduce(
    (sum, chunk) => ({
      raw: sum.raw + chunk.sizes.raw,
      gzip: sum.gzip + chunk.sizes.gzip,
      brotli: sum.brotli + chunk.sizes.brotli,
    }),
    { raw: 0, gzip: 0, brotli: 0 },
  );
  return { chunks, total, ...(mapped ? { packages } : {}) };
}
