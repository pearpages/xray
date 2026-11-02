# 0017. The Action leaves merged and closed PRs' comments alone

- **Date:** 2026-11-02
- **Status:** Accepted — under the owner's delegation ("do whatever you think is best, but document
  it").

## Context

On 2026-11-01 xray was re-run on bitepals' PR #134 (pearpages/fourpass) after it had been merged.
A re-run job replays the original `pull_request` event, in which the PR was still open, but checks
out today's base branch: it already contained the PR, so the diff was empty and the comment was
replaced by an empty report. The same happens to any re-run, or late run, after a merge.

## Decision

Before writing the comment, the Action asks GitHub for the PR's **current** state
(`GET /repos/{repo}/pulls/{number}`). When it is merged or closed, the comment is left as it is and
the run logs why; the new report still goes to the job summary. If the state can't be read, the
Action comments as before.

Alternatives: reading `pull_request.state` from the event (useless: a re-run replays the open
state); skipping the whole analysis (it is cheap, and the job summary keeps it for whoever re-ran
it); writing an "outdated" note into the comment (it would still lose the real report).

## Consequences

+ The report a PR was reviewed with survives merges and re-runs.
− One more API call per run (read-only; `pull-requests: write` already covers it).
− A PR reopened later gets a fresh report on its next push, as before.
