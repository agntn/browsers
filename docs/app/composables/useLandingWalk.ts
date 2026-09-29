import { SAMPLES } from "../utils/samples";

/** One clock for every landing panel: the recorded scrape of each provider, in registry order. */
export function useLandingWalk() {
  const samples = SAMPLES;
  const tick = ref(0);
  const paused = ref(false);
  const index = computed(() => tick.value % samples.length);
  const current = computed(() => samples[index.value]!);

  let timer: number | undefined;

  /** Wraps at both ends, so the previous button on the first provider lands on the last one. */
  function step(delta: number) {
    tick.value = (tick.value + delta + samples.length) % samples.length;
  }

  function stopWalk() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function startWalk() {
    stopWalk();
    if (!import.meta.client || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    timer = window.setInterval(() => {
      if (!paused.value && !document.hidden) {
        step(1);
      }
    }, 4200);
  }

  onMounted(startWalk);
  onUnmounted(stopWalk);

  return { samples, tick, index, paused, current, step };
}
