<script setup lang="ts">
import { browserToolDescriptions, browserToolLabels, browserToolNames } from "#tool-contract";
import { ROSTER_CLASS } from "../../utils/roster";

/** The first sentence of a tool's description, what a model reads first; the whole text is in the tooltip. */
function lead(description: string): string {
  const cut = description.search(/\.\s/u);
  return cut === -1 ? description : description.slice(0, cut + 1);
}

const rows = browserToolNames.map((name) => ({
  name,
  label: browserToolLabels[name],
  description: browserToolDescriptions[name],
  lead: lead(browserToolDescriptions[name]),
}));
</script>

<template>
  <section class="roster not-prose my-6" aria-label="Agent tools">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header :class="ROSTER_CLASS.bar">
      <span :class="ROSTER_CLASS.title">browsers mcp · tools/list</span>
      <span :class="ROSTER_CLASS.meta">{{ rows.length }} tools · same on MCP, Pi and OMP</span>
    </header>
    <div class="roster-ruler" aria-hidden="true" />
    <ul class="tools-rows">
      <li v-for="row in rows" :key="row.name">
        <code>{{ row.name }}</code>
        <UTooltip :text="row.description" :content="{ side: 'top' }">
          <span class="tools-lead" tabindex="0">{{ row.lead }}</span>
        </UTooltip>
      </li>
    </ul>
    <footer :class="ROSTER_CLASS.footer">
      <span>descriptions from src/tool-contract.ts, as a model reads them</span>
    </footer>
  </section>
</template>

<style scoped>
.tools-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.tools-rows > li {
  display: grid;
  grid-template-columns: 13.5rem minmax(0, 1fr);
  gap: 4px 16px;
  align-items: baseline;
  padding: 9px 20px;
}
.tools-rows > li + li {
  box-shadow: inset 0 1px 0 var(--console-line);
}
.tools-rows code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ui-text-highlighted);
}
.tools-lead {
  display: block;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
@media (width < 640px) {
  .tools-rows > li {
    grid-template-columns: minmax(0, 1fr);
    padding-inline: 14px;
  }
}
</style>
