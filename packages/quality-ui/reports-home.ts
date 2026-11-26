// Serves the reports home (ADR-0028) to the UI from `vite` and `vite preview`, so every saved
// quality report opens without picking files:
//
//   GET /reports/index.json                      → { home, reports: ["<key>/quality/<file>.json", …] }
//   GET /reports/<key>/quality/<file>.json       → that report
//
// Read only, JSON files of `<home>/<key>/quality/` only, on the dev server Vite binds to localhost.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";
import { reportsHome } from "../quality/src/home.ts";

const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;
const REPORT = /^\/([^/]+)\/quality\/([^/]+\.json)$/;

const folders = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => SEGMENT.test(name) && statSync(join(dir, name)).isDirectory()) : [];

/** Every saved quality report under `home`, as `<key>/quality/<file>.json`, oldest name first per repository. */
export function listReports(home: string): string[] {
  return folders(home).flatMap((key) => {
    const dir = join(home, key, "quality");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => SEGMENT.test(name) && name.endsWith(".json"))
      .sort()
      .map((name) => `${key}/quality/${name}`);
  });
}

/** The middleware, for a home folder; anything it doesn't serve goes to the next handler. */
export function reportsMiddleware(home: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const send = (status: number, body: string) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
    };
    if (url === "/index.json") return send(200, JSON.stringify({ home, reports: listReports(home) }));
    const match = REPORT.exec(url);
    if (!match || !SEGMENT.test(match[1]!) || !SEGMENT.test(match[2]!)) return send(404, '{"error":"not a report"}');
    const file = join(home, match[1]!, "quality", match[2]!);
    if (!existsSync(file)) return send(404, '{"error":"no such report"}');
    send(200, readFileSync(file, "utf8"));
  };
}

/** The Vite plugin: `$XRAY_HOME/reports`, else `~/.xray/reports`. */
export function reportsHomePlugin(home = reportsHome()): Plugin {
  return {
    name: "xray-reports-home",
    configureServer: (server) => void server.middlewares.use("/reports", reportsMiddleware(home)),
    configurePreviewServer: (server) => void server.middlewares.use("/reports", reportsMiddleware(home)),
  };
}
