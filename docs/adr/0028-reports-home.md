# 0028. One reports home for every repository: `~/.xray/reports`

- **Date:** 2026-11-26
- **Status:** Accepted — by the owner, 2026-11-26. Supersedes the location in 0027.

## Context

ADR-0027 put the quality history in the plugin's data folder
(`~/.claude/plugins/data/xray-xray/snapshots/<owner>-<repo>/`), passed by the skill. Only
`/xray:quality-report` wrote there. Reports made by hand with `-o` went wherever the person
typed: on the owner's machine they had piled up in four places (that folder,
`~/Documents/quality-reports/`, the git-ignored `packages/quality-ui/tmp-reports/`, and the
UI's localStorage), with three files saved twice. A saved PR report sat among them. The UI
could only show a report someone dragged into it.

The options were:

- **Keep the plugin data folder** and make the CLI and UI default to it: hidden, tied to Claude
  Code, and removing the plugin removes the history.
- **`.xray/reports/` in each analysed repository**: easy to find, but lost with the clone and
  split across clones, the problem ADR-0027 avoided.
- **One folder in the user's home, `~/.xray/reports/`**, for every tool.

## Decision

- **The reports home** is `$XRAY_HOME/reports`, else `~/.xray/reports`. Inside it, one folder per
  repository named `<owner>-<repo>` from its `origin` remote, else its top folder's name
  (`repoKey` in `packages/quality/src/home.ts`, the rule the skill already used):
  - `quality/<generatedAt>-<sha>.json`: the quality history, named and pruned as in ADR-0027;
  - `pr/<name>.md`: saved PR reports, by hand for now.
- **`xray-quality --snapshots` with no folder** uses `<home>/<key>/quality`; with a folder it
  behaves as before. The skill passes `${XRAY_HOME:-$HOME/.xray}/reports/<name>/quality`
  explicitly, so builds older than the default keep working.
- **The quality UI lists the home itself**: `vite` and `vite preview` serve
  `/reports/index.json` and the `quality/*.json` files, read only. Those reports are read on each
  visit and never copied into localStorage, which keeps only reports opened by hand. A static
  copy of the UI has no server and just opens files, as before.
- Reports made with uncommitted changes, which `--snapshots` doesn't save, may be kept by hand as
  `<generatedAt>-<sha>-dirty.json`. The snapshot name pattern doesn't match them, so they are
  never a comparison's baseline and never pruned, but the UI shows them.
- The reports that existed were moved in once (17 reports and 1 PR report, duplicates dropped),
  and the old folders removed.

## Consequences

- (+) Every report on a machine is in one folder that is easy to find, outside every
  repository, whichever tool wrote it, and the UI shows it without picking files.
- (+) The history survives removing or reinstalling the plugin.
- (−) Still one person's history per machine; a shared one needs another decision (as in 0027).
- (−) The UI's dev server now reads files outside the project: any page the browser opens could
  ask `localhost` for them, within Vite's host and CORS checks ([security.md](../../security.md)).
- (−) Moving `XRAY_HOME` moves the history: runs before and after the move don't see each other.
