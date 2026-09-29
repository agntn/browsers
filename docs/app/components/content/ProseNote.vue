<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <BrowsersCallout kind="note" :title="title"><slot mdc-unwrap="p" /></BrowsersCallout>
</template>
