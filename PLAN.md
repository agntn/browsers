# OMP and MCP integrations

## Goal

Expose the existing browser tools through OMP and MCP without duplicating provider behavior.

## Success criteria

- Pi, OMP, and MCP call one shared executor per operation.
- OMP registers the eleven existing browser tools through an exact package manifest entry.
- MCP lists and executes the same eleven tools over stdio.
- Session credentials stay out of public tool output.
- Package exports, tarball contents, CLI routing, and host-facing metadata include the new surfaces.
- Focused tests, typecheck, lint, full tests, build, packed import smoke, MCP stdio smoke, and installed OMP validation pass.
- Foreign `probe_*.mjs` files remain untouched.

## Progress

- [x] Read issue #21, open issues, open PRs, merged PRs, repository instructions, and sibling integrations.
- [x] Confirm no open PR overlaps issue #21 and the default branch has no recorded CI runs.
- [x] Select `aeitwoen`, set the local noreply commit identity, and branch from `origin/main`.
- [x] Add red contract tests for shared operations, OMP registration, and MCP registration/execution.
- [x] Extract shared operations and migrate Pi.
- [x] Add OMP and MCP surfaces plus package/build/CLI metadata.
- [x] Run focused and repository-wide verification, packed install smoke, and live host registration.
- [x] Perform adversarial self-review and an independent read-only review.

## Current step

The integrations are verified and ready for their local semantic commit.

## Next action

Commit the scoped files, push the branch after the approved dry-run, and open the contribution PR for issue #21.
