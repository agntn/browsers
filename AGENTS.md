# AGENTS.md - browsers

## What

Unified browser-as-a-service provider library for AI agents. One registry, eight providers.

## Structure

- `src/core/types.ts` — interfaces: BrowserSession, ScrapeResult, ScreenshotResult, EvaluateResult, BrowserProvider
- `src/core/registry.ts` - provider table seeded from the manifest (register/create/providers/has); `create()` is async and imports one provider module
- `src/core/client.ts` - HTTP client on native `fetch` with retry, error mapping, URL sanitization
- `src/core/lazy.ts` - one-shot async memo used by the registry
- `src/core/block-page.ts` - recognizes block and captcha pages; every provider's `scrape` returns through `rejectBlockPage`
- `src/core/errors.ts` - typed error hierarchy (BrowserError, HTTPError, AuthError, SessionError, etc.)
- `src/tools.ts` - one `defineTool` per tool from `@agntn/tools`, the list MCP, Pi, OMP, the AI SDK and the CLI all serve
- `src/ai.ts` - `browsersAiTools`, the AI SDK tool map `toAiTools` derives from that list, behind the `./ai` export
- `src/tool-operations.ts` - executors behind those tools, imported on the first call
- `src/mcp.ts` - `createMcpServer()` over the `@agntn/tools/mcp` adapter; `src/mcp-stdio.ts` serves it on stdio
- `src/providers/index.ts` - the manifest: key, default URL and a literal `import()` per provider
- `src/providers/*.ts` - one file per provider, exports `factory`; nothing runs at import
- `src/cli.ts` - `runCli` from `@agntn/tools/cli`, one command per tool; `src/cli-commands.ts` holds what only the CLI has (`sessions`, the old `session create|list|release` words, which errors print as one line)
- `extensions/pi/browsers.ts` - Pi agent tools
- `extensions/omp/browsers.ts` - OMP agent tools
- `extensions/shared/tui.ts` - terminal rendering shared by Pi and OMP
- `docs/` - the browsers.agntn.dev site, a member of the root pnpm workspace, outside the root lint; `docs/AGENTS.md` has its rules
- `build.config.ts` - obuild config: one bundle with an input per provider file
- `vite.config.ts` - Vite+ config for `vp test`, `vp lint` and `vp fmt`; lint and fmt spread the shared `@agntn/ox` policy

## Adding a provider

1. Create `src/providers/yourprovider.ts`
2. Implement `BrowserProvider` interface; `scrape` returns its result through `rejectBlockPage`
3. Export `factory: BrowserProviderFactory`; do not import the registry
4. Add a manifest entry (key, default URL, `load: () => import("./yourprovider.ts").then((m) => m.factory)`) to `src/providers/index.ts`
5. Add the key to `browserProviderNames` in `src/tool-contract.ts`
6. Add any nonstandard environment key to `src/core/resolve.ts`
7. Add its page as `docs/content/2.providers/<position>.<name>.md` with `::provider-facts{name="<name>"}`, its name, glyph and blurb to `PRESENTATION` in `docs/app/utils/providers.ts`, and a recorded scrape to `docs/app/data/scrape-sample.json`

`test/registry.test.ts` fails when the manifest, the provider files and `browserProviderNames` disagree; `test/docs.test.ts` fails when a provider has no page or no recording; `test/cli-help.test.ts` fails when the `provider` description of `links`, `crawl`, `pdf`, `extract` or `accessibility`, which is also their `-p` help, doesn't name the providers that implement the tool; `test/loads.test.ts` fails when an entry or a CLI usage path starts loading a provider, TypeBox or the MCP SDK.

## Conventions

- TypeScript, ESM, Node >= 26
- obuild builds, Vite+ runs the rest: `vp test` runs Vitest, `vp lint` and `vp fmt` run oxlint and oxfmt; type-aware lint runs after `pnpm build`
- native `fetch` for HTTP; the CLI, MCP, Pi, OMP and the AI SDK tools come from `@agntn/tools`
- API keys from env: `PROVIDERNAME_API_KEY`
- Nothing runs at import: providers load on the first `create()` and the executors on the first tool call; `sideEffects: false` in `package.json` states that and has to stay true
- Schemas use `Type` from `@agntn/tools`, never a bare `typebox` import: OMP swaps that for its own facade and validation then lets anything through. `typebox` stays out of the manifest, since `@agntn/tools` carries its own and Pi 0.99 warns about a package that lists it. `test/host-peers.test.ts` guards both
- `src/` runs under plain Node type stripping: relative imports end in `.ts` and no `enum`, `namespace` or parameter properties (`erasableSyntaxOnly` enforces the syntax, `test/cli-source.test.ts` the imports)
- Inside a checkout, `dist/cli.mjs mcp` loads the server from `src/`, like the Pi and OMP extensions, so a local MCP server needs a restart after a change, not `pnpm build`. The npm package, a copy under `node_modules` and a Node without type stripping keep the bundle; `BROWSERS_DIST=1` forces it, as `test/eval-mcp.mjs` does. Changes to `src/cli.ts` itself still need `pnpm build`
- Conventional commits, no body
