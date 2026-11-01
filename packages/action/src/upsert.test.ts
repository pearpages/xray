import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORT_MARKER } from "@xray/core";
import { GitHubApiError, upsertComment, type GitHubContext } from "./comment.js";

const context: GitHubContext = {
  apiUrl: "https://api.test",
  token: "t",
  repository: "o/r",
  issueNumber: 7,
};

interface Call {
  method: string;
  url: string;
  body?: { body: string };
}

/** Fake GitHub: serves `pages` of comments and records every request. */
function fakeGitHub(pages: { id: number; body: string }[][], status = 200) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call: Call = { method: init.method ?? "GET", url };
    if (init.body) call.body = JSON.parse(String(init.body));
    calls.push(call);
    if (status !== 200) return new Response("nope", { status });
    if (call.method === "GET") {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json(pages[page - 1] ?? []);
    }
    return Response.json({ id: call.method === "POST" ? 99 : 0 });
  });
  return calls;
}

const filler = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => ({ id: from + index, body: "lgtm" }));

afterEach(() => vi.unstubAllGlobals());

describe("upsertComment", () => {
  it("creates a comment when the PR has no xray comment", async () => {
    const calls = fakeGitHub([filler(2)]);
    expect(await upsertComment(context, "report")).toEqual({ id: 99, created: true });
    expect(calls.at(-1)).toEqual({
      method: "POST",
      url: "https://api.test/repos/o/r/issues/7/comments",
      body: { body: "report" },
    });
  });

  it("updates the comment carrying the marker, even past the first page", async () => {
    const calls = fakeGitHub([filler(100), [{ id: 500, body: `${REPORT_MARKER}\nold` }]]);
    expect(await upsertComment(context, "new")).toEqual({ id: 500, created: false });
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "PATCH"]);
    expect(calls.at(-1)?.url).toBe("https://api.test/repos/o/r/issues/comments/500");
  });

  it("throws a GitHubApiError carrying the status", async () => {
    fakeGitHub([], 403);
    await expect(upsertComment(context, "report")).rejects.toMatchObject({ status: 403 });
    await expect(upsertComment(context, "report")).rejects.toBeInstanceOf(GitHubApiError);
  });
});
