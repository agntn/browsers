# @oritwoen/browsers

Unified browser-as-a-service provider for AI agents and CLI.

One API, eight providers: **Steel**, **Browserbase**, **Kernel**, **Browserless**, **Hyperbrowser**, **Anchor**, **Cloudflare**, **Playwright**.

## Install

```bash
pnpm add @oritwoen/browsers
# or globally
pnpm add -g @oritwoen/browsers
```

## API Keys

Set environment variables for the providers you want to use:

```bash
export STEEL_API_KEY=sk-...
export BROWSERBASE_API_KEY=bb-...
export KERNEL_API_KEY=k-...
export BROWSERLESS_API_KEY=bl-...
export HYPERBROWSER_API_KEY=hb-...
export ANCHOR_API_KEY=ab-...
export CF_API_TOKEN=...          # Cloudflare
export CF_ACCOUNT_ID=...         # Cloudflare (required)
# Playwright is local — no API key needed
```

## CLI

```bash
# Scrape a URL (defaults to first configured provider)
brobo scrape https://example.com

# Scrape with specific provider and format
brobo scrape https://example.com --provider steel --format html

# Wait for a CSS selector before extraction
brobo scrape https://example.com --waitFor '#content'

# Take a screenshot
brobo screenshot https://example.com -o page.png

# Generate PDF
brobo pdf https://example.com -o page.pdf

# Crawl a site
brobo crawl https://example.com --maxPages 20

# Extract links
brobo links https://example.com

# Web search (via Hyperbrowser)
brobo search "browser automation agents"

# AI-powered extraction
brobo extract https://example.com --prompt "Extract all product prices"

# Manage sessions
brobo session create --provider kernel --region us-east-1
brobo session list --provider browserbase
brobo session release <session-id> --provider steel

# Check configured providers and capabilities
brobo providers
brobo providers --check
```

## Library

```typescript
import { create, resolveProvider } from '@oritwoen/browsers'

// Auto-detect provider from env vars
const providerName = resolveProvider()
const provider = create(providerName)

// Check capabilities
const caps = provider.capabilities()
console.log(caps.statelessScrape, caps.cdp, caps.crawl)

// Stateless scrape (no session needed for Steel, Cloudflare, Browserless, etc.)
const result = await provider.scrape('https://example.com', {
  waitFor: '#content',
})
console.log(result.markdown ?? result.text ?? result.html)

// Session-based workflow
const session = await provider.createSession({
  stealth: true,
  region: 'eu-west-1',
})
await provider.navigate('https://example.com', session)
const screenshot = await provider.screenshot({ fullPage: true }, session)
const evalResult = await provider.evaluate('document.title', session)
await provider.releaseSession(session.id)

// Crawl (providers that support it)
if (provider.crawl) {
  const crawlResult = await provider.crawl('https://example.com', { maxPages: 10 })
}

// PDF generation
if (provider.pdf) {
  const pdf = await provider.pdf('https://example.com')
}

// Extract links
if (provider.links) {
  const links = await provider.links('https://example.com')
}

// AI-powered extraction
if (provider.extract) {
  const extracted = await provider.extract('https://example.com', {
    prompt: 'Extract product name, price, and description',
  })
}
```

## Providers

| Provider | Env Key | Scrape | Screenshot | Navigate | Evaluate | Crawl | PDF | Links | Extract | Search | CDP |
|----------|---------|--------|------------|----------|----------|-------|-----|-------|---------|--------|-----|
| **Steel** | `STEEL_API_KEY` | ✓ stateless | ✓ session | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Browserbase** | `BROWSERBASE_API_KEY` | ✓ stateless | ✓ session | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Kernel** | `KERNEL_API_KEY` | ✓ session | ✓ session | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Browserless** | `BROWSERLESS_API_KEY` | ✓ stateless | ✓ stateless | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| **Hyperbrowser** | `HYPERBROWSER_API_KEY` | ✓ stateless | ✓ session | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| **Anchor** | `ANCHOR_API_KEY` | ✗ | ✓ session | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Cloudflare** | `CF_API_TOKEN` + `CF_ACCOUNT_ID` | ✓ stateless | ✓ stateless | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **Playwright** | *(local)* | ✓ stateless | ✓ session | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

### Capabilities at runtime

```typescript
import { create } from '@oritwoen/browsers'

const provider = create('cloudflare')
const caps = provider.capabilities()
// {
//   scrape: true, screenshot: true, navigate: false, evaluate: false,
//   sessions: true, cdp: true, statelessScrape: true, statelessScreenshot: true,
//   crawl: true, pdf: true, links: true, search: false, extract: true,
// }
```

## Architecture

Follows the same pattern as [askweb](https://github.com/oritwoen/askweb), [apkx](https://github.com/oritwoen/apkx), and [omnichron](https://github.com/oritwoen/omnichron):

```
src/
  core/       — types, registry, client, errors, resolve
  providers/  — steel, browserbase, kernel, browserless, hyperbrowser, anchor, cloudflare, playwright
  commands/   — CLI subcommands (scrape, screenshot, session, providers, crawl, pdf, links, search, extract)
packages/
  pi/extensions/ — Pi agent extension (13 tools: brobo_scrape, brobo_session, etc.)
test/
  registry.test.ts, errors.test.ts, resolve.test.ts, capabilities.test.ts, playwright.test.ts
```

Providers self-register on import. Add a new provider by creating a file in `src/providers/` that calls `register()`.

## Adding a provider

1. Create `src/providers/yourprovider.ts`
2. Implement `BrowserProvider` interface (including `capabilities()`)
3. Call `register('yourprovider', 'https://...', factory)` at module level
4. Add import to `src/providers/index.ts`
5. Add to `builtinProviders` in `src/core/providers.ts`

## License

MIT
