<script setup lang="ts">
import { OPERATIONS, PROVIDERS, providerEntry, registryPosition, type Support } from "../../utils/providers";
import { RECORDED_ON, SAMPLES, SAMPLE_URL, firstLine } from "../../utils/samples";

const props = defineProps<{ name: string }>();

const entry = computed(() => providerEntry(props.name));
const position = computed(() => registryPosition(props.name));
const sample = computed(() => SAMPLES.find((row) => row.provider.key === props.name));

const SUPPORT_LABEL: Record<Support, string> = {
  direct: "one call",
  session: "session",
  no: "no",
};

/** Every operation `capabilities()` reports, with how this provider meets it. */
const operations = computed(() =>
  entry.value
    ? OPERATIONS.map((operation) => ({ operation, support: operation.support(entry.value!.capabilities) }))
    : [],
);
const supported = computed(() => operations.value.filter((row) => row.support !== "no").length);
const scrape = computed(() => operations.value.find((row) => row.operation.key === "scrape")!.support);

/** The endpoint's host, or `local` for a provider that runs on this machine. */
const host = computed(() => {
  const url = entry.value?.defaultURL ?? "";
  return URL.canParse(url) ? new URL(url).host : url;
});

const cli = computed(() => `browsers scrape ${SAMPLE_URL} -p ${props.name}`);
const capabilitiesTitle = computed(() => `browsers_capabilities({ provider: "${props.name}" })`);
const scrapeTitle = computed(() => `browsers_scrape({ url: "${SAMPLE_URL}", provider: "${props.name}" })`);

const FORM_LABEL = { html: "raw HTML", markdown: "markdown", text: "plain text", refused: "an error" } as const;
</script>

<template>
  <section v-if="entry" class="tool-console console-wide not-prose my-6" aria-label="Provider record">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">ID</span>{{ entry.key
        }}<span class="console-file"
          >{{ String(position).padStart(2, "0") }} / {{ PROVIDERS.length }}</span
        ></span
      >
      <span class="console-meta">{{ host }} · {{ supported }} of {{ OPERATIONS.length }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true"><span class="console-cursor" /></div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="entry.key" :icon="entry.icon" />
        <div class="console-name">
          <span class="console-label"
            >Provider / <span class="console-label-key">{{ entry.key }}</span></span
          >
          <h3>{{ entry.name }}</h3>
          <p class="console-about">{{ entry.blurb }}.</p>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows">
          <div>
            <dt>Supports</dt>
            <dd class="console-accent">
              <span class="facts-line">{{ supported }} of {{ OPERATIONS.length }} operations</span>
            </dd>
          </div>
          <div>
            <dt>Scrape</dt>
            <dd>
              <span class="facts-line" :class="{ 'facts-none': scrape === 'no' }">{{
                scrape === "no" ? "not at all" : SUPPORT_LABEL[scrape]
              }}</span>
            </dd>
          </div>
          <div>
            <dt>Needs</dt>
            <dd>
              <UTooltip :text="entry.keyless ? 'Nothing to set' : entry.env">
                <span class="facts-line" tabindex="0">{{ entry.keyless ? "no key" : entry.env }}</span>
              </UTooltip>
            </dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd>
              <span class="facts-line">{{ host }}</span>
            </dd>
          </div>
        </dl>
        <div
          class="console-gauge"
          :aria-label="`${supported} of ${OPERATIONS.length} operations supported`"
        >
          <span class="console-ticks" aria-hidden="true">
            <span
              v-for="(row, index) in operations"
              :key="row.operation.key"
              :class="row.support === 'no' ? 'console-tick-closed' : 'console-tick-open'"
              :style="{ animationDelay: `${index * 12}ms` }"
            />
          </span>
          <span class="console-gauge-read">operations {{ supported }} / {{ OPERATIONS.length }}</span>
        </div>
      </div>
    </div>

    <div class="console-band">
      <p class="console-label console-rule-title">
        <span
          >Operations <span aria-hidden="true"
            >[ as <span class="console-label-key">capabilities()</span> reports them ]</span
          ></span
        >
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ul class="facts-ops">
        <li v-for="row in operations" :key="row.operation.key" :data-support="row.support">
          <UTooltip :text="row.operation.about">
            <span class="facts-op" tabindex="0">{{ row.operation.label }}</span>
          </UTooltip>
          <span class="facts-node" aria-hidden="true" />
          <span class="facts-support">{{ SUPPORT_LABEL[row.support] }}</span>
        </li>
      </ul>
    </div>

    <div v-if="sample" class="console-band">
      <p class="console-label console-rule-title">
        <span
          >Recorded <span aria-hidden="true"
            >[ <span class="console-label-key">browsers_scrape("{{ SAMPLE_URL }}")</span>, {{ RECORDED_ON }} ]</span
          ></span
        >
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="facts-recorded">
        <div>
          <dt>Came back</dt>
          <dd :class="{ 'facts-refused': sample.form === 'refused' }">{{ FORM_LABEL[sample.form] }}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{{ sample.form === "refused" ? "nothing" : `${sample.length.toLocaleString("en-US")} characters` }}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{{ sample.ms.toLocaleString("en-US") }} ms</dd>
        </div>
      </dl>
      <p class="facts-first">
        <UTooltip :text="sample.body">
          <span class="facts-line" tabindex="0">{{ firstLine(sample.body) }}</span>
        </UTooltip>
      </p>
    </div>

    <div class="console-band">
      <p class="console-label console-rule-title">
        <span>Access <span aria-hidden="true">[ library · CLI · agents ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="facts-leads">
        <dd class="console-lead">
          <span class="console-tag">Create</span>
          <code class="facts-code"
            ><span class="tok-fn">create</span>(<span class="tok-str">"{{ entry.key }}"</span>)</code
          >
          <span class="console-leader" aria-hidden="true" />
        </dd>
        <dd class="console-lead">
          <span class="console-tag">CLI</span>
          <UTooltip :text="cli">
            <code class="facts-code" tabindex="0"><span class="tok-fn">browsers</span> {{ cli.slice(9) }}</code>
          </UTooltip>
          <span class="console-leader" aria-hidden="true" />
        </dd>
        <dd class="console-lead">
          <span class="console-tag">Tool</span>
          <code class="facts-code">provider: <span class="tok-str">"{{ entry.key }}"</span></code>
          <span class="console-leader" aria-hidden="true" />
        </dd>
      </dl>
    </div>

    <ConsoleResponse :title="capabilitiesTitle" :text="entry.capabilitiesText" />
    <ConsoleResponse
      v-if="sample"
      index="04"
      label="Recorded scrape"
      :description="`The complete text browsers_scrape returned on ${RECORDED_ON}.`"
      :title="scrapeTitle"
      :text="sample.text"
    />

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/providers"><span aria-hidden="true">→ </span>All providers</NuxtLink>
        </li>
        <li>
          <NuxtLink to="/guide/scrape"><span aria-hidden="true">→ </span>Scrape</NuxtLink>
        </li>
      </ul>
      <span class="console-meta">flags from the library / scrape recorded {{ RECORDED_ON }}</span>
    </footer>
  </section>
</template>

<style scoped>
.facts-none {
  color: var(--ui-text-dimmed);
}
/* Values stay on one line for every provider; the whole value is in the tooltip. */
.facts-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
section :deep(.console-readout-rows > div) {
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
/* A cell per operation: name, node, how. The node carries the state the way the landing grid does. */
.facts-ops {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.facts-ops > li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8px auto;
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.facts-op {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.facts-node {
  width: 8px;
  height: 8px;
}
.facts-ops > li[data-support="direct"] .facts-node {
  background: color-mix(in srgb, var(--ui-text-muted) 70%, var(--ui-bg));
}
.facts-ops > li[data-support="session"] .facts-node {
  box-shadow: inset 0 0 0 1px var(--ui-text-muted);
}
.facts-ops > li[data-support="no"] .facts-node {
  height: 1px;
  background: var(--console-line);
}
.facts-ops > li[data-support="no"] .facts-op {
  color: var(--ui-text-dimmed);
}
.facts-support {
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
  color: var(--ui-text-dimmed);
}
.facts-recorded {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}
.facts-recorded dt {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text-dimmed);
}
.facts-recorded dd {
  margin: 4px 0 0;
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-highlighted);
}
.facts-refused {
  color: var(--browsers-del) !important;
}
.facts-first {
  margin: 12px 0 0;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ui-text-muted);
  outline: 1px dashed var(--console-line);
  outline-offset: -1px;
}
.facts-code {
  min-width: 0;
  overflow: hidden;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.facts-leads {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: 0 28px;
  margin: 0;
}
.facts-leads > .console-lead {
  margin: 0 0 8px;
  flex-wrap: nowrap;
  min-width: 0;
}
/* Under 400px the bracketed notes leave the rule titles, so a long call never widens the page. */
@media (width < 400px) {
  .console-rule-title > span > span[aria-hidden="true"] {
    display: none;
  }
}
@media (width < 640px) {
  .facts-leads .console-leader {
    display: none;
  }
}
</style>
