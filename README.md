# @agntn/browsers

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/browsers)](https://npmx.dev/package/@agntn/browsers)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/browsers)](https://npmx.dev/package/@agntn/browsers)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/browsers)](https://npmx.dev/package/@agntn/browsers)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/browsers)

🌐 Different browsers, same job. One scrape call. JavaScript already ran.

Docs, a page per provider and one real scrape through each of them: [browsers.agntn.dev](https://browsers.agntn.dev).

## Why?

Steel scrapes in one HTTP call. Kernel wants a live session first. Browserbase hands you CDP. A model will mix those three up, so this is one `scrape()` over all of them.

## ✨ Features

- 🧩 **Every backend, one contract.** Steel, Browserbase, Kernel, Browserless, Hyperbrowser, Anchor, Cloudflare, Playwright, Lightpanda and Attach. Same objects on your side. Anchor still has no scrape.
- 🖥️ **Playwright is local.** No key. Chromium on the machine you already have.
- 🐼 **Lightpanda isn't Chromium.** A headless browser built from scratch. No token, and it runs your local `lightpanda`, no key, no bill. With `LIGHTPANDA_API_KEY` it goes to the cloud. It never paints, so no screenshots or PDFs.
- 🔌 **Attach reads your own tabs.** Borrowed books and SSO dashboards are fair game. Name the provider explicitly. Your browser stays open, and navigation stays yours.
- ⚡ **Stateless where the vendor is.** Steel, Browserbase, Browserless, Hyperbrowser, Cloudflare, Playwright, Lightpanda and Attach scrape without you opening a session. Kernel will not.
- 📸 **The extras follow the backend.** PDFs, crawls, links, AI extract, search. Anchor will not scrape. Hyperbrowser will search.
- 🏷️ **`capabilities()` is the list.** Navigate is true on Kernel, Browserless, Playwright and Lightpanda. False on Steel. Read the flag.
- 🤖 **One set of tools for people and models.** The CLI, MCP, Pi, OMP and the AI SDK get the same tools. Plus the library. Six surfaces, one list.
- 📏 **Agent scrape and crawl have a ceiling.** 20 000 characters unless you pass `maxChars`, 200 000 at most. A crawl shares it across pages.
- ⏳ **A slow crawl keeps its job.** Cloudflare and Hyperbrowser wait two minutes, then hand back the job ID. Pass it as `jobId` with the same provider and browser, or `--job-id` in the CLI, and you wait for that job again. No second crawl.
- 🔗 **Agent links come in pages.** 500 per call unless you pass `limit`, 5 000 at most. The answer counts the rest and names the `offset` to ask for next. The CLI pages too. Same `--limit`, same `--offset`.
- ♿ **A form reads as its fields.** The accessibility tree gives one line per field, button or heading, with its state. The httpbin pizza form comes to about a thousand characters. Cloudflare only for now.
- 🪄 **Some pages hand you their own tools.** List them and ask the page directly, without scraping HTML and guessing. A tool can change things, so check what it does first. [WebMCP](https://browsers.agntn.dev/guide/webmcp) runs on Cloudflare.
- 🔐 **Keys in a URL get scrubbed.** Query params named `token` or `api_key` land in errors as `[REDACTED]`.

## 📦 Install

```bash
pnpm add @agntn/browsers
```

Node.js 26 or newer.

## 🚀 First call

```bash
npx @agntn/browsers scrape https://example.com --provider playwright
```

```
[provider=playwright] https://example.com

This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.

هذا النطاق مُخصص للاستخدام في أمثلة التوثيق دون الحاجة إلى إذن. هذه ليست خدمة، يُرجى تجنب الاعتماد عليها لأغراض الاختبار والمراقبة.

该域名仅用于文档示例，无需获得许可。这并非一项服务，请勿将其用于测试和监控目的。

L’usage de ce domaine est réservé à des exemples de documentation, sans autorisation préalable. Il ne s’agit pas d’un service ; son utilisation à des fins de test ou de surveillance est à éviter.

Данный домен предназначен для использования в примерах документации без необходимости получения предварительного разрешения. Это не сервис; не рекомендуется его использование для тестирования и мониторинга.

Este dominio está destinado al uso en ejemplos de documentación sin necesidad de permiso. Esto no es un servicio; evitar utilizarlo para realizar pruebas o monitoreos.

Learn more
```

Six languages now, same notice. No key, no account. Playwright runs Chromium here. After `pnpm add`, that command is `pnpm exec browsers`, or install it once with `pnpm add -g @agntn/browsers`. Skip `--provider` and the first configured backend that can run the command wins. Steel if that key is set. Playwright if nothing else is. `links` on a Steel setup skips Steel, which has no links endpoint.

The scrape said "Learn more" and dropped the href. This did not:

```bash
browsers links https://example.com --provider playwright
```

```
[provider=playwright] 1 links:
https://iana.org/help/example-domains
```

Same page, different door. A form wants a third one, the accessibility tree:

```bash
browsers accessibility https://httpbin.org/forms/post --root fieldset
```

```
[provider=cloudflare] https://httpbin.org/forms/post (status 200): 16 nodes

- group "Pizza Size"
  - Legend
    - StaticText "Pizza Size"
      - InlineTextBox
  - paragraph
    - none
      - radio "Small" checked=false
      - none
  - paragraph
    - none
      - radio "Medium" checked=false
      - none
  - paragraph
    - none
      - radio "Large" checked=false
      - none
```

`--root` keeps every node of that subtree, the boring ones too. Leave it out and you get the whole page, trimmed. Cloudflare answers this one.

Who is even configured?

```bash
browsers providers
```

```
○ steel
○ browserbase
○ kernel
○ browserless
○ hyperbrowser
○ anchor
○ cloudflare
● playwright  scrape screenshot navigate evaluate sessions statelessScrape elementScreenshot screenshotWaitFor scrapeWaitFor crawl pdf links
● lightpanda  scrape navigate evaluate sessions cdp statelessScrape scrapeWaitFor links
● attach  scrape screenshot evaluate sessions statelessScrape statelessScreenshot elementScreenshot screenshotWaitFor scrapeWaitFor links
```

A filled dot means the provider can run here. Usually that's a key in the env. Cloudflare also counts your `cf auth login`, which costs one `cf auth whoami`. Playwright, Lightpanda and Attach are always filled, though Attach still waits for you to name it. A few more:

```bash
browsers scrape https://example.com --provider playwright --wait-for p
browsers scrape https://example.com --browser kitesurf
browsers screenshot https://example.com -o page.png
browsers screenshot https://example.com -o notice.png --selector p -p browserless
browsers screenshot https://quotes.toscrape.com/js-delayed/ -o quotes.png --wait-for .quote -p playwright
browsers pdf https://example.com -o page.pdf --provider playwright
browsers crawl https://example.com --max-pages 5 --provider playwright
browsers crawl --job-id <job-id> --provider cloudflare
browsers search browser automation -n 3
browsers extract https://example.com --prompt "Extract the heading"
browsers session --provider kernel
```

`search` is Hyperbrowser. `extract` is Cloudflare or Hyperbrowser. The rest take `-p` when you do not want the default. `--browser kitesurf` picks Cloudflare and opts into Kitesurf. Leave it out and Cloudflare stays on Chromium.

### Commands

| Command         | What it does                          | Example                                                                                   |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `scrape`        | Rendered page, markdown if it exists  | `browsers scrape https://example.com -p playwright`                                       |
| `screenshot`    | Image to a file                       | `browsers screenshot https://example.com -o page.png`                                     |
| `crawl`         | Follow links, cap with `--max-pages`  | `browsers crawl https://example.com --max-pages 5`                                        |
| `pdf`           | URL to a PDF file                     | `browsers pdf https://example.com -o page.pdf`                                            |
| `links`         | Unique hrefs                          | `browsers links https://example.com -p playwright`                                        |
| `accessibility` | Roles, names and states, one per line | `browsers accessibility https://example.com`                                              |
| `webmcp-tools`  | The WebMCP tools a page registers     | `browsers webmcp-tools https://radar.cloudflare.com/`                                     |
| `webmcp-call`   | Run one of them with JSON input       | `browsers webmcp-call https://radar.cloudflare.com/ search --input '{"query":"1.1.1.1"}'` |
| `search`        | Hyperbrowser web search               | `browsers search "browser automation"`                                                    |
| `extract`       | Structured extract with a prompt      | `browsers extract https://example.com --prompt "..."`                                     |
| `session`       | Open a session, ID only               | `browsers session -p kernel`                                                              |
| `sessions`      | Active session IDs                    | `browsers sessions -p kernel`                                                             |
| `release`       | Close one, stop the bill              | `browsers release <session-id> -p kernel`                                                 |
| `providers`     | Who is configured, what they can do   | `browsers providers`                                                                      |
| `capabilities`  | What one provider can do              | `browsers capabilities cloudflare`                                                        |
| `mcp`           | MCP server on stdio                   | `browsers mcp`                                                                            |

## 🧠 Library

```typescript
import { create } from "@agntn/browsers";

const provider = await create("playwright");
const page = await provider.scrape("https://example.com");
console.log(page.markdown ?? page.text ?? page.html);

const caps = provider.capabilities();
console.log(caps.statelessScrape, caps.pdf, caps.cdp);
```

That's most of it, really. `create("steel")` if you have `STEEL_API_KEY`. `resolveProvider()` picks the first one that does. Want Kitesurf on Cloudflare? Use `create("cloudflare", { browser: "kitesurf" })`. Without that option it stays on Chromium. Cloudflare scrape also fills `title` and `statusCode`. Ask it for `html` and `markdown` together, or add `screenshot: true`, and all of them come from one render. Kernel scrape wants a session object. The agent tools and the CLI `scrape` command open one and close it.

`create()` is async because that first call is where the provider module gets imported. Importing the package loads no provider and no HTTP client, `providers()` and `has()` answer from a manifest, and `@agntn/browsers/providers/steel` gives you one provider's `factory` directly.

## 🗺️ Providers

| Provider         | Auth                                                   | Capabilities                                                                                                                                      |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **steel**        | `STEEL_API_KEY`                                        | scrape, screenshot (session), sessions, CDP                                                                                                       |
| **browserbase**  | `BROWSERBASE_API_KEY`                                  | scrape, sessions, CDP                                                                                                                             |
| **kernel**       | `KERNEL_API_KEY`                                       | scrape (session), scrape waitFor, screenshot (session), navigate, evaluate, sessions, CDP                                                         |
| **browserless**  | `BROWSERLESS_API_KEY`                                  | scrape, scrape waitFor, screenshot, element screenshot, screenshot waitFor, navigate, evaluate, sessions, CDP, PDF                                |
| **hyperbrowser** | `HYPERBROWSER_API_KEY`                                 | scrape, screenshot, sessions, CDP, crawl, search, extract                                                                                         |
| **anchor**       | `ANCHOR_API_KEY`                                       | screenshot (session), sessions, CDP                                                                                                               |
| **cloudflare**   | `cf auth login` or `CLOUDFLARE_API_TOKEN` + account ID | scrape, scrape waitFor, screenshot, element screenshot, screenshot waitFor, sessions, CDP, crawl, PDF, links, extract, accessibility tree, WebMCP |
| **playwright**   | none, local                                            | scrape, scrape waitFor, screenshot (session), element screenshot, screenshot waitFor, navigate, evaluate, sessions, crawl, PDF, links             |
| **lightpanda**   | none, local, or `LIGHTPANDA_API_KEY` for its cloud     | scrape, scrape waitFor, navigate, evaluate, sessions, CDP, links                                                                                  |
| **attach**       | none, your own browser on port 9222 or `ATTACH_URL`    | scrape, scrape waitFor, screenshot, element screenshot, screenshot waitFor, evaluate, sessions, links                                             |

Anchor does not scrape. The row stays, because someone will look for it. Cloudflare can use your `cf auth login`, so there's no token to export. An exported `CLOUDFLARE_API_TOKEN` still needs an account variable.

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

Every tool, `browsers_scrape` through `browsers_capabilities`, is the same on MCP, Pi and OMP. Cloudflare page tools take `browser: "kitesurf"`. No `provider` needed then. They do not drive a session you already opened, and Kitesurf has none to drive.

`browsers_screenshot` hands the image back to the model. A full page too big for that goes to a file: pass `path`, and it refuses to overwrite one that exists. `browsers_pdf` always writes to `path`, under the same rule, since a PDF cannot go back to the model.

Pass `selector` and you get one element instead of the page. Cloudflare, Browserless and Playwright can do that. Attach can too, once you name it. Leave `provider` out and one of them gets picked; name another and it says no rather than hand back the whole page.

`waitFor` holds the shot until a CSS selector shows up, so a page that fills itself in late stops coming back half built. Same three providers, plus Attach by name, same flat no from the rest.

`browsers_scrape` takes `waitFor` too. Kernel joins the club there, since it runs Playwright inside the session anyway. Lightpanda is a browser itself and waits through CDP. Attach waits right in your own tab.

Steel, Browserbase and Hyperbrowser have nothing to wait with, so they refuse before a single request. Used to be they'd hand back the empty skeleton and call it a scrape.

### AI SDK

Give your model browser tools without writing wrappers. One import, every tool.

```bash
pnpm add @agntn/browsers ai @ai-sdk/anthropic
```

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { browsersAiTools } from "@agntn/browsers/ai";
import { generateText, isStepCount } from "ai";

const { text } = await generateText({
  model: anthropic("claude-sonnet-5-5"),
  tools: browsersAiTools,
  stopWhen: isStepCount(5),
  prompt: "Which browser providers can I use right now?",
});
```

The model gets the same answers as MCP. For errors, images and the disk, see the [Agents guide](https://browsers.agntn.dev/guide/agents#ai-sdk).

## 🚫 What this does not do

Need a fetch that is not a browser? [@agntn/web](https://github.com/agntn/web). Need last year's page? [@agntn/archives](https://github.com/agntn/archives). Need to click through a login? Not this package. The tools never grew `navigate` or `evaluate`.

## 🧩 Adding a provider

Want another? A class that implements `BrowserProvider`, an exported `factory`, a manifest entry in `src/providers/index.ts` and the name list in `src/tool-contract.ts`. Nonstandard env keys go in `src/core/resolve.ts`. Outside the package, `register(name, defaultURL, factory)` adds one at runtime.

## 🛠️ Development

```bash
pnpm install      # docs/ too: one workspace, one lockfile
pnpm lint         # builds first, then vp lint and vp fmt --check
pnpm lint:fix
pnpm typecheck    # tsc, the build config, a build, then the extensions
pnpm test:run
pnpm build        # obuild
```

## 💛 Thanks

Work on this library ran through two OSS programs, [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss). Thank you <3

## 📄 License

[MIT](./LICENSE)
