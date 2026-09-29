<script setup lang="ts">
import { browserToolNames } from "#tool-contract";
import { OPERATIONS, PROVIDERS, VERSION } from "../../utils/providers";
import { spellOutCapital } from "../../utils/format";
import type { ScrapeSample } from "../../utils/samples";

defineProps<{ sample: ScrapeSample; samples: readonly ScrapeSample[] }>();
const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const INSTALL = "pnpm add @agntn/browsers";
const { copied, copy } = useCopied();

const keyless = PROVIDERS.filter((provider) => provider.keyless);
</script>

<template>
  <header class="browsers-hero hero-page">
    <div class="hero-zone">
      <span class="hero-cross hero-cross-tl" aria-hidden="true">+</span>
      <span class="hero-cross hero-cross-tr" aria-hidden="true">+</span>
      <span class="hero-bracket hero-bracket-l" aria-hidden="true" />
      <span class="hero-bracket hero-bracket-r" aria-hidden="true" />

      <p class="console-id">
        <span class="console-id-tag">ID</span>
        <span>@agntn/browsers</span>
        <span class="console-id-sep" aria-hidden="true">/</span>
        <span>v{{ VERSION }}</span>
      </p>

      <h1 class="hero-title">
        One scrape call. <span>{{ spellOutCapital(PROVIDERS.length) }} browsers behind it.</span>
      </h1>
      <p class="hero-lead">
        Steel scrapes in one HTTP call. Kernel wants a live session first. Browserbase hands you a
        CDP URL. A model will mix those up, so this is one <code class="browsers-code">scrape()</code> over all of them,
        in TypeScript, in the terminal and in your agent, and each backend says flag by flag what
        it can do.
      </p>

      <dl class="hero-metrics">
        <div>
          <dt>Providers</dt>
          <dd>{{ PROVIDERS.length }}</dd>
          <dd class="hero-metric-sub">{{ OPERATIONS.length }} flags each</dd>
        </div>
        <div>
          <dt>Agent tools</dt>
          <dd>{{ browserToolNames.length }}</dd>
          <dd class="hero-metric-sub">the same on MCP, Pi and OMP</dd>
        </div>
        <div>
          <dt>Keys to start</dt>
          <dd class="hero-metric-accent">0</dd>
          <dd class="hero-metric-sub">{{ keyless.map((provider) => provider.name).join(", ") }} runs here</dd>
        </div>
      </dl>

      <div class="console-actions">
        <UButton
          to="/guide"
          color="primary"
          variant="solid"
          trailing-icon="i-lucide-arrow-right"
          label="Get started"
        />
        <UButton
          to="https://github.com/agntn/browsers"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
          label="Star on GitHub"
        />
      </div>
      <div class="console-install">
        <span class="console-install-tag">Install</span>
        <code><span class="console-install-prompt">$</span> {{ INSTALL }}</code>
        <UButton
          color="neutral"
          variant="subtle"
          :icon="copied === 'install' ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-label="copied === 'install' ? 'Copied' : 'Copy install command'"
          @click="copy('install', INSTALL)"
        />
      </div>
    </div>

    <!-- One recorded scrape per provider: the path the call took and what came back. -->
    <div class="hero-instrument">
      <svg class="hero-circuit" viewBox="0 0 160 56" aria-hidden="true">
        <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
        <path :key="sample.provider.key" class="hero-circuit-live" d="M80 0V16L96 32V56" pathLength="1" />
        <path class="hero-circuit-seg" d="M96 38V48" />
        <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
      </svg>
      <span class="hero-circuit-tag" aria-hidden="true">scrape</span>
      <LandingRender :sample="sample" :samples="samples" @step="emit('step', $event)" @pause="emit('pause', $event)" />
    </div>
  </header>
</template>
