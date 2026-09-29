<script setup lang="ts">
import { OPERATIONS, PROVIDERS, type ProviderEntry, type Support } from "../../utils/providers";

const props = defineProps<{ current?: string }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

const SUPPORT_LABEL: Record<Support, string> = {
  direct: "one call",
  session: "inside a session",
  no: "not supported",
};

/** One row per provider in registry order, one cell per operation `capabilities()` reports. */
const rows = PROVIDERS.map((provider) => ({
  provider,
  cells: OPERATIONS.map((operation) => ({
    operation,
    support: operation.support(provider.capabilities),
  })),
}));

/** Per operation, how many providers can do it at all. */
const coverage = OPERATIONS.map(
  (operation) => PROVIDERS.filter((provider) => operation.support(provider.capabilities) !== "no").length,
);

/**
 * A cell's tooltip: provider, operation, and how it gets done.
 *
 * @param {ProviderEntry} provider - The row.
 * @param {string} label - The operation.
 * @param {Support} support - How the provider meets it.
 * @returns {string} One line.
 */
function about(provider: ProviderEntry, label: string, support: Support): string {
  return `${provider.name} · ${label} · ${SUPPORT_LABEL[support]}`;
}
</script>

<template>
  <section
    class="tool-console console-wide landing-matrix"
    aria-label="What every provider can do"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"><span class="console-tag">Call</span>provider.capabilities()</span>
      <span class="console-meta">{{ PROVIDERS.length }} providers · {{ OPERATIONS.length }} operations</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="current" class="console-cursor" />
    </div>

    <div class="matrix-body">
      <table class="matrix">
        <caption class="sr-only">
          Operations per provider: one call, inside a session, or not supported
        </caption>
        <thead>
          <tr>
            <th scope="col" class="matrix-corner"><span class="sr-only">Provider</span></th>
            <th v-for="(operation, index) in OPERATIONS" :key="operation.key" scope="col">
              <UTooltip :text="`${operation.about} · ${coverage[index]} of ${PROVIDERS.length}`">
                <span class="matrix-op" tabindex="0">{{ operation.label }}</span>
              </UTooltip>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.provider.key"
            :data-current="row.provider.key === current ? '' : undefined"
          >
            <th scope="row">
              <NuxtLink :to="row.provider.to" class="matrix-provider">
                <UIcon :name="row.provider.icon" class="matrix-icon" aria-hidden="true" />
                <span class="matrix-key">{{ row.provider.key }}</span>
              </NuxtLink>
            </th>
            <td v-for="cell in row.cells" :key="cell.operation.key">
              <UTooltip :text="about(row.provider, cell.operation.label, cell.support)">
                <span class="matrix-cell" :data-support="cell.support" tabindex="0"
                  ><span class="matrix-node" aria-hidden="true" /><span class="sr-only">{{
                    SUPPORT_LABEL[cell.support]
                  }}</span></span
                >
              </UTooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="console-footer console-footer-plain">
      <span class="matrix-legend"
        ><span class="matrix-node" data-support="direct" aria-hidden="true" /> one call
        <span class="matrix-node" data-support="session" aria-hidden="true" /> inside a session
        <span class="matrix-node" data-support="no" aria-hidden="true" /> no</span
      >
      <NuxtLink to="/providers" class="matrix-link"
        ><span aria-hidden="true">→ </span>every provider, with its keys and routes</NuxtLink
      >
    </footer>
  </section>
</template>

<style scoped>
.matrix-body {
  padding: 14px 20px 18px;
  overflow-x: auto;
}
.matrix {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.matrix th,
.matrix td {
  padding: 0;
  font-weight: 400;
  text-align: center;
}
.matrix-corner {
  width: 9.5rem;
}
/* Column heads stand on end, so thirteen of them fit where thirteen words would not. */
.matrix thead th {
  height: 6.5rem;
  vertical-align: bottom;
  padding-bottom: 10px;
}
.matrix-op {
  display: inline-block;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.matrix-op:focus-visible,
.matrix-cell:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
.matrix tbody tr {
  box-shadow: inset 0 1px 0 var(--ui-border-muted);
}
.matrix tbody th {
  text-align: left;
}
.matrix-provider {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  height: 34px;
  padding: 0 8px 0 10px;
}
.matrix-icon {
  width: 14px;
  height: 14px;
  color: var(--ui-text-dimmed);
}
.matrix-key {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.matrix-provider:hover .matrix-key {
  color: var(--console-accent);
}
.matrix-provider:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: -2px;
}
.matrix tr[data-current] > th {
  box-shadow: inset 2px 0 0 var(--console-accent);
}
.matrix tr[data-current] .matrix-key {
  color: var(--ui-text-highlighted);
}
.matrix tr[data-current] .matrix-icon {
  color: var(--console-accent);
}
.matrix tr[data-current] {
  background: color-mix(in srgb, var(--console-accent) 4%, var(--ui-bg));
}
.matrix-cell {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
}
/* The state rides on the node: filled for one call, hollow for a session, a short dash for no. */
.matrix-node {
  display: inline-block;
  width: 8px;
  height: 8px;
}
.matrix-node[data-support="direct"],
.matrix-cell[data-support="direct"] .matrix-node {
  background: color-mix(in srgb, var(--ui-text-muted) 70%, var(--ui-bg));
}
.matrix-node[data-support="session"],
.matrix-cell[data-support="session"] .matrix-node {
  box-shadow: inset 0 0 0 1px var(--ui-text-muted);
}
.matrix-node[data-support="no"],
.matrix-cell[data-support="no"] .matrix-node {
  height: 1px;
  background: var(--console-line);
}
.matrix tr[data-current] .matrix-cell[data-support="direct"] .matrix-node {
  background: var(--console-accent);
}
.matrix tr[data-current] .matrix-cell[data-support="session"] .matrix-node {
  box-shadow: inset 0 0 0 1px var(--console-accent);
}
.matrix-legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.matrix-legend > .matrix-node:not(:first-child) {
  margin-left: 8px;
}
.matrix-link {
  margin-left: auto;
  color: var(--ui-text-highlighted);
}
.matrix-link:hover {
  color: var(--console-accent);
}
.matrix-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 640px) {
  .matrix-legend {
    display: none;
  }
  .matrix-corner {
    width: 2.25rem;
  }
  .matrix-key {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .matrix-provider {
    padding: 0 6px;
  }
  .matrix-cell {
    width: 18px;
  }
}
@media (width < 400px) {
  .matrix-body {
    padding-inline: 10px;
  }
  .matrix-op {
    font-size: 10px;
    letter-spacing: 0.02em;
  }
}
</style>
