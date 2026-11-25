<script setup lang="ts">
import type { AppAction } from '../appActions'
import AppShot from '../kit/AppShot.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

/** Whole-app frames: a flow, a modal or a knob, each in its own frame. */
export interface Shot {
  label: string
  page?: string
  mode?: 'create' | 'build'
  run?: AppAction
  seed?: Record<string, unknown>
  crop?: [number, number, number, number]
}
defineProps<{ title: string; note?: string; shots: Shot[] }>()
</script>

<template>
  <Section :title :note>
    <Cells :min="520">
      <AppShot v-for="s in shots" :key="s.label" v-bind="s" />
    </Cells>
  </Section>
</template>
