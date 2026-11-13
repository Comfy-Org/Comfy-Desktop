<script setup lang="ts">
import Switch from '../ui/Switch.vue'
import { ports } from './navOptions'
import { shownPorts } from './tunerContext'

/** UI Playground › Nav options: one switch per navigation variation. All
 *  Off by default. A switch only
 *  shows while flipping it changes what's on screen: they act on the
 *  Floating sidebar and the Tabs bar, each in its own situation
 *  (tunerContext.ts). The situation is the screen you're on, so the row
 *  says only what the switch does; the full label is its tooltip. */
const what = (label: string): string => {
  const rest = label.split(': ')[1] ?? label
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}
</script>

<template>
  <div v-if="shownPorts.length" class="flex flex-col gap-2">
    <span class="text-ui text-subtle-foreground">Nav options</span>
    <div
      v-for="p in shownPorts"
      :key="p.key"
      class="flex items-center justify-between gap-3"
      :title="p.label"
    >
      <span class="min-w-0 truncate text-ui text-base-foreground">{{ what(p.label) }}</span>
      <Switch v-model="ports[p.key]" :aria-label="p.label" />
    </div>
  </div>
</template>
