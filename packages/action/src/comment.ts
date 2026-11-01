import { REPORT_MARKER } from "@xray/core";

/** GitHub rejects comment bodies over 65 536 characters. */
export const MAX_COMMENT_LENGTH = 65_536;

export function fitComment(body: string): string {
  if (body.length <= MAX_COMMENT_LENGTH) return body;
  const notice =
    "\n\n> [!WARNING]\n> Informe truncado: supera el límite de tamaño de los comentarios de GitHub.\n";
  // Cut on a line boundary and close any open code fence so the rest still renders.
  let cut = body.slice(0, MAX_COMMENT_LENGTH - notice.length - 8);
  cut = cut.slice(0, cut.lastIndexOf("\n"));
  const fences = cut.match(/^```/gm)?.length ?? 0;
  return `${cut}${fences % 2 === 1 ? "\n```" : ""}${notice}`;
}

export interface GitHubContext {
  apiUrl: string;
  token: string;
  repository: string;
  issueNumber: number;
}

interface IssueComment {
  id: number;
  body?: string;
}

async function request<T>(context: GitHubContext, method: string, path: string, body?: unknown) {
  const response = await fetch(`${context.apiUrl}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${context.token}`,
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function findReportComment(context: GitHubContext): Promise<IssueComment | undefined> {
  const base = `/repos/${context.repository}/issues/${context.issueNumber}/comments`;
  for (let page = 1; ; page++) {
    const comments = await request<IssueComment[]>(context, "GET", `${base}?per_page=100&page=${page}`);
    const found = comments.find((comment) => comment.body?.includes(REPORT_MARKER));
    if (found || comments.length < 100) return found;
  }
}

/** Updates the PR's xray comment in place, or creates it on the first run. */
export async function upsertComment(
  context: GitHubContext,
  body: string,
): Promise<{ id: number; created: boolean }> {
  const fitted = fitComment(body);
  const existing = await findReportComment(context);
  if (existing) {
    await request(context, "PATCH", `/repos/${context.repository}/issues/comments/${existing.id}`, {
      body: fitted,
    });
    return { id: existing.id, created: false };
  }
  const created = await request<IssueComment>(
    context,
    "POST",
    `/repos/${context.repository}/issues/${context.issueNumber}/comments`,
    { body: fitted },
  );
  return { id: created.id, created: true };
}
