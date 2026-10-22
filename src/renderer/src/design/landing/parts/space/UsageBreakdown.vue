<script setup lang="ts">
import { computed } from 'vue'
import Card from '../../ui/Card.vue'
import Meter from '../../ui/Meter.vue'
import { fmt } from '../env/env'
import { spaceById } from '../../spaces'

/** Credits by tool and by person, this month. */
/** `flat`: rows only, for use inside a SettingsSection card. */
const { spaceId, flat = false } = defineProps<{ spaceId: string; flat?: boolean }>()
const space = computed(() => spaceById(spaceId)!)
const byTool = computed(() =>
  [...space.value.catalog]
    .map((c) => ({ name: c.name, credits: c.runs * c.cost }))
    .sort((a, b) => b.credits - a.credits)
)
const byPerson = computed(() =>
  [...space.value.members]
    .map((m) => ({ name: m.name, credits: m.runs * 9 }))
    .filter((m) => m.credits)
    .sort((a, b) => b.credits - a.credits)
)
const max = (l: { credits: number }[]): number => Math.max(1, ...l.map((x) => x.credits))
</script>

<template>
  <div :class="flat ? 'divide-y divide-border-default' : 'flex flex-col gap-3.5'">
    <component
      :is="flat ? 'div' : Card"
      v-for="g in [
        { title: 'By tool', rows: byTool },
        { title: 'By person', rows: byPerson }
      ]"
      :key="g.title"
      class="p-5"
    >
      <p class="mb-3 text-ui font-medium">{{ g.title }}</p>
      <div
        v-for="r in g.rows"
        :key="r.name"
        class="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-x-4 py-1.5"
      >
        <span class="truncate text-ui">{{ r.name }}</span>
        <span class="text-right text-ui text-muted-foreground tabular-nums">{{
          fmt(r.credits)
        }}</span>
        <Meter :value="r.credits" :max="max(g.rows)" class="col-span-2 mt-1.5" />
      </div>
      <p v-if="!g.rows.length" class="text-ui text-subtle-foreground">No usage yet.</p>
    </component>
  </div>
</template>
