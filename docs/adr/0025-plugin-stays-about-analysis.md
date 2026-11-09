# 0025. xray's plugin stays about analysis; workflow skills live in craft

- **Date:** 2026-11-08
- **Status:** Accepted — chosen by the owner on 2026-11-09
- **Extends:** [0024](0024-language-agnostic-skills-in-the-plugin.md)

## Context

ADR-0024 widened the plugin from TypeScript/React PR reports to any language. The owner then
wanted one home for all their software skills, including workflow ones (`scaffold`, `issue`,
`commit-message`, `maturity`, `diagram`, and a new ADR skill), which raised whether xray's plugin
should hold them.

Every skill in xray's plugin understands code from evidence: `features` names features for the
report, `explain-pr` explains the report, `onboard` measures and explains the hard parts,
`check-diagrams` checks diagrams against the files and imports. The workflow skills record
choices, track work and ship changes, and use none of xray's data.

The alternatives were:

1. Put the workflow skills in xray's plugin. One plugin, but `/xray:adr` reads as analysis, and
   xray's users would get the owner's way of working with their PR reports.
2. A second plugin inside this repository. One repository, but it stops being only xray.
3. A repository of their own, [pearpages/craft](https://github.com/pearpages/craft), with the
   `craft` plugin. This is the decision; craft's ADR-0002 records it from craft's side.

## Decision

- **xray's plugin holds analysis skills only**: a skill joins it when it reads code or xray's
  measurements and explains them.
- **Workflow skills live in craft**, as `/craft:<skill>`. Neither plugin needs the other
  installed; a craft skill may read files an xray skill wrote (`docs/onboarding/`,
  `xray.features.json`).
- ADR-0023's "skills stay outside xray" still holds for skills that aren't analysis.

## Consequences

- (+) `/xray:` keeps meaning xray's analysis; the plugin stays what its README says.
- (+) A clear test for where a new skill goes.
- (−) The owner installs and updates two plugins.
