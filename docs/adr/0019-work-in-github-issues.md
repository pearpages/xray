# 0019. Work is tracked in GitHub Issues

- **Date:** 2026-11-04
- **Status:** Accepted
- **Supersedes:** the `tasks.md` part of [0001](0001-project-knowledge-files.md)

## Context

Open work lived in `tasks.md`, one file per repo. There was no view across repos, and nothing
linked a to-do to the commit or PR that finished it. On 2026-11-04 every open item became a GitHub
issue on the owner's Backlog project board.

## Decision

- Open work is a GitHub issue, labelled `type:*`, `priority:*` and `area:*`.
- Finished work closes its issue from the commit or PR (`Fixes #N`).
- `tasks.md` is deleted. Its history stays in git.

## Consequences

+ One board across repos, and every to-do links to the change that closed it.
− Tracking work depends on GitHub: reading it needs `gh` or the web, not a file.
