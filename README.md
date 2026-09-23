# @agntn/browsers

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/browsers)](https://npmx.dev/package/@agntn/browsers)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/browsers)](https://npmx.dev/package/@agntn/browsers)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/browsers)](https://npmx.dev/package/@agntn/browsers)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/browsers)

🌐 Eight vendors. One scrape call. JavaScript already ran.

## Why?

Steel scrapes in one HTTP call. Kernel wants a live session first. Browserbase hands you CDP. A model will mix those three up, so this is one `scrape()` over eight backends.

## ✨ Features

- 🧩 **Eight backends, one contract.** Steel, Browserbase, Kernel, Browserless, Hyperbrowser, Anchor, Cloudflare and Playwright. Same objects on your side. Anchor still has no scrape.
- 🖥️ **Playwright is local.** No key. Chromium on the machine you already have.
- ⚡ **Stateless where the vendor is.** Steel, Browserbase, Browserless, Hyperbrowser, Cloudflare and Playwright scrape without you opening a session. Kernel will not.
- 📸 **The extras follow the backend.** PDFs, crawls, links, AI extract, search. Anchor will not scrape. Hyperbrowser will search.
- 🏷️ **`capabilities()` is the list.** Navigate is true on Kernel, Browserless and Playwright. False on Steel. Read the flag.
- 🤖 **Five surfaces, eleven tools.** CLI, library, MCP, Pi, OMP. They share the executors.
- 📏 **Agent scrape has a ceiling.** 20 000 characters unless you pass `maxChars`, 200 000 at most.
- 🔐 **Keys in a URL get scrubbed.** Query params named `token` or `api_key` land in errors as `[REDACTED]`.

## 📦 Install

```bash
pnpm add @agntn/browsers
```

Node.js 22 or newer.

## 🚀 First call

```bash
npx @agntn/browsers scrape https://example.com --provider playwright
```

```
ℹ Scraping via playwright...
Example Domain

This domain is for use in documentation examples without needing permission. Avoid use in operations.

Learn more
```

No key, no account. Playwright runs Chromium here. After `pnpm add`, that command is `pnpm exec browsers`, or install it once with `pnpm add -g @agntn/browsers`. Skip `--provider` and the first configured backend that can run the command wins. Steel if that key is set. Playwright if nothing else is. `links` on a Steel setup skips Steel, which has no links endpoint.

The scrape said "Learn more" and dropped the href. This did not:

```bash
browsers links https://example.com --provider playwright
```

```
https://iana.org/domains/example
```

Same page, different door. Who is even configured?

```bash
browsers providers
```

```
● steel           scrape screenshot(sess) sessions cdp
● browserbase     scrape sessions cdp
● kernel          scrape(sess) screenshot(sess) navigate evaluate sessions cdp
● browserless     scrape screenshot navigate evaluate sessions cdp pdf
● hyperbrowser    scrape screenshot sessions cdp crawl search extract
● anchor          screenshot(sess) sessions cdp
● cloudflare      scrape screenshot sessions cdp crawl pdf links extract
● playwright      scrape screenshot(sess) navigate evaluate sessions crawl pdf links
```

Filled dot means that key was in the env on this run. Playwright is always filled. A few more:

```bash
browsers scrape https://example.com --provider playwright --format html
browsers scrape https://example.com --provider playwright --waitFor h1
browsers scrape https://example.com --browser kitesurf
browsers screenshot https://example.com -o page.png
browsers pdf https://example.com -o page.pdf --provider playwright
browsers crawl https://example.com --maxPages 5 --provider playwright
browsers search "browser automation" --provider hyperbrowser
browsers extract https://example.com --prompt "Extract the heading"
browsers session create --provider kernel
```

`search` is Hyperbrowser. `extract` is Cloudflare or Hyperbrowser. The rest take `-p` when you do not want the default. `--browser kitesurf` picks Cloudflare and opts into Kitesurf. Leave it out and Cloudflare stays on Chromium.

### Commands

| Command      | What it does                         | Example                                               |
| ------------ | ------------------------------------ | ----------------------------------------------------- |
| `scrape`     | Rendered page, markdown if it exists | `browsers scrape https://example.com -p playwright`   |
| `screenshot` | Image to a file                      | `browsers screenshot https://example.com -o page.png` |
| `crawl`      | Follow links, cap with `--maxPages`  | `browsers crawl https://example.com --maxPages 5`     |
| `pdf`        | URL to a PDF file                    | `browsers pdf https://example.com -o page.pdf`        |
| `links`      | Unique hrefs                         | `browsers links https://example.com -p playwright`    |
| `search`     | Hyperbrowser web search              | `browsers search "browser automation"`                |
| `extract`    | Structured extract with a prompt     | `browsers extract https://example.com --prompt "..."` |
| `session`    | `create`, `list`, `release`          | `browsers session create -p kernel`                   |
| `providers`  | Who is configured, what they can do  | `browsers providers`                                  |
| `mcp`        | MCP server on stdio                  | `browsers mcp`                                        |

## 🧠 Library

```typescript
import { create } from "@agntn/browsers";

const provider = await create("playwright");
const page = await provider.scrape("https://example.com");
console.log(page.markdown ?? page.text ?? page.html);

const caps = provider.capabilities();
console.log(caps.statelessScrape, caps.pdf, caps.cdp);
```

That's most of it, really. `create("steel")` if you have `STEEL_API_KEY`. `resolveProvider()` picks the first one that does. Want Kitesurf on Cloudflare? Use `create("cloudflare", { browser: "kitesurf" })`. Without that option it stays on Chromium. Kernel scrape wants a session object. The agent tools and the CLI `scrape` command open one and close it.

`create()` is async because that first call is where the provider module gets imported. Importing the package loads no provider and no HTTP client, `providers()` and `has()` answer from a manifest, and `@agntn/browsers/providers/steel` gives you one provider's `factory` directly.

## 🗺️ Providers

| Provider         | Auth                             | Capabilities                                                                  |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| **steel**        | `STEEL_API_KEY`                  | scrape, screenshot (session), sessions, CDP                                   |
| **browserbase**  | `BROWSERBASE_API_KEY`            | scrape, sessions, CDP                                                         |
| **kernel**       | `KERNEL_API_KEY`                 | scrape (session), screenshot (session), navigate, evaluate, sessions, CDP     |
| **browserless**  | `BROWSERLESS_API_KEY`            | scrape, screenshot, navigate, evaluate, sessions, CDP, PDF                    |
| **hyperbrowser** | `HYPERBROWSER_API_KEY`           | scrape, screenshot, sessions, CDP, crawl, search, extract                     |
| **anchor**       | `ANCHOR_API_KEY`                 | screenshot (session), sessions, CDP                                           |
| **cloudflare**   | `CF_API_TOKEN` + `CF_ACCOUNT_ID` | scrape, screenshot, sessions, CDP, crawl, PDF, links, extract                 |
| **playwright**   | none, local                      | scrape, screenshot (session), navigate, evaluate, sessions, crawl, PDF, links |

Anchor does not scrape. The row stays, because someone will look for it. Cloudflare also accepts `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## 🤖 Agents

```bash
browsers mcp
pi install git:github.com/agntn/browsers
omp install @agntn/browsers
```

```json
{
  "mcpServers": {
    "browsers": { "command": "browsers", "args": ["mcp"] }
  }
}
```

Eleven tools, `browsers_scrape` through `browsers_capabilities`, the same eleven on MCP, Pi and OMP. Cloudflare calls backed by Browser Run take `browser: "kitesurf"`. No `provider` needed then. They do not drive a session you already opened. `browsers_screenshot` hands the image back to the model. A full page too big for that goes to a file: pass `path`, and it refuses to overwrite one that exists. `browsers_pdf` always writes to `path`, under the same rule, since a PDF cannot go back to the model.

## 🚫 What this does not do

Need a fetch that is not a browser? [@agntn/web](https://github.com/agntn/web). Need last year's page? [@agntn/archives](https://github.com/agntn/archives). Need to click through a login? Not this package. The tools never grew `navigate` or `evaluate`.

## 🧩 Adding a provider

Want a ninth? A class that implements `BrowserProvider`, an exported `factory`, a manifest entry in `src/providers/index.ts` and the name list in `src/tool-contract.ts`. Nonstandard env keys go in `src/core/resolve.ts`. Outside the package, `register(name, defaultURL, factory)` adds one at runtime.

## 🛠️ Development

```bash
pnpm install
pnpm lint         # builds first, then oxlint and oxfmt --check
pnpm lint:fix
pnpm typecheck    # tsc, then a build, then the extensions
pnpm test:run
pnpm build        # obuild
```

## 💛 Thanks

Work on this library ran through two OSS programs, [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss). Thank you <3

## 📄 License

[MIT](./LICENSE)
