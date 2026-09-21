# Changelog


## v0.3.0

[compare changes](https://github.com/agntn/browsers/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- **cloudflare:** Support the Kitesurf engine ([#40](https://github.com/agntn/browsers/pull/40))

### 🩹 Fixes

- **tools:** Stop advertising session driving ([#39](https://github.com/agntn/browsers/pull/39))
- **playwright:** Sessions outlive their instance ([#41](https://github.com/agntn/browsers/pull/41))
- **cli:** Scrape opens the session Kernel needs ([#42](https://github.com/agntn/browsers/pull/42))
- **client:** Accept any type on binary posts ([#43](https://github.com/agntn/browsers/pull/43))
- **anchor:** Match the documented API ([#44](https://github.com/agntn/browsers/pull/44))
- **screenshot:** Use routes the providers have ([#45](https://github.com/agntn/browsers/pull/45))
- **client:** Retry after a request times out ([#60](https://github.com/agntn/browsers/pull/60))

### 💅 Refactors

- ⚠️  Load a provider when a call names it ([#51](https://github.com/agntn/browsers/pull/51))

### 📖 Documentation

- README shows a scrape, not a table ([#38](https://github.com/agntn/browsers/pull/38))

### 🏡 Chore

- Add `renovate.json` ([9af2369](https://github.com/agntn/browsers/commit/9af2369))

### 🤖 CI

- Add test, autofix and publish workflows ([#53](https://github.com/agntn/browsers/pull/53))

#### ⚠️ Breaking Changes

- ⚠️  Load a provider when a call names it ([#51](https://github.com/agntn/browsers/pull/51))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Aeitwoen ([@aeitwoen](https://github.com/aeitwoen))
- Aei ([@aeitwoen](https://github.com/aeitwoen))

## v0.2.0


### 🚀 Enhancements

- Brobo — unified browser-as-a-service provider for agents ([4f15d2e](https://github.com/agntn/browsers/commit/4f15d2e))
- Add Cloudflare Browser Run provider ([a9567c3](https://github.com/agntn/browsers/commit/a9567c3))
- Stateless screenshot for cloudflare/browserless, optional session in interface ([61701d9](https://github.com/agntn/browsers/commit/61701d9))
- Provider capabilities in pi extension (brobo_providers + brobo_capabilities) ([b4dd439](https://github.com/agntn/browsers/commit/b4dd439))
- CLI providers shows full capability matrix ([a554f8e](https://github.com/agntn/browsers/commit/a554f8e))
- Crawl, pdf, links, search, extract — verified on live APIs ([8b5035a](https://github.com/agntn/browsers/commit/8b5035a))
- CLI commands + Pi tools for crawl, pdf, links, search, extract ([148ee34](https://github.com/agntn/browsers/commit/148ee34))
- Add playwright local browser provider ([877fbf3](https://github.com/agntn/browsers/commit/877fbf3))
- Capabilities system, quality improvements, tests ([34d59cc](https://github.com/agntn/browsers/commit/34d59cc))
- **pi:** Expose schemas to browser extraction ([#23](https://github.com/agntn/browsers/pull/23))
- **tui:** Unify browser tool rendering ([#34](https://github.com/agntn/browsers/pull/34))

### 🩹 Fixes

- Resolve provider by API key presence, clean error messages ([1e6c116](https://github.com/agntn/browsers/commit/1e6c116))
- Pi extension using correct ExtensionAPI (registerTool, Type, Text) ([da2c705](https://github.com/agntn/browsers/commit/da2c705))
- Consistent navigate/evaluate — throw when API has no REST endpoint (browserbase, hyperbrowser, anchor) ([374f35f](https://github.com/agntn/browsers/commit/374f35f))
- Correct API endpoints verified against live providers ([3f92dea](https://github.com/agntn/browsers/commit/3f92dea))
- Cloudflare waitForNetworkIdle overwriting waitForSelector ([f7b81f0](https://github.com/agntn/browsers/commit/f7b81f0))
- Scaffold audit — typed errors, shared utils, cloudflare client bypass ([52a267f](https://github.com/agntn/browsers/commit/52a267f))
- Preserve binary and JSON response handling ([#1](https://github.com/agntn/browsers/pull/1))
- Close browserbase sessions with REQUEST_RELEASE ([#3](https://github.com/agntn/browsers/pull/3))
- **pi:** Keep session credentials private ([#17](https://github.com/agntn/browsers/pull/17))
- **pi:** Repair checkout source loading ([#18](https://github.com/agntn/browsers/pull/18))
- **pi:** Write scraped page content once ([#19](https://github.com/agntn/browsers/pull/19))
- **pi:** Bound scrape output across providers ([#20](https://github.com/agntn/browsers/pull/20))
- **links:** Collapse repeated hrefs ([#26](https://github.com/agntn/browsers/pull/26))
- **playwright:** Wait for DOM content ([#27](https://github.com/agntn/browsers/pull/27))
- **scrape:** Support providers needing sessions ([#28](https://github.com/agntn/browsers/pull/28))
- **kernel:** Use current browser API ([#29](https://github.com/agntn/browsers/pull/29))
- **hyperbrowser:** Restore session lifecycle ([#30](https://github.com/agntn/browsers/pull/30))
- **steel:** Flag Cloudflare challenge pages ([#31](https://github.com/agntn/browsers/pull/31))
- **browserless:** Allow rendered HTML responses ([#32](https://github.com/agntn/browsers/pull/32))
- **browserless:** Follow Session API handles ([#33](https://github.com/agntn/browsers/pull/33))
- **cloudflare:** Require token and account ID ([#35](https://github.com/agntn/browsers/pull/35))
- **errors:** Classify HTTP payment failures ([#36](https://github.com/agntn/browsers/pull/36))

### 💅 Refactors

- Rename package to @oritwoen/browsers ([cbb3632](https://github.com/agntn/browsers/commit/cbb3632))
- ⚠️  Adopt @agntn/browsers everywhere ([#4](https://github.com/agntn/browsers/pull/4))

### 🏡 Chore

- Bring browsers onto shared ox policy ([#22](https://github.com/agntn/browsers/pull/22))
- Stop tracking PLAN.md ([20ea227](https://github.com/agntn/browsers/commit/20ea227))

### ✅ Tests

- **brobo:** NormalizeMainArgs (4/4 PASS) ([9d8240d](https://github.com/agntn/browsers/commit/9d8240d))
- **brobo:** Error hierarchy + parseRetryAfter (21/21 PASS) ([800d0ac](https://github.com/agntn/browsers/commit/800d0ac))

#### ⚠️ Breaking Changes

- ⚠️  Adopt @agntn/browsers everywhere ([#4](https://github.com/agntn/browsers/pull/4))

### ❤️ Contributors

- Aeitwoen ([@aeitwoen](https://github.com/aeitwoen))
- Ori ([@oritwoen](https://github.com/oritwoen))
- Or <or@local>
- Oritwoen ([@oritwoen](https://github.com/oritwoen))

