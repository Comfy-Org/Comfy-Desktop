<script setup lang="ts">
import { ref, watch } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import { readPlayback, setPlayback } from '../kit/playback'

/** Above the Motion frames: one speed and one reduced-motion switch for
 *  every frame (kit/playback.ts), and Replay all. */
const start = readPlayback()
const speed = ref(start.speed)
const reduced = ref(start.reduced)
watch(speed, (s) => setPlayback({ speed: s }))
watch(reduced, (r) => setPlayback({ reduced: r }))
const replay = (): void => setPlayback({ replay: Date.now() })
</script>

<template>
  <div class="ds-motion-bar">
    <label>
      Speed
      <input v-model.number="speed" type="range" min="0.25" max="1" step="0.25" />
      <output>{{ speed }}×</output>
    </label>
    <label><input v-model="reduced" type="checkbox" /> Reduced motion</label>
    <button type="button" @click="replay"><RotateCcw :size="13" />Replay all</button>
  </div>
</template>

<style>
.ds-motion-bar {
  position: sticky;
  /* Flush with the page's top edge, past its padding. */
  top: calc(-1 * var(--ds-pad-top));
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 0 0 14px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--color-app-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-muted-foreground);
  font-size: 12.5px;
}
.ds-motion-bar label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ds-motion-bar output {
  width: 36px;
  font-variant-numeric: tabular-nums;
}
.ds-motion-bar button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 8px;
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
</style>
