# @agntn/ox migration

## Goal

Make `@agntn/ox` the single lint and formatting policy source for this repository while preserving runtime behavior.

## Success criteria

- `oxlint.config.ts` and `oxfmt.config.ts` compose the published shared configs by object spread.
- `@agntn/ox`, `oxlint`, `oxfmt`, and `oxlint-tsgolint` are direct development dependencies.
- Repository scripts build declarations before type-aware linting.
- Effective oxlint configuration retains the shared rule options.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, and `pnpm build` pass.
- Pre-existing untracked `probe_*.mjs` files remain untouched.

## Progress

- [x] Baseline build, typecheck, and 105 tests pass.
- [x] Confirmed the published `@agntn/ox@0.1.0` peer contract and canonical `_template` integration.
- [ ] Add shared config consumers, scripts, dependencies, and project documentation.
- [ ] Run the formatter as a mechanical migration.
- [ ] Fix lint findings without changing public behavior.
- [ ] Verify effective config and all project gates.
- [ ] Review final diff and preserve foreign WIP.

## Current step

Add the minimal integration surface, then run the new lint gate to measure the required code migration.
