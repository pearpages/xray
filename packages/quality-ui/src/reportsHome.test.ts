import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listReports, reportsMiddleware } from "../reports-home";
import { loadHomeReports } from "./homeReports";
import { report } from "./testing/fixtures";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "xray-reports-home-"));
  mkdirSync(join(home, "acme-shop", "quality"), { recursive: true });
  mkdirSync(join(home, "acme-shop", "pr"), { recursive: true });
  mkdirSync(join(home, "acme-blog", "quality"), { recursive: true });
  writeFileSync(join(home, "acme-shop", "quality", "20261102T000000000Z-bbbbbbbbbbbb.json"), JSON.stringify(report({ commit: "b" })));
  writeFileSync(join(home, "acme-shop", "quality", "20261101T000000000Z-aaaaaaaaaaaa.json"), JSON.stringify(report({ commit: "a" })));
  writeFileSync(join(home, "acme-shop", "quality", "notes.txt"), "not a report");
  writeFileSync(join(home, "acme-shop", "pr", "134.md"), "# PR");
  writeFileSync(join(home, "acme-blog", "quality", "20261101T000000000Z-cccccccccccc.json"), "{ damaged");
  writeFileSync(join(home, "secret.json"), "{}");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Runs the middleware for one request, as the dev server would under `/reports`. */
function get(url: string): Promise<{ status: number; body: string; type: string; next: boolean }> {
  return new Promise((done) => {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader: (name: string, value: string) => void (headers[name.toLowerCase()] = value),
      end(body: string) {
        done({ status: this.statusCode, body, type: headers["content-type"] ?? "", next: false });
      },
    };
    reportsMiddleware(home)({ method: "GET", url } as IncomingMessage, res as unknown as ServerResponse, () =>
      done({ status: 0, body: "", type: "", next: true }),
    );
  });
}

describe("the reports home server", () => {
  it("lists every repository's quality reports, oldest first, and nothing else", () => {
    expect(listReports(home)).toEqual([
      "acme-blog/quality/20261101T000000000Z-cccccccccccc.json",
      "acme-shop/quality/20261101T000000000Z-aaaaaaaaaaaa.json",
      "acme-shop/quality/20261102T000000000Z-bbbbbbbbbbbb.json",
    ]);
    expect(listReports(join(home, "missing"))).toEqual([]);
  });

  it("serves the index and a listed report", async () => {
    const index = await get("/index.json");
    expect(index.type).toContain("application/json");
    expect((JSON.parse(index.body) as { reports: string[] }).reports).toHaveLength(3);
    const one = await get("/acme-shop/quality/20261102T000000000Z-bbbbbbbbbbbb.json");
    expect(one.status).toBe(200);
    expect((JSON.parse(one.body) as { repo: { commit: string } }).repo.commit[0]).toBe("b");
  });

  it.each(["/../secret.json", "/%2E%2E/quality/x.json", "/acme-shop/pr/134.md", "/acme-shop/quality/notes.txt", "/secret.json", "/acme-shop/quality/none.json"])(
    "serves nothing outside a repository's quality folder: %s",
    async (url) => expect((await get(url)).status).toBe(404),
  );

  it("leaves other methods to the next handler", async () => {
    const result = await new Promise<boolean>((done) =>
      reportsMiddleware(home)({ method: "POST", url: "/index.json" } as IncomingMessage, {} as ServerResponse, () => done(true)),
    );
    expect(result).toBe(true);
  });
});

describe("loadHomeReports", () => {
  /** A fetch backed by the middleware, as the browser sees the dev server. */
  const devServer: typeof fetch = async (input) => {
    const { status, body, type } = await get(`/${String(input).replace(/^reports\//, "")}`);
    return new Response(body, { status, headers: { "Content-Type": type } });
  };

  it("reads every report the server lists and skips a damaged one", async () => {
    const loaded = await loadHomeReports(devServer);
    expect(loaded.map((item) => item.repo.commit[0])).toEqual(["a", "b"]);
  });

  it("gives nothing on a static copy, where the index is the app's HTML or missing", async () => {
    expect(await loadHomeReports(async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }))).toEqual([]);
    expect(await loadHomeReports(async () => new Response("", { status: 404 }))).toEqual([]);
    expect(await loadHomeReports(async () => Promise.reject(new TypeError("offline")))).toEqual([]);
  });
});
