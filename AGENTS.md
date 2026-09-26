# AGENTS.md - browsers

## What

Unified browser-as-a-service provider library for AI agents. One registry, eight providers.

## Structure

- `src/core/types.ts` — interfaces: BrowserSession, ScrapeResult, ScreenshotResult, EvaluateResult, BrowserProvider
- `src/core/registry.ts` - provider table seeded from the manifest (register/create/providers/has); `create()` is async and imports one provider module
- `src/core/client.ts` - HTTP client with retry, error mapping, URL sanitization; ofetch loads on the first request
- `src/core/lazy.ts` - one-shot async memo used by the client and the MCP server
- `src/core/errors.ts` - typed error hierarchy (BrowserError, HTTPError, AuthError, SessionError, etc.)
- `src/tool-operations.ts` - executors shared by MCP, Pi, and OMP
- `src/mcp.ts` - MCP stdio server surface; schemas load on the first `tools/list`, the validator on the first `tools/call`
- `src/providers/index.ts` - the manifest: key, default URL and a literal `import()` per provider
- `src/providers/*.ts` - one file per provider, exports `factory`; nothing runs at import
- `src/commands/*.ts` - CLI subcommands (citty)
- `packages/pi/extensions/browsers.ts` - Pi agent tools
- `packages/omp/extensions/browsers.ts` - OMP agent tools
- `packages/shared/tui.ts` - terminal rendering shared by Pi and OMP
- `oxlint.config.ts` / `oxfmt.config.ts` - repository-local consumers of the shared `@agntn/ox` policy

## Adding a provider

1. Create `src/providers/yourprovider.ts`
2. Implement `BrowserProvider` interface
3. Export `factory: BrowserProviderFactory`; do not import the registry
4. Add a manifest entry (key, default URL, `load: () => import("./yourprovider.ts").then((m) => m.factory)`) to `src/providers/index.ts`
5. Add the key to `browserProviderNames` in `src/tool-contract.ts`
6. Add any nonstandard environment key to `src/core/resolve.ts`

`test/registry.test.ts` fails when the manifest, the provider files and `browserProviderNames` disagree; `test/loads.test.ts` fails when an entry or a CLI usage path starts loading a provider, ofetch, TypeBox or the MCP SDK.

## Conventions

- TypeScript, ESM, Node >= 22
- Linting and formatting use oxlint + oxfmt through `@agntn/ox`; type-aware lint runs after `pnpm build`
- ofetch for HTTP, citty for CLI, consola for logging
- API keys from env: `PROVIDERNAME_API_KEY`
- Nothing runs at import: providers load on the first `create()`, ofetch on the first request, and the MCP server imports TypeBox on the first `tools/list`; `sideEffects: false` in `package.json` states that and has to stay true
- `src/` runs under plain Node type stripping: relative imports end in `.ts` and no `enum`, `namespace` or parameter properties (`erasableSyntaxOnly` enforces the syntax, `test/cli-source.test.ts` the imports)
- Inside a checkout, `dist/cli.mjs mcp` loads the server from `src/`, like the Pi and OMP extensions, so a local MCP server needs a restart after a change, not `pnpm build`. The npm package, a copy under `node_modules` and a Node without type stripping keep the bundle; `BROWSERS_DIST=1` forces it, as `test/eval-mcp.mjs` does. Changes to `src/cli.ts` itself still need `pnpm build`
- Conventional commits, no body
