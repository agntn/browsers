# docs/

Docus site for `@agntn/browsers` at browsers.agntn.dev. Markdown lives in `content/`. The site calls no browser vendor: flags, keys and tool text come from the library at build time, and every scrape answer on it is a dated recording.

## Layout

```
docs/
├── DESIGN.md                      # the instruments this site owns and where it departs from the agntn design system
├── nuxt.config.ts                 # extends: ['docus'], cloudflare_module preset (Workers), #tool-contract aliased to ../src
├── modules/registry.ts            # runs the library once in Node and ships #browsers-registry: flags, keys, browsers_capabilities text
├── shared/types/registry.ts       # the record the module writes and the pages read
├── shiki-theme.ts                 # code block theme, every colour a --shiki-token-* variable from app.css
├── app/app.config.ts              # title, github, theme, the Nuxt UI variants in the instrument grammar
├── app/app.css                    # theme tokens, the shared `console-*` and `hero-*` grammar, `browsers-*` classes
├── app/components/                # Docus overrides: header, tabs, sidebar, table of contents, page links, surround, callout; icons are Lucide, brands simple-icons
├── app/components/content/        # MDC components (`::landing-home`, `::provider-facts`, `::provider-roster`, `::scrape-walk`, `::agent-tools`), the landing instruments, Prose* overrides
├── app/components/OgImage/        # Docs.takumi and Landing.takumi override the Docus OG templates
├── app/assets/fonts.css           # @font-face for the TTFs served from public/fonts (site and OG images)
├── app/composables/               # useLandingWalk (one clock for every live panel), useSubNavigation, useCopied, useRosterFlip
├── app/data/scrape-sample.json    # one recorded browsers_scrape of https://example.com per provider
├── app/utils/                     # providers (names, glyphs, blurbs, operations over the registry), samples, tokens, roster, formatting
├── public/                        # fonts, favicon.svg and the icons and manifest cut from it
├── content/index.md               # landing
├── content/1.guide/               # getting started, scrape, captures, reading, crawl, sessions, CLI, agents, errors, custom
└── content/2.providers/           # overview, one page per provider in registry order
```

## Commands

```bash
pnpm install          # from docs/, the repo root needs no install or build first
pnpm dev              # http://localhost:3000
pnpm build            # Cloudflare Workers output in .output/, content routes prerendered
pnpm deploy           # build, then wrangler deploy to browsers.agntn.dev
```

Deployment: Workers Builds with root directory `docs`. It installs `docs/` and nothing else, and that's enough. Nitro preset `cloudflare_module`. Nuxt Content wants a D1 binding named `DB`. `wrangler.jsonc` carries it plus the `NUXT_SITE_URL` var. The database `agntn-browsers` lives in the EU jurisdiction, which is set at creation; the binding names it by id alone. No KV binding.

`modules/registry.ts` imports `../src/core/registry.ts`, `../src/core/resolve.ts`, `../src/providers/index.ts` and `../src/tool-operations.ts` under Nuxt's jiti when Nuxt starts. That works without the root `node_modules` because nothing in that graph imports an npm package at module scope: `ofetch` and `playwright-core` load on the first request or launch, which the module never makes. A new top-level npm import anywhere under `src/core`, `src/providers` or `src/tool-operations.ts` breaks the deploy. Add the package to `docs/package.json` at the root's version, or keep the import lazy.

The template is plain JavaScript with a `.d.mts` beside it for the types. `nuxt build` keeps its build directory under `node_modules/.cache`, where Nitro strips no TypeScript, so a `.ts` template passed the first build of a checkout and broke every one after it.

The page itself imports only `src/tool-contract.ts` (through `#tool-contract`), which imports nothing. The provider modules stay out of the browser: `playwright.ts` imports `node:child_process`.

Two resolution traps, both because the repo root is its own pnpm workspace:

- `pnpm-workspace.yaml` sets `shamefullyHoist: true`. Without it `docs/node_modules` holds only direct dependencies, Node walks up to the root `node_modules`, and the server bundle can end up with a second copy of Vue.
- `nuxt.config.ts` pins `workspaceDir` to `docs/`, disables devtools and telemetry, and adds the repo root to `vite.server.fs.allow`, since `src/version.ts` reads `../package.json`.

## Live values

- Every flag, key and count on the landing, in the rosters and on the provider pages comes from the library at build time. `PROVIDERS` in `app/utils/providers.ts` maps `#browsers-registry` and adds a display name, a glyph and a blurb from `PRESENTATION`, which the type requires for every key in `browserProviderNames`.
- The module gives `browsers_capabilities` a placeholder in every provider variable for the one call and restores the environment after, so the build's own keys never shape the site and no request leaves it.
- `app/data/scrape-sample.json` is one `browserScrape({ url: "https://example.com", provider })` per provider, run with real keys through `src/tool-operations.ts`, with the wall time of each call. The page says when it was recorded. A new provider needs a new recording; `utils/samples.ts` throws at build time when one is missing.
- The counts in prose (headline, OG image, SEO description, section text) come from `PROVIDERS`, `OPERATIONS` and `browserToolNames` through `spellOut`. Frontmatter and `content/` can't call a function, so they never state a count that depends on the registry.
- The samples are deterministic, so SSR and the client agree and hydration doesn't flicker. No `Math.random`, no clock inside a computed.
- `LandingCustom.vue` is a literal. `reader.ts` compiled under `strict` against the package types and ran against `r.jina.ai` before it went on the page; its last comment is what that run printed. Check it again if you touch it.

## SEO

- `seo.schema` in `app/app.config.ts` emits the landing JSON-LD: `WebSite`, the agntn `Organization` as publisher, and a free `SoftwareApplication` with `sameAs` on GitHub and npm.
- `public/favicon.svg` is the source, the PNGs and the `.ico` are cut from it with ImageMagick.

## OG images

- `app/components/OgImage/Docs.takumi.vue` and `Landing.takumi.vue` override the Docus templates and are rendered by Takumi at build time. Takumi has no CSS variables, so the theme colours are repeated there as literals. A provider page's card is built from the registry, not from the description.
- `app/assets/fonts.css` declares the Figtree and Fira Code TTFs in `public/fonts`, which is where nuxt-og-image reads them.
- Descriptions go without commas and without a trailing period: Docus puts them in the OG file name, where a comma is a separator and `..png` is skipped without a word. A `: ` in a frontmatter description is a YAML mapping and the page vanishes from the prerender.

## Constraints

- Scraped text from the recording is rendered as text, through interpolation or a `<pre>`. Never `v-html`.
- Every command and output quoted in `content/` came from a real run of the CLI or the tools. Run a new one the same way before it goes on a page.
- The site makes no request to a browser vendor and stays that way.
