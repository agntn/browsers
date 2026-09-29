<script setup lang="ts">
/** The landing's recorded scrape, one provider at a time, for a docs page (`::scrape-walk`). */
const { samples, paused, current, step } = useLandingWalk();
</script>

<template>
  <div class="not-prose my-6">
    <LandingRender :sample="current" :samples="samples" @step="step" @pause="paused = $event" />
  </div>
</template>
