<script setup lang="ts">
import { OPERATIONS, PROVIDERS, supportedCount } from "../../utils/providers";
import type { ScrapeSample } from "../../utils/samples";

const props = defineProps<{ sample: ScrapeSample }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

const provider = computed(() => props.sample.provider);
const text = computed(() => provider.value.capabilitiesText);
const title = computed(() => `browsers_capabilities({ provider: "${provider.value.key}" })`);

/** What the flags add up to, read from the same `capabilities()` the tool text prints. */
const rows = computed(() => {
  const flags = provider.value.capabilities;
  const count = supportedCount(provider.value);
  return [
    { label: "supports", value: `${count} of ${OPERATIONS.length} operations`, accent: true },
    {
      label: "scrape",
      value: !flags.scrape ? "none" : flags.statelessScrape ? "one call" : "session only",
      dim: !flags.scrape,
    },
    { label: "needs", value: provider.value.keyless ? "nothing, it runs here" : provider.value.env },
  ];
});
</script>

<template>
  <section
    class="tool-console landing-call"
    aria-label="One tool call"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>browsers_capabilities(<Transition
          name="browsers-roll"
          mode="out-in"
          ><span :key="provider.key" class="browsers-roll-slot tok-str"
            >"{{ provider.key }}"</span
          ></Transition
        >)</span
      >
      <span class="console-meta">{{ PROVIDERS.length }} providers</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="provider.key" class="console-cursor" />
    </div>

    <!-- The provider on the crosses grid, what its flags add up to in the readout. -->
    <div class="call-subject">
      <div :key="provider.key" class="console-scan" aria-hidden="true" />
      <div class="call-identity">
        <ConsoleReticle :key="provider.key" :icon="provider.icon" />
        <div class="call-name">
          <span class="console-label"
            >Provider / <span class="console-label-key">{{ provider.key }}</span></span
          >
          <h3>{{ provider.name }}</h3>
          <p class="call-note">
            The flags come off a live instance, not a table in a README. What the model reads is
            what the next call will run into.
          </p>
        </div>
      </div>
      <div class="console-readout">
        <dl :key="provider.key" class="console-readout-rows console-animate">
          <div v-for="(row, index) in rows" :key="row.label" :style="{ animationDelay: `${index * 45}ms` }">
            <dt>{{ row.label }}</dt>
            <dd :class="{ 'console-accent': row.accent, 'call-dim': row.dim }">
              <span class="call-line">{{ row.value }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <ConsoleResponse :title="title" :text="text" />

    <footer class="console-footer console-footer-plain">
      <span aria-label="Supported hosts: MCP, Pi and OMP">MCP · Pi · OMP</span>
      <span class="console-meta">browsers mcp · stdio</span>
    </footer>
  </section>
</template>

<style scoped>
.call-subject {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 18px 20px 20px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Cpath d='M16 18h4m-2-2v4' fill='none' stroke='%23818a94' stroke-opacity='.1'/%3E%3C/svg%3E");
  background-size: 36px 36px;
  background-position: 24px 20px;
}
.call-subject > :not(.console-scan) {
  position: relative;
}
.call-identity {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}
.call-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.call-name h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--ui-text-highlighted);
}
.call-note {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted);
}
.landing-call .console-readout-rows > div {
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
.landing-call .console-readout-rows dt {
  text-transform: none;
  letter-spacing: 0.02em;
}
.call-dim {
  color: var(--ui-text-dimmed);
}
.call-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (width < 400px) {
  .call-subject {
    padding-inline: 14px;
  }
  .call-identity {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
  }
}
</style>
