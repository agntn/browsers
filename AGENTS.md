# AGENTS.md - browsers

## What

Unified browser-as-a-service provider library for AI agents. One registry, eight providers.

## Structure

- `src/core/types.ts` — interfaces: BrowserSession, ScrapeResult, ScreenshotResult, EvaluateResult, BrowserProvider
- `src/core/registry.ts` - provider table seeded from the manifest (register/create/providers/has); `create()` is async and imports one provider module
- `src/core/client.ts` - HTTP client on native `fetch` with retry, error mapping, URL sanitization
- `src/core/lazy.ts` - one-shot async memo used by the registry and the MCP server
- `src/core/block-page.ts` - recognizes block and captcha pages; every provider's `scrape` returns through `rejectBlockPage`
- `src/core/errors.ts` - typed error hierarchy (BrowserError, HTTPError, AuthError, SessionError, etc.)
- `src/tool-operations.ts` - executors shared by MCP, Pi, and OMP
- `src/mcp.ts` - MCP stdio server surface; schemas load on the first `tools/list`, the validator on the first `tools/call`
- `src/providers/index.ts` - the manifest: key, default URL and a literal `import()` per provider
- `src/providers/*.ts` - one file per provider, exports `factory`; nothing runs at import
- `src/commands/*.ts` - CLI subcommands (citty)
- `packages/pi/extensions/browsers.ts` - Pi agent tools
- `packages/omp/extensions/browsers.ts` - OMP agent tools
- `packages/shared/tui.ts` - terminal rendering shared by Pi and OMP
- `docs/` - the browsers.agntn.dev site, its own pnpm project, outside the root lint; `docs/AGENTS.md` has its rules
- `build.config.ts` - obuild config: one bundle with an input per provider file, and the hook that inlines typebox
- `vite.config.ts` - Vite+ config for `vp test`, `vp lint` and `vp fmt`; lint and fmt spread the shared `@agntn/ox` policy

## Adding a provider

1. Create `src/providers/yourprovider.ts`
2. Implement `BrowserProvider` interface; `scrape` returns its result through `rejectBlockPage`
3. Export `factory: BrowserProviderFactory`; do not import the registry
4. Add a manifest entry (key, default URL, `load: () => import("./yourprovider.ts").then((m) => m.factory)`) to `src/providers/index.ts`
5. Add the key to `browserProviderNames` in `src/tool-contract.ts`
6. Add any nonstandard environment key to `src/core/resolve.ts`
7. Add its page as `docs/content/2.providers/<position>.<name>.md` with `::provider-facts{name="<name>"}`, its name, glyph and blurb to `PRESENTATION` in `docs/app/utils/providers.ts`, and a recorded scrape to `docs/app/data/scrape-sample.json`

`test/registry.test.ts` fails when the manifest, the provider files and `browserProviderNames` disagree; `test/docs.test.ts` fails when a provider has no page or no recording; `test/cli-help.test.ts` fails when the `-p` help of `links`, `crawl`, `pdf`, `extract`, `search` or `accessibility` doesn't name the providers that implement the command, in registry order; `test/loads.test.ts` fails when an entry or a CLI usage path starts loading a provider, TypeBox or the MCP SDK.

## Conventions

- TypeScript, ESM, Node >= 26
- obuild builds, Vite+ runs the rest: `vp test` runs Vitest, `vp lint` and `vp fmt` run oxlint and oxfmt; type-aware lint runs after `pnpm build`
- native `fetch` for HTTP, citty for CLI, consola for logging
- API keys from env: `PROVIDERNAME_API_KEY`
- Nothing runs at import: providers load on the first `create()` and the MCP server imports TypeBox on the first `tools/list`; `sideEffects: false` in `package.json` states that and has to stay true
- `typebox` stays out of `dependencies`, since Pi 0.99 warns on every load of a package that lists it there: it's an optional `"*"` peer with the exact pin in `devDependencies`. Pi and OMP hand the extensions their own copy, and the `rolldownConfig` hook in `build.config.ts` inlines one into `dist` for the CLI and the MCP server, with its license in `dist/THIRD-PARTY-LICENSES.md`. `test/host-peers.test.ts` guards all three
- `src/` runs under plain Node type stripping: relative imports end in `.ts` and no `enum`, `namespace` or parameter properties (`erasableSyntaxOnly` enforces the syntax, `test/cli-source.test.ts` the imports)
- Inside a checkout, `dist/cli.mjs mcp` loads the server from `src/`, like the Pi and OMP extensions, so a local MCP server needs a restart after a change, not `pnpm build`. The npm package, a copy under `node_modules` and a Node without type stripping keep the bundle; `BROWSERS_DIST=1` forces it, as `test/eval-mcp.mjs` does. Changes to `src/cli.ts` itself still need `pnpm build`
- Conventional commits, no body
