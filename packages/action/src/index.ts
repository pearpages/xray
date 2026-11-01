import { readFileSync } from "node:fs";
import { GitHubApiError, upsertComment } from "./comment.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Usage: node dist/index.js <report.md> — run inside a pull_request workflow. */
async function main(): Promise<void> {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Usage: xray-comment <report.md>");

  const event = JSON.parse(readFileSync(required("GITHUB_EVENT_PATH"), "utf8")) as {
    pull_request?: { number: number };
  };
  const issueNumber = event.pull_request?.number;
  if (!issueNumber) {
    console.log("xray: not a pull_request event, skipping the comment.");
    return;
  }

  let result: { id: number; created: boolean };
  try {
    result = await upsertComment(
      {
        apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
        token: required("GITHUB_TOKEN"),
        repository: required("GITHUB_REPOSITORY"),
        issueNumber,
      },
      readFileSync(reportPath, "utf8"),
    );
  } catch (error) {
    // Fork PRs get a read-only token. The report is still in the job summary,
    // so a missing permission is a warning, not a failed check.
    if (error instanceof GitHubApiError && (error.status === 403 || error.status === 404)) {
      console.log(
        `::warning::xray could not comment on #${issueNumber} (${error.status}); ` +
          "the report is in the job summary. The workflow needs pull-requests: write.",
      );
      return;
    }
    throw error;
  }
  console.log(`xray: ${result.created ? "created" : "updated"} comment ${result.id} on #${issueNumber}.`);
}

main().catch((error: unknown) => {
  console.error(`::error::xray: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
