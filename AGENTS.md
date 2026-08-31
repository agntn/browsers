# AGENTS.md - browsers

## What

Unified browser-as-a-service provider library for AI agents. One registry, eight providers.

## Structure

- `src/core/types.ts` — interfaces: BrowserSession, ScrapeResult, ScreenshotResult, EvaluateResult, BrowserProvider
- `src/core/registry.ts` — self-registering provider pattern (register/create/providers/has)
- `src/core/client.ts` - HTTP client with retry, error mapping, URL sanitization
- `src/core/errors.ts` - typed error hierarchy (BrowserError, HTTPError, AuthError, SessionError, etc.)
- `src/tool-operations.ts` - executors shared by MCP, Pi, and OMP
- `src/mcp.ts` - MCP stdio server surface
- `src/providers/*.ts` - one file per provider, self-registers on import
- `src/commands/*.ts` - CLI subcommands (citty)
- `packages/pi/extensions/browsers.ts` - Pi agent tools
- `packages/omp/extensions/browsers.ts` - OMP agent tools
- `oxlint.config.ts` / `oxfmt.config.ts` - repository-local consumers of the shared `@agntn/ox` policy

## Adding a provider

1. Create `src/providers/yourprovider.ts`
2. Implement `BrowserProvider` interface
3. Call `register('yourprovider', 'https://...', factory)` at module level
4. Add import to `src/providers/index.ts`
5. Add the key to `browserProviderNames` in `src/tool-contract.ts`
6. Add any nonstandard environment key to `src/core/resolve.ts`

## Conventions

- TypeScript, ESM, Node >= 22
- Linting and formatting use oxlint + oxfmt through `@agntn/ox`; type-aware lint runs after `pnpm build`
- ofetch for HTTP, citty for CLI, consola for logging
- API keys from env: `PROVIDERNAME_API_KEY`
- Self-registering providers (no central wiring)
- Conventional commits, no body
