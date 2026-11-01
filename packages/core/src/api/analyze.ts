import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "ts-morph";
import { isTestFile } from "../dependencies/analyze.js";
import { showFile, type ChangedFile } from "../git.js";
import type { ChangedCode } from "../interactions/changed-code.js";
import { discoverWorkspace } from "../workspaces.js";
import { compareExports, worstOf, type Compatibility, type ExportChange } from "./compare.js";
import { exportsOf } from "./exports.js";
import { routeChanges } from "./routes.js";
import { UsageIndex } from "./usages.js";

export interface ApiChange extends ExportChange {
  file: string;
  /** Exported from a workspace package's entry point (directly or through barrels). */
  public: boolean;
  /** Files that import it, repo-relative; for removed and changed exports only. */
  usedBy: string[];
}

export interface EndpointChange {
  /** The OpenAPI spec or the Next.js route file that declares it. */
  file: string;
  method: string;
  path: string;
  change: "added" | "removed";
  compatibility: Compatibility;
}

export interface ApiAnalysis {
  compatibility: Compatibility;
  exports: ApiChange[];
  endpoints: EndpointChange[];
  warnings: string[];
}

const OPENAPI = /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i;
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function operations(text: string | undefined): Set<string> {
  if (!text) return new Set();
  const spec = JSON.parse(text) as { paths?: Record<string, Record<string, unknown>> };
  const ops = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      if (METHODS.includes(method.toLowerCase())) ops.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return ops;
}

/** Operations added and removed in changed OpenAPI JSON files. */
function endpointChanges(cwd: string, mergeBase: string, changed: ChangedFile[], warnings: string[]): EndpointChange[] {
  const changes: EndpointChange[] = [];
  for (const file of changed.filter((candidate) => OPENAPI.test(candidate.path))) {
    if (!file.path.endsWith(".json")) {
      warnings.push(`${file.path}: OpenAPI in YAML is not compared yet; only JSON specs are.`);
      continue;
    }
    try {
      const before = operations(file.status === "added" ? undefined : showFile(cwd, mergeBase, file.previousPath ?? file.path));
      const after = operations(file.status === "deleted" ? undefined : readFileSync(join(cwd, file.path), "utf8"));
      for (const op of before) {
        if (after.has(op)) continue;
        const [method, path] = op.split(" ") as [string, string];
        changes.push({ file: file.path, method, path, change: "removed", compatibility: "breaking" });
      }
      for (const op of after) {
        if (before.has(op)) continue;
        const [method, path] = op.split(" ") as [string, string];
        changes.push({ file: file.path, method, path, change: "added", compatibility: "compatible" });
      }
    } catch (error) {
      warnings.push(`${file.path}: could not read the OpenAPI spec (${(error as Error).message}).`);
    }
  }
  return changes;
}

/** Entry files of workspace packages, the code other packages can import. */
function packageEntries(cwd: string, code: ChangedCode): Set<SourceFile> {
  const entries = new Set<SourceFile>();
  for (const pkg of discoverWorkspace(cwd) ?? []) {
    for (const file of pkg.entries.values()) {
      const source = code.loaded.project.getSourceFile(file);
      if (source) entries.add(source);
    }
  }
  return entries;
}

export function analyzeApi(
  cwd: string,
  mergeBase: string,
  changed: ChangedFile[],
  code: ChangedCode | undefined,
): ApiAnalysis {
  const warnings: string[] = [];
  const endpoints = [...endpointChanges(cwd, mergeBase, changed, warnings), ...(code ? routeChanges(code.files) : [])];
  const exports: ApiChange[] = [];

  if (code) {
    const usages = new UsageIndex(code.loaded.project, code.loaded.resolveModule);
    const entries = packageEntries(cwd, code);
    const relative = (file: SourceFile) => code.loaded.fileOf(file) ?? file.getFilePath();
    for (const source of code.files) {
      const changes = compareExports(source.base ? exportsOf(source.base) : [], source.head ? exportsOf(source.head) : []);
      const anchor = source.head ?? code.loaded.project.getSourceFile(join(cwd, source.change.path));
      for (const change of changes) {
        const usedBy =
          change.change !== "added" && anchor
            ? usages
                .usersOf(anchor, change.name)
                .map(relative)
                .filter((file) => file !== source.change.path)
                .sort()
            : [];
        exports.push({
          ...change,
          file: source.change.path,
          public: anchor ? usages.reachesEntry(anchor, entries) : false,
          usedBy,
        });
      }
    }
  }

  const ordered = exports.sort(
    (a, b) =>
      ({ breaking: 0, review: 1, compatible: 2 })[a.compatibility] -
        ({ breaking: 0, review: 1, compatible: 2 })[b.compatibility] ||
      Number(b.public) - Number(a.public) ||
      a.file.localeCompare(b.file),
  );
  return {
    compatibility: worstOf([...ordered, ...endpoints].map((change) => change.compatibility)),
    exports: ordered,
    endpoints,
    warnings,
  };
}

/** Usages in tests are listed apart: they break the suite, not the product. */
export function splitUsages(usedBy: string[]): { code: string[]; tests: string[] } {
  return { code: usedBy.filter((file) => !isTestFile(file)), tests: usedBy.filter(isTestFile) };
}
