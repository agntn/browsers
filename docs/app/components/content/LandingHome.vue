<script setup lang="ts">
import { DEFAULT_LINKS_LIMIT, DEFAULT_SCRAPE_MAX_CHARS, browserToolNames } from "#tool-contract";
import { OPERATIONS, PROVIDERS } from "../../utils/providers";
import { spellOut, spellOutCapital } from "../../utils/format";

const { samples, paused, current, step } = useLandingWalk();

const scrape = OPERATIONS.find((operation) => operation.key === "scrape")!;
/** Providers by how they scrape, read off the same flags the matrix draws. */
const oneCall = PROVIDERS.filter((provider) => scrape.support(provider.capabilities) === "direct");
const inSession = PROVIDERS.filter((provider) => scrape.support(provider.capabilities) === "session");
const noScrape = PROVIDERS.filter((provider) => scrape.support(provider.capabilities) === "no");

const names = (list: typeof PROVIDERS) => list.map((provider) => provider.name).join(" and ");
</script>

<template>
  <div class="browsers-landing not-prose">
    <LandingHero :sample="current" :samples="samples" @step="step" @pause="paused = $event" />

    <section class="browsers-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <div class="max-w-2xl">
          <h2 class="text-2xl font-medium tracking-tight text-highlighted sm:text-[1.75rem]">
            capabilities() is the list
          </h2>
          <p class="mt-4 text-sm leading-6 text-muted">
            {{ spellOutCapital(oneCall.length) }} of the {{ spellOut(PROVIDERS.length) }} scrape in
            one call. {{ names(inSession) }} only scrapes inside a session, which the tools and the
            CLI open and release for you. {{ names(noScrape) }} doesn't scrape at all, and says so
            instead of handing back an empty page. Everything past that is a flag per operation,
            read off a live instance, so a README can't drift from it. This grid is those flags.
          </p>
          <p class="landing-entry">
            <span class="console-tag">Import</span>
            <code>(await create("cloudflare")).capabilities()</code>
          </p>
        </div>
        <LandingMatrix :current="current.provider.key" class="mt-10" @pause="paused = $event" />
      </div>
    </section>

    <LandingFeature
      :title="`${spellOutCapital(browserToolNames.length)} tools, one executor`"
      to="/guide/agents"
      link="MCP, Pi and OMP"
      :checks="[
        `A scrape stops at ${DEFAULT_SCRAPE_MAX_CHARS.toLocaleString('en-US')} characters unless you pass maxChars, and says how much it cut`,
        `Links come ${DEFAULT_LINKS_LIMIT} at a time, with the offset to ask for next`,
        'A slow crawl hands back its job ID instead of a timeout',
      ]"
      reverse
    >
      <code class="browsers-code">browsers mcp</code>, the Pi extension and the OMP extension call
      the same executors, so a fix lands once and a model reads the same text on every host. The
      console asks <code class="browsers-code">browsers_capabilities</code> about the provider in
      the panel above. The dialog holds exactly what a model would get.
      <template #visual>
        <LandingToolCall :sample="current" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      title="Bring your own backend"
      to="/guide/custom"
      link="Custom providers"
      :checks="[
        'A class that implements BrowserProvider and a factory that builds it',
        'notSupportedViaRest turns every missing operation into a typed refusal',
        'register(name, defaultURL, factory) and create(name) finds it',
      ]"
    >
      The built-ins are {{ spellOut(PROVIDERS.length) }} classes behind one interface, and yours is
      the same shape in one file. This one puts Jina Reader behind
      <code class="browsers-code">scrape()</code>: one GET, markdown back, and an honest no for
      everything it can't do.
      <template #visual>
        <LandingCustom />
      </template>
    </LandingFeature>

    <section class="browsers-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <LandingStart />
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing-entry {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 20px 0 0;
  min-width: 0;
}
.landing-entry > .console-tag {
  flex: none;
  margin: 0;
}
.landing-entry > code {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
</style>
