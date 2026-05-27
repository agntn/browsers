# brobo

Unified browser-as-a-service provider for AI agents and CLI.

One API, six providers: **Steel**, **Browserbase**, **Kernel**, **Browserless**, **Hyperbrowser**, **Anchor**.

## Install

```bash
pnpm add brobo
# or globally
pnpm add -g brobo
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
```

## CLI

```bash
# Scrape a URL (returns markdown by default)
brobo scrape https://example.com

# Scrape with specific provider
brobo scrape https://example.com --provider steel --format html

# Take a screenshot
brobo screenshot https://example.com -o page.png

# Create a session
brobo session create --provider kernel --region us-east-1

# Release a session
brobo session release <session-id> --provider steel

# List active sessions
brobo session list --provider browserbase

# Check which providers are configured
brobo providers
```

## Library

```typescript
import { create } from 'brobo'

// Auto-detect provider from env vars
const provider = create('steel')

// Create a session
const session = await provider.createSession({
  stealth: true,
  region: 'eu-west-1',
})

// Navigate and scrape
const result = await provider.scrape('https://example.com', {
  formats: ['markdown', 'html'],
})
console.log(result.markdown)

// Take a screenshot
const screenshot = await provider.screenshot({
  format: 'png',
  fullPage: true,
}, session)

// Execute JavaScript
const evalResult = await provider.evaluate(
  'document.title',
  session,
)

// Get CDP URL for Puppeteer/Playwright
const cdpUrl = provider.getCdpUrl?.(session)

// Release session
await provider.releaseSession(session.id)
```

## Providers

| Provider | API Key Env | Session | Scrape | Screenshot | CDP | Stealth |
|----------|------------|---------|--------|------------|-----|---------|
| **Steel** | `STEEL_API_KEY` | ✓ | ✓ REST | ✓ | ✓ | ✓ |
| **Browserbase** | `BROWSERBASE_API_KEY` | ✓ | ✓ REST | ✓ | ✓ | ✓ |
| **Kernel** | `KERNEL_API_KEY` | ✓ | via CDP | ✓ | ✓ | ✓ |
| **Browserless** | `BROWSERLESS_API_KEY` | ✓ | ✓ REST | ✓ | ✓ | ✓ |
| **Hyperbrowser** | `HYPERBROWSER_API_KEY` | ✓ | ✓ REST | ✓ | ✓ | ✓ |
| **Anchor** | `ANCHOR_API_KEY` | ✓ | ✓ REST | ✓ | ✓ | ✓ |

## Architecture

Follows the same pattern as [askweb](https://github.com/oritwoen/askweb), [apkx](https://github.com/oritwoen/apkx), and [omnichron](https://github.com/oritwoen/omnichron):

```
src/
  core/       — types, registry, client, errors
  providers/  — steel, browserbase, kernel, browserless, hyperbrowser, anchor
  commands/   — CLI subcommands (scrape, screenshot, session, providers)
packages/
  pi/extensions/ — Pi agent extension (brobo_scrape, brobo_session tools)
```

Providers self-register on import. Add a new provider by creating a file in `src/providers/` that calls `register()`.

## License

MIT
