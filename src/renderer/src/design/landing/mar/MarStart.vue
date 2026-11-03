<script setup lang="ts">
import { computed } from 'vue'
import { firstRun } from './firstRun'
import MarStartOriginal from './MarStartOriginal.vue'
import MarStartReel from './MarStartReel.vue'
import MarStartChecklist from './start/MarStartChecklist.vue'
import MarStartCinematic from './start/MarStartCinematic.vue'
import MarStartPaths from './start/MarStartPaths.vue'

/** First run in Mar's proposal: the Home a brand-new user gets, before any
 *  local install. The version comes from UI Playground › First run. */
const VIEWS = {
  original: MarStartOriginal,
  reel: MarStartReel,
  paths: MarStartPaths,
  cinematic: MarStartCinematic,
  checklist: MarStartChecklist
}
const view = computed(() => VIEWS[firstRun.id])
</script>

<template>
  <component :is="view" />
</template>
