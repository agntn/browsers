<script setup lang="ts">
import { tokens } from "../../utils/tokens";

const { copied, copy } = useCopied();

/**
 * A provider of your own: Jina Reader behind the same contract as the built-ins. The comment on
 * the last line was checked by running this file against the library; check it again if you
 * touch it.
 */
const FILE = [
  "import { create, notSupportedViaRest, register } from \"@agntn/browsers\";",
  "import type { BrowserProvider, ProviderCapabilities, ProviderConfig, ScrapeResult } from \"@agntn/browsers\";",
  "",
  "/** Jina Reader renders the page and answers with markdown, one GET per URL. */",
  "class Reader implements BrowserProvider {",
  "  private readonly baseURL: string;",
  "",
  "  constructor(config: ProviderConfig) {",
  "    this.baseURL = config.baseURL!;",
  "  }",
  "",
  "  name(): string {",
  "    return \"reader\";",
  "  }",
  "",
  "  capabilities(): ProviderCapabilities {",
  "    return {",
  "      scrape: true,",
  "      statelessScrape: true,",
  "      screenshot: false,",
  "      statelessScreenshot: false,",
  "      navigate: false,",
  "      evaluate: false,",
  "      sessions: false,",
  "      cdp: false,",
  "      crawl: false,",
  "      pdf: false,",
  "      links: false,",
  "      search: false,",
  "      extract: false,",
  "    };",
  "  }",
  "",
  "  async scrape(url: string): Promise<ScrapeResult> {",
  "    const response = await fetch(`${this.baseURL}/${url}`, { headers: { \"X-No-Cache\": \"true\" } });",
  "    return { url, markdown: await response.text(), statusCode: response.status };",
  "  }",
  "",
  "  async createSession(): Promise<never> {",
  "    return notSupportedViaRest(\"reader\", \"sessions\");",
  "  }",
  "  async getSession(): Promise<never> {",
  "    return notSupportedViaRest(\"reader\", \"sessions\");",
  "  }",
  "  async listSessions(): Promise<never> {",
  "    return notSupportedViaRest(\"reader\", \"sessions\");",
  "  }",
  "  async releaseSession(): Promise<never> {",
  "    return notSupportedViaRest(\"reader\", \"sessions\");",
  "  }",
  "  async screenshot(): Promise<never> {",
  "    return notSupportedViaRest(\"reader\", \"screenshot\");",
  "  }",
  "  async navigate(): Promise<never> {",
  "    return notSupportedViaRest(\"reader\", \"navigate\");",
  "  }",
  "  async evaluate(): Promise<never> {",
  "    return notSupportedViaRest(\"reader\", \"evaluate\");",
  "  }",
  "}",
  "",
  "register(\"reader\", \"https://r.jina.ai\", (config) => new Reader(config));",
  "",
  "const page = await (await create(\"reader\")).scrape(\"https://example.com\");",
  "page.markdown; // \"Title: Example Domain\\n\\nURL Source: https://example.com/ \u2026\"",
] as const;

/**
 * The line of `FILE` that starts with `start`.
 *
 * @param {string} start - Its first characters.
 * @returns {string} The whole line.
 */
function line(start: string): string {
  return FILE.find((entry) => entry.startsWith(start))!;
}

/**
 * What the panel shows: the parts the section talks about, the rest folded the way an editor
 * folds it. Copy hands out `FILE`, every line.
 */
const LINES = [
  FILE[0],
  "",
  "class Reader implements BrowserProvider {",
  "  /* baseURL, name() and capabilities(): scrape only */",
  "  async scrape(url) { /* GET r.jina.ai/<url>, markdown back */ }",
  '  /* createSession … evaluate: notSupportedViaRest("reader", …) */',
  "}",
  "",
  line("register("),
  line("const page"),
] as const;
</script>

<template>
  <section class="tool-console landing-custom" aria-label="A provider of your own">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"><span class="console-tag">File</span>reader.ts</span>
      <span class="console-meta">folded · copy is whole</span>
      <span class="console-mark" aria-hidden="true" />
      <UButton
        color="neutral"
        variant="subtle"
        :icon="copied === 'reader' ? 'i-lucide-check' : 'i-lucide-copy'"
        :label="copied === 'reader' ? 'copied' : 'copy'"
        :aria-label="copied === 'reader' ? 'Copied' : 'Copy reader.ts'"
        @click="copy('reader', FILE.join('\n'))"
      />
    </header>
    <div class="console-ruler" aria-hidden="true" />

    <div class="custom-body">
      <!-- prettier-ignore -->
      <pre class="console-snippet console-lines"><code><span v-for="(line, index) in LINES" :key="index"><span v-for="(token, part) in tokens(line)" :key="part" :class="token.cls">{{ token.text }}</span></span></code></pre>
    </div>
  </section>
</template>

<style scoped>
.custom-body {
  padding: 14px 20px 18px;
}
/* Breaks only between words: a string split at any character is hard to read. */
.custom-body > .console-snippet {
  overflow-wrap: break-word;
}
@media (width < 400px) {
  .custom-body {
    padding-inline: 14px;
  }
}
</style>
