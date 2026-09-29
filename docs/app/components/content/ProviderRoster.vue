<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { OPERATIONS, PROVIDERS, supportedCount, type ProviderEntry } from "../../utils/providers";
import { RECORDED_ON, SAMPLES } from "../../utils/samples";
import { ROSTER_CLASS, ROSTER_TABLE_UI } from "../../utils/roster";

interface Row {
  readonly entry: ProviderEntry;
  readonly key: string;
  readonly name: string;
  readonly scrape: string;
  readonly needs: string;
  /** Operations it supports, for sorting. */
  readonly operations: number;
  /** Characters the recorded scrape came back with; a refusal sorts as zero. */
  readonly chars: number;
  readonly recorded: string;
  readonly timing: string;
}

const scrapeOperation = OPERATIONS.find((operation) => operation.key === "scrape")!;
const SCRAPE_LABEL = { direct: "one call", session: "in a session", no: "no scrape" } as const;

/** Every value comes from `capabilities()` or the recorded scrape; the registry order is the default. */
const rows: Row[] = PROVIDERS.map((entry) => {
  const sample = SAMPLES.find((row) => row.provider.key === entry.key)!;
  const refused = sample.form === "refused";
  return {
    entry,
    key: entry.key,
    name: entry.name,
    scrape: SCRAPE_LABEL[scrapeOperation.support(entry.capabilities)],
    needs: entry.keyless ? "no key" : entry.env,
    operations: supportedCount(entry),
    chars: refused ? 0 : sample.length,
    recorded: refused ? "refused, no page" : `${sample.length.toLocaleString("en-US")} chars of ${sample.form}`,
    timing: `${sample.ms.toLocaleString("en-US")} ms for the whole call`,
  };
});

const sorting = ref<{ id: string; desc: boolean }[]>([]);

const roster = useTemplateRef<HTMLElement>("roster");
useRosterFlip(
  () => roster.value,
  () => sorting.value,
);

const columns: TableColumn<Row>[] = [
  { accessorKey: "name", header: "Provider", sortingFn: "text", meta: { class: { th: "w-[15rem]" } } },
  {
    accessorKey: "scrape",
    header: "Scrape",
    sortingFn: "text",
    meta: { class: { th: "w-[7.5rem]", td: "@max-[52rem]/roster:justify-self-end" } },
  },
  {
    accessorKey: "operations",
    header: "Ops",
    sortingFn: "basic",
    meta: { class: { th: "w-[4.5rem]" } },
  },
  { accessorKey: "needs", header: "Needs", enableSorting: false, meta: { class: { td: "min-w-0" } } },
  {
    accessorKey: "chars",
    header: "Recorded scrape",
    sortingFn: "basic",
    meta: { class: { th: "w-[13rem]" } },
  },
];

const order = computed(() => {
  const [first] = sorting.value;
  if (first === undefined) return "registry order";
  const label = columns.find((column) => "accessorKey" in column && column.accessorKey === first.id)?.header;
  return `by ${String(label).toLowerCase()} ${first.desc ? "descending" : "ascending"}`;
});
</script>

<template>
  <section ref="roster" class="roster not-prose my-6" aria-label="Providers">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header :class="ROSTER_CLASS.bar">
      <span :class="ROSTER_CLASS.title">providers()</span>
      <span :class="ROSTER_CLASS.meta">{{ rows.length }} providers · {{ order }}</span>
    </header>
    <div class="roster-ruler" aria-hidden="true" />
    <UTable
      v-model:sorting="sorting"
      :data="rows"
      :columns="columns"
      :get-row-id="(row) => row.key"
      :ui="ROSTER_TABLE_UI"
    >
      <template #name-header="{ column }"><RosterSort :column="column" label="Provider" /></template>
      <template #scrape-header="{ column }"><RosterSort :column="column" label="Scrape" /></template>
      <template #operations-header="{ column }"><RosterSort :column="column" label="Ops" /></template>
      <template #chars-header="{ column }"><RosterSort :column="column" label="Recorded scrape" /></template>
      <template #name-cell="{ row }">
        <NuxtLink :to="row.original.entry.to" :class="[ROSTER_CLASS.name, 'max-w-full items-baseline']">
          <UIcon :name="row.original.entry.icon" class="relative top-0.5 size-3.5 flex-none" aria-hidden="true" />
          <span class="truncate">{{ row.original.name }}</span>
          <span :class="[ROSTER_CLASS.id, 'flex-none']">{{ row.original.key }}</span>
        </NuxtLink>
      </template>
      <template #scrape-cell="{ row }">
        <span
          class="whitespace-nowrap"
          :class="row.original.scrape === 'no scrape' ? 'text-dimmed' : 'text-highlighted'"
          >{{ row.original.scrape }}</span
        >
      </template>
      <template #operations-cell="{ row }">
        <span class="whitespace-nowrap text-highlighted"
          >{{ row.original.operations }}<span class="text-dimmed"> / {{ OPERATIONS.length }}</span></span
        >
      </template>
      <template #needs-cell="{ row }">
        <span :class="row.original.entry.keyless ? 'text-dimmed' : 'text-muted'">{{ row.original.needs }}</span>
      </template>
      <template #chars-cell="{ row }">
        <span :class="ROSTER_CLASS.count"
          ><span :class="ROSTER_CLASS.leader" aria-hidden="true" /><UTooltip :text="row.original.timing"
            ><span
              class="min-w-0 truncate"
              :class="row.original.chars === 0 ? 'text-dimmed' : 'text-highlighted'"
              tabindex="0"
              >{{ row.original.recorded }}</span
            ></UTooltip
          ></span
        >
      </template>
    </UTable>
    <footer :class="ROSTER_CLASS.footer">
      <span>flags from the library / scrape of example.com recorded {{ RECORDED_ON }}</span>
      <span :class="ROSTER_CLASS.meta">ops counts a session-only one</span>
    </footer>
  </section>
</template>
