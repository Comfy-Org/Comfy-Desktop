<script setup lang="ts">
import AppShot from '../kit/AppShot.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

/** One library page in each Page state (UI Playground › Page state). */
const { page, mode = 'create' } = defineProps<{ page: string; mode?: 'create' | 'build' }>()
const STATES = [
  { value: 'live', note: 'The mock data.' },
  { value: 'loading', note: 'Skeletons in the shape of what comes.' },
  { value: 'empty', note: 'First use, with the one action that fills it.' },
  { value: 'error', note: 'Offline, with Retry.' }
] as const
</script>

<template>
  <Section
    title="Page states"
    note="The real page in each Page state: the shell (title, tabs left, filters right) stays; only the content changes. Live frames."
  >
    <Cells :min="520">
      <AppShot
        v-for="s in STATES"
        :key="s.value"
        :label="`${s.value} · ${s.note}`"
        :page
        :mode
        :page-state="s.value"
      />
    </Cells>
  </Section>
</template>
