# Deduplicate browser links

## Goal

Make `browsers_links` return each href once while preserving its order of first appearance.

## Success criteria

- Repeated hrefs collapse to one row in order of first appearance.
- Text shown to the model and `details.links` contain the same sequence.
- The CLI prints the sequence produced by the shared link executor.
- An offline regression covers repeated hrefs.
- Focused tests, typecheck, lint, full tests, and build pass.
- Foreign `probe_*.mjs` files remain untouched.

## Progress

- [x] Read issue #25, every open issue, open and recent merged PRs, repository instructions, and link call sites.
- [x] Confirm issue #25 is unassigned and no open or closed PR duplicates it.
- [x] Reproduce the implementation path from provider rows through `browserLinks()` and the CLI.
- [x] Select `oritwoen`, set the local noreply commit identity, and branch from `origin/main`.
- [x] Add a failing regression for repeated hrefs.
- [x] Deduplicate at the shared link executor and route the CLI through it.
- [x] Run focused and whole repository verification.
- [x] Perform an adversarial review and prepare the exact staged patch for Ori.
- [x] Create and push the reviewed local commit.
- [x] Open pull request #26 as `oritwoen` with the required assignee.

## Current step

Pull request #26 is open from `fix/deduplicate-browser-links` and closes issue #25 when merged.

## Next action

Monitor review and checks; no local implementation action is pending.
