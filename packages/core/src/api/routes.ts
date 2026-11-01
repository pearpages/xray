import type { SourceFile } from "ts-morph";
import type { ChangedSource } from "../interactions/changed-code.js";
import type { Compatibility } from "./compare.js";
import { exportsOf } from "./exports.js";

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const APP_ROUTE = /(^|\/)app\/((?:.+\/)?)route\.[cm]?[jt]sx?$/;
const PAGES_API = /(^|\/)pages\/api\/(.+)\.[cm]?[jt]sx?$/;

/**
 * URL of a Next.js route file. App Router: `app/(shop)/cart/[id]/route.ts` →
 * `/cart/[id]` (route groups and `@slots` don't appear in the URL). Pages Router:
 * `pages/api/cart/index.ts` → `/api/cart`. Undefined for other files.
 */
export function routePath(file: string): string | undefined {
  const app = APP_ROUTE.exec(file);
  if (app) {
    const segments = (app[2] ?? "").split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
    return `/${segments.join("/")}`;
  }
  const pages = PAGES_API.exec(file);
  if (pages) {
    const segments = (pages[2] ?? "").split("/").filter((segment, index, all) => !(segment === "index" && index === all.length - 1));
    return `/api${segments.length ? `/${segments.join("/")}` : ""}`;
  }
  return undefined;
}

/** HTTP methods a route file handles: its exported handlers, or ANY for a Pages API default export. */
export function routeMethods(file: SourceFile | undefined, path: string): Set<string> {
  if (!file) return new Set();
  const names = exportsOf(file).map((symbol) => symbol.name);
  if (PAGES_API.test(path)) return new Set(names.includes("default") ? ["ANY"] : []);
  return new Set(names.filter((name) => HTTP_METHODS.includes(name)));
}

export interface RouteChange {
  file: string;
  method: string;
  path: string;
  change: "added" | "removed";
  compatibility: Compatibility;
}

/** Methods added and removed in changed Next.js route files. */
export function routeChanges(files: ChangedSource[]): RouteChange[] {
  const changes: RouteChange[] = [];
  for (const source of files) {
    const path = routePath(source.change.path);
    if (!path) continue;
    const before = routeMethods(source.base, source.change.previousPath ?? source.change.path);
    const after = routeMethods(source.head, source.change.path);
    // A moved route file changes the URL: the old one is gone, the new one appears.
    const oldPath = source.change.previousPath ? (routePath(source.change.previousPath) ?? path) : path;
    for (const method of before) {
      if (!after.has(method) || oldPath !== path) {
        changes.push({ file: source.change.path, method, path: oldPath, change: "removed", compatibility: "breaking" });
      }
    }
    for (const method of after) {
      if (!before.has(method) || oldPath !== path) {
        changes.push({ file: source.change.path, method, path, change: "added", compatibility: "compatible" });
      }
    }
  }
  return changes;
}
