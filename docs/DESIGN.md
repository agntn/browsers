# Design system

The shared rules (direction, color roles, type, the `console-*` grammar, hero, docs chrome, density, motion, checks) live in the one agntn design system document, kept with the agntn skills until it ships in the shared package. This file records only what browsers owns and where it departs from the shared rules. It does not repeat them.

The instruments browsers owns:

| Instrument | Where | Object |
| --- | --- | --- |
| [LandingHero.vue](app/components/content/LandingHero.vue) | landing, first screen | hero zone, circuit `scrape` into the render |
| [LandingRender.vue](app/components/content/LandingRender.vue) | under the hero, and `/guide/scrape` through `::scrape-walk` | one recorded `browsers_scrape` of `https://example.com` per provider: the route the call took, the first lines that came back, form, size and time |
| [LandingMatrix.vue](app/components/content/LandingMatrix.vue) | "capabilities() is the list" | every provider against every operation, the node saying one call, inside a session or no |
| [LandingToolCall.vue](app/components/content/LandingToolCall.vue) | "Twelve tools, one executor" | one `browsers_capabilities` call, full text in the dialog |
| [LandingCustom.vue](app/components/content/LandingCustom.vue) | "Bring your own backend" | `reader.ts`, Jina Reader behind `BrowserProvider`, as a file |
| [LandingStart.vue](app/components/content/LandingStart.vue) | closing section | install, notes, the first Playwright call as a file |
| [ProviderFacts.vue](app/components/content/ProviderFacts.vue) | every provider page (`::provider-facts`) | provider dossier: ID bar with position, reticle, readout, operations, the recorded scrape, access |
| [ProviderRoster.vue](app/components/content/ProviderRoster.vue) | `/providers`, `/guide` (`::provider-roster`) | roster of the registry on `UTable`, sortable |
| [AgentTools.vue](app/components/content/AgentTools.vue) | `/guide/agents` (`::agent-tools`) | the tool list with the first sentence of each description, the whole text in the tooltip |
| [Landing.takumi.vue](app/components/OgImage/Landing.takumi.vue), [Docs.takumi.vue](app/components/OgImage/Docs.takumi.vue) | OG images | the hero zone in 1200 by 600; a docs page as one instrument, a provider page with its blurb, operation count and key |

Flags, default endpoints, keys and the `browsers_capabilities` text come from the library at build time through `modules/registry.ts`; names, glyphs and blurbs live in [providers.ts](app/utils/providers.ts); the scrape answers are the recording in `app/data/scrape-sample.json`.

## Anatomy

- **Render.** Bar `Call browsers_scrape("https://example.com", "<provider>")`, meta `recorded <date> · 03 / 08`. Subject band, left: reticle, `Provider / <key>`, name, blurb (every sample's name block hidden in the same cell, so the band keeps one height), then `Route [ what the tool did for it ]` with four steps on a dotted rail (create, session, scrape, release: filled done, hollow and struck skipped, red refused) and `Answer [ first lines, as it came back ]`, four numbered lines, each cut with an ellipsis, raw HTML muted, an error red. Readout: came back, size in the accent, time, session; a tick per operation, open where the provider can do it. `03 Full tool response` is the recorded text. Footer: provider page, previous and next.
- **Matrix.** Bar `Call provider.capabilities()`. A table: providers as rows with glyph and key, operations as columns with their names on end. The node is filled quiet for one call, hollow for inside a session, a dash for no. Only the walk's provider takes the accent: its row edge, glyph and nodes. Below 640px the keys leave for the glyphs.
- **Provider dossier.** ID bar with the key and `07 / 08`, meta host and operation count. Readout: supports in the accent, scrape, needs, endpoint; a tick per operation. Bands `Operations [ as capabilities() reports them ]` as cells with name, node and how, `Recorded [ browsers_scrape(...), <date> ]` with form, size, time and the first content line, and `Access [ library · CLI · agents ]` as leads. Two responses: `03 Full tool response` for `browsers_capabilities`, `04 Recorded scrape`.
- **Roster.** Columns provider (glyph, name, boxed key), scrape, operations, needs, and the recorded scrape behind a leader, said as `917 chars of text`, sorted by size, with the time of the call in the tooltip.

## Motion

| Change | Motion |
| --- | --- |
| landing sample advances (4.2 s, paused on hover and focus) | ruler cursor once, scan and reticle arcs, route steps slide in 60 ms apart, readout rows slide in, circuit runs once, the matrix row moves |
| reduced motion | no walk; manual previous and next still work |

## Differences

Departures from the shared rules, recorded for the shared package:

- The hero instrument is a recorded call, not a live one. A browser vendor wants a paid key and a network round trip, and a public page that proxies either is an open door to somebody's invoice. So the answers are recorded once, dated in the bar and in every footer that shows them, and never refreshed by the page.
- No playground. The same reason: there is nothing to run in a tab without keys, and Playwright needs a machine.
- The matrix is a `<table>`, not `UTable`: every cell is a node with a tooltip, not a value to sort, and a real table gives screen readers the row and column headers for free.
- `.console-wide` is a size container and the subject band stacks under 46rem of its own width.
- The version comes from the root `package.json`; there's no data version.
- The OG images ship local Figtree and Fira Code TTFs, the keys mechanism.

## Checks

Beyond the shared checks: `/`, `/guide/scrape`, `/providers`, `/providers/cloudflare` and `/providers/anchor` at 1440, 1024 and 390 px, every walk sample through the render, and no horizontal scroll at 320 px on every page.
