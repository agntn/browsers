<script setup lang="ts">
import { OPERATIONS, PROVIDERS, registryPosition } from "../../utils/providers";
import { RECORDED_ON, SAMPLE_URL, type AnswerForm, type ScrapeSample } from "../../utils/samples";

const props = defineProps<{ sample: ScrapeSample; samples: readonly ScrapeSample[] }>();
const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const { copied, copy } = useCopied();

const provider = computed(() => props.sample.provider);
const call = computed(
  () => `browsers_scrape({ url: "${SAMPLE_URL}", provider: "${provider.value.key}" })`,
);

/** Lines of the answer the panel shows; the rest is one click away in the full response. */
const LINES = 4;
const lines = computed(() => {
  const shown = props.sample.body
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, LINES);
  return Array.from({ length: LINES }, (_, index) => shown[index]);
});

const FORM_LABEL: Record<AnswerForm, string> = {
  html: "raw HTML",
  markdown: "markdown",
  text: "plain text",
  refused: "an error",
};

const chars = computed(() => props.sample.length.toLocaleString("en-US"));

/** The widest answer in the walk, so the size reads against the others. */
const longest = Math.max(...props.samples.map((sample) => sample.length));
const smallest = Math.min(...props.samples.filter((s) => s.length > 0).map((s) => s.length));

const session = computed(() => {
  const step = props.sample.route.find((entry) => entry.label === "session")!;
  if (props.sample.form === "refused") return "none, refused first";
  return step.state === "done" ? "opened, then released" : "none, one call";
});

/** One tick per operation `capabilities()` reports, open where this provider can do it. */
const ticks = computed(() =>
  OPERATIONS.map((operation) => ({
    key: operation.key,
    open: operation.support(provider.value.capabilities) !== "no",
  })),
);
const supported = computed(() => ticks.value.filter((tick) => tick.open).length);
</script>

<template>
  <section
    class="tool-console console-wide landing-render"
    aria-label="One scrape call through every provider"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="call">
        <span class="console-title render-call" tabindex="0"
          ><span class="console-tag">Call</span>browsers_scrape(<span class="tok-str"
            >"{{ SAMPLE_URL }}"</span
          >, <span class="tok-str">"{{ provider.key }}"</span>)</span
        >
      </UTooltip>
      <span class="console-meta"
        >recorded {{ RECORDED_ON }} ·
        {{ String(registryPosition(provider.key)).padStart(2, "0") }} / {{ PROVIDERS.length }}</span
      >
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="provider.key" class="console-cursor" />
    </div>

    <div class="console-band console-subject-band render-subject">
      <div :key="provider.key" class="console-scan" aria-hidden="true" />
      <div class="render-left">
        <div class="console-identity-block">
          <ConsoleReticle :key="provider.key" :icon="provider.icon" />
          <!-- Every sample's name sits in the same cell, hidden, so the band keeps the tallest one's height. -->
          <div class="render-names">
            <div
              v-for="other in samples"
              :key="other.provider.key"
              class="console-name"
              :class="{ 'render-sizer': other.provider.key !== provider.key }"
              :aria-hidden="other.provider.key !== provider.key ? 'true' : undefined"
            >
              <span class="console-label"
                >Provider / <span class="console-label-key">{{ other.provider.key }}</span></span
              >
              <h3>{{ other.provider.name }}</h3>
              <p class="console-about">{{ other.provider.blurb }}.</p>
            </div>
          </div>
        </div>

        <div class="render-board">
          <p class="console-label console-rule-title">
            <span>Route <span aria-hidden="true">[ what the tool did for it ]</span></span>
            <span class="console-mark" aria-hidden="true" />
          </p>
          <ol :key="provider.key" class="render-route" aria-label="Steps of the call">
            <li
              v-for="(step, index) in sample.route"
              :key="step.label"
              class="render-step"
              :data-state="step.state"
              :style="{ animationDelay: `${index * 60}ms` }"
            >
              <span class="render-node" aria-hidden="true" />
              <span class="render-step-label">{{ step.label }}</span>
              <span class="sr-only">{{ step.state }}</span>
            </li>
          </ol>

          <p class="console-label console-rule-title">
            <span>Answer <span aria-hidden="true">[ first lines, as it came back ]</span></span>
            <span class="console-mark" aria-hidden="true" />
            <UButton
              color="neutral"
              variant="subtle"
              :icon="copied === 'answer' ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="copied === 'answer' ? 'copied' : 'copy'"
              :aria-label="copied === 'answer' ? 'Copied' : 'Copy the answer'"
              @click="copy('answer', sample.body)"
            />
          </p>
          <ol :key="provider.key" class="render-lines" :data-form="sample.form">
            <li v-for="(line, index) in lines" :key="index" :data-empty="line === undefined ? '' : undefined">
              <span class="render-line-no" aria-hidden="true">{{ index + 1 }}</span>
              <span class="render-line-text">{{ line ?? "" }}</span>
            </li>
          </ol>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl :key="provider.key" class="console-readout-rows console-animate">
          <div>
            <dt>Came back</dt>
            <dd :class="{ 'render-refused': sample.form === 'refused' }">
              <span class="render-line">{{ FORM_LABEL[sample.form] }}</span>
            </dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd class="console-accent">
              <UTooltip
                :text="`The longest answer in this walk is ${longest.toLocaleString('en-US')} characters, the shortest ${smallest.toLocaleString('en-US')}`"
              >
                <span class="render-line" tabindex="0">{{
                  sample.form === "refused" ? "nothing" : `${chars} characters`
                }}</span>
              </UTooltip>
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>
              <span class="render-line">{{ sample.ms.toLocaleString("en-US") }} ms</span>
            </dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>
              <span class="render-line">{{ session }}</span>
            </dd>
          </div>
        </dl>
        <div
          class="console-gauge"
          :aria-label="`${supported} of ${OPERATIONS.length} operations supported`"
        >
          <span class="console-ticks" aria-hidden="true">
            <span
              v-for="(tick, index) in ticks"
              :key="tick.key"
              :class="tick.open ? 'console-tick-open' : 'console-tick-closed'"
              :style="{ animationDelay: `${index * 12}ms` }"
            />
          </span>
          <span class="console-gauge-read">operations {{ supported }} / {{ OPERATIONS.length }}</span>
        </div>
      </div>
    </div>

    <ConsoleResponse :title="call" :text="sample.text" />

    <footer class="console-footer console-footer-plain">
      <NuxtLink :to="provider.to" class="render-link"
        ><span aria-hidden="true">→ </span>{{ provider.name }}<span> · {{ provider.to }}</span></NuxtLink
      >
      <div class="console-controls" aria-label="Sample providers">
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-left"
          aria-label="Previous provider"
          @click="emit('step', -1)"
        />
        <span>Provider</span>
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-right"
          aria-label="Next provider"
          @click="emit('step', 1)"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.render-call {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.render-names {
  display: grid;
  min-width: 0;
}
.render-names > .console-name {
  grid-area: 1 / 1;
}
.render-sizer {
  visibility: hidden;
}
.render-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.render-refused {
  color: var(--browsers-del);
}
.landing-render :deep(.console-readout-rows > div) {
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
/* The left column: the provider, then the path the call took and what came back, right under it. */
.render-left {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.render-board {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.render-board > .console-rule-title {
  margin: 0;
}
.render-board > .console-rule-title:not(:first-child) {
  margin-top: 8px;
}
/* Four steps on one rail; a skipped step keeps its place, hollow and quiet, so the row never moves. */
.render-route {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}
.render-route::before {
  content: "";
  position: absolute;
  top: 5px;
  left: 5px;
  right: 0;
  border-top: 1px dotted var(--console-line);
}
.render-step {
  position: relative;
  display: grid;
  gap: 8px;
  justify-items: start;
  min-width: 0;
  animation: render-in 0.3s ease-out both;
}
.render-node {
  width: 11px;
  height: 11px;
  background: var(--ui-bg);
  box-shadow: inset 0 0 0 1px var(--console-corner);
}
.render-step[data-state="done"] .render-node {
  background: var(--console-accent);
  box-shadow: none;
}
.render-step[data-state="refused"] .render-node {
  background: var(--browsers-del);
  box-shadow: none;
}
.render-step-label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ui-text-highlighted);
}
.render-step[data-state="skipped"] .render-step-label {
  color: var(--ui-text-dimmed);
  text-decoration: line-through;
  text-decoration-color: var(--console-line);
}
.render-step[data-state="refused"] .render-step-label {
  color: var(--browsers-del);
}
/* The answer's first lines, the number in its own column so an ellipsis never hides it. */
.render-lines {
  display: grid;
  margin: 0;
  padding: 8px 12px;
  list-style: none;
  background: var(--ui-bg);
  outline: 1px dashed var(--console-line);
  outline-offset: -1px;
}
.render-lines > li {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  height: 22px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 22px;
}
.render-line-no {
  color: var(--ui-text-dimmed);
  user-select: none;
}
.render-line-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  color: var(--ui-text-highlighted);
}
.render-lines[data-form="html"] .render-line-text {
  color: var(--ui-text-muted);
}
.render-lines[data-form="refused"] .render-line-text {
  color: var(--browsers-del);
}
.render-lines > li[data-empty] .render-line-no {
  opacity: 0.4;
}
@keyframes render-in {
  from {
    transform: translateX(-8px);
  }
}
/* Side by side, the readout runs as tall as the left column; stacked, it keeps its own height. */
@container (width >= 46rem) {
  .render-subject > .console-readout {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    align-self: stretch;
  }
  .render-subject .console-readout-rows {
    grid-auto-rows: minmax(2.5rem, 1fr);
  }
  .render-subject .console-readout-rows > div {
    align-items: center;
  }
}
.render-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.render-link > span:last-child {
  color: var(--ui-text-dimmed);
}
.render-link:hover {
  color: var(--console-accent);
}
.render-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 640px) {
  .render-board > .console-rule-title > .console-mark {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .render-step {
    animation: none;
  }
}
</style>
