# 0010. Versioned releases: `vX.Y.Z` tags and a moving `v0`

- **Date:** 2026-11-01
- **Status:** Accepted — decided by Claude under the owner's delegation ("do whatever you think is
  fit, document the outcome").

## Context

Every workflow used `pearpages/xray@main`, and the plugin's skills built xray from `main`: each push
to `main` changed every project's PR report at once, including half-finished work. Feature branches
plus a dummy PR (principle P6) caught problems before merging, but nothing let a project choose when
to take a new version.

## Decision

- **Releases are git tags.** `vX.Y.Z` (semver) marks a release and never moves. A moving major tag
  (`v0` while the report format may still change, `v1` after) points at the latest release of
  that major.
- **Consumers use the major tag:** `uses: pearpages/xray@v0`. The README shows that; `@main` is for
  trying unreleased work, and `@vX.Y.Z` for pinning.
- **The plugin's skills follow `v0`** too (`XRAY_REF`, default `v0`), so `/xray:features` and
  `/xray:explain` run the released CLI, matching what PR comments show.
- **Releasing** (after merging to `main`, CI green):

  ```bash
  git tag -a vX.Y.Z -m "vX.Y.Z" && git tag -f v0 vX.Y.Z
  git push origin vX.Y.Z && git push -f origin v0
  ```

  A minor version for new analyses or sections, a patch for fixes, a major (and a new moving tag)
  for a change in the report or config that breaks consumers.
- First release: **v0.1.0**, everything up to analyses 4 and 5.

## Consequences

+ Pushing to `main` no longer changes anyone's reports; a release does.
+ Projects can pin (`@v0.1.0`) or follow (`@v0`).
− Releasing is a manual step (two tags); forgetting it means `@v0` lags behind `main`.
− Moving `v0` is a force-push of a tag; it's the GitHub Actions convention, but it rewrites what
  `@v0` means for everyone at once.
