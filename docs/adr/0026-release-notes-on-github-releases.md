# 0026. Release notes live on GitHub Releases

- **Date:** 2026-11-10
- **Status:** Accepted — chosen by the owner on 2026-11-10

## Context

[ADR-0010](0010-versioning-and-releases.md) made releases git tags (`vX.Y.Z` plus a moving `v0`),
but nothing says what each release contains: nine releases, no notes. Someone on `@v0` can't
see what changed when `v0` moves, and the knowledge standard's maturity check asks for release
notes.

The alternatives were:

1. GitHub Releases, one per `vX.Y.Z` tag. This is the decision: no file to keep in sync, each
   entry links its PRs, and it sits next to the tags people pin.
2. A `CHANGELOG.md` in the repository. Readable offline, but one more file every release must
   edit and commit, and easy to forget.
3. Nothing: the commit log is the changelog. It mixes tests, docs and CI with what users get.

## Decision

- Each `vX.Y.Z` gets a GitHub Release with notes written for users: one sentence on what the
  release means, then only the sections that apply (Breaking changes, Features, Fixes,
  Dependencies), each entry linking its PR, and internal changes in one closing line.
- `/craft:release` writes the notes and publishes them (`gh release create`) after the tags from
  ADR-0010 are pushed. Releases before v0.9.1 keep no notes.

## Consequences

- (+) `@v0` users can see what each release changed.
- (+) No changelog file to keep in step.
- (−) The notes live on GitHub, not in the repository.
