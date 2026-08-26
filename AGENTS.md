# AGENTS.md - browsers

## What

Unified browser-as-a-service provider library for AI agents. One registry, eight providers.

## Structure

- `src/core/types.ts` — interfaces: BrowserSession, ScrapeResult, ScreenshotResult, EvaluateResult, BrowserProvider
- `src/core/registry.ts` — self-registering provider pattern (register/create/providers/has)
- `src/core/client.ts` — HTTP client with retry, error mapping, URL sanitization
- `src/core/errors.ts` - typed error hierarchy (BrowserError, HTTPError, AuthError, SessionError, etc.)
- `src/providers/*.ts` — one file per provider, self-registers on import
- `src/commands/*.ts` — CLI subcommands (citty)
- `packages/pi/extensions/browsers.ts` — Pi agent tools

## Adding a provider

1. Create `src/providers/yourprovider.ts`
2. Implement `BrowserProvider` interface
3. Call `register('yourprovider', 'https://...', factory)` at module level
4. Add import to `src/providers/index.ts`
5. Add to `builtinProviders` in `src/core/providers.ts`
6. Add env key pattern to pi extension

## Conventions

- TypeScript, ESM, Node >= 22
- ofetch for HTTP, citty for CLI, consola for logging
- API keys from env: `PROVIDERNAME_API_KEY`
- Self-registering providers (no central wiring)
- Conventional commits, no body
