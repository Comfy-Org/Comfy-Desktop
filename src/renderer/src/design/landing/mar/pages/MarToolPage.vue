<script setup lang="ts">
import MarBenchmarksPage from '../tools/MarBenchmarksPage.vue'
import MarPerfTestPage from '../tools/MarPerfTestPage.vue'

/** Tools (the sidebar's group before Home): Benchmarks and Performance
 *  Tests, with what Desktop's pages do, in Mar's pages' look. */
const { id } = defineProps<{ id: string }>()
</script>

<template>
  <MarPerfTestPage v-if="id === 'performance'" />
  <MarBenchmarksPage v-else />
</template>
