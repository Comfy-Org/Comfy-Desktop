<script setup lang="ts">
import { computed } from 'vue'
import type { Area, Usage } from '../inspect/usage'

/** Files grouped by area (Kit / Parts / Pages / Other) with counts. */
const { usage, noun = 'places' } = defineProps<{ usage: Usage; noun?: string }>()
const AREAS: Area[] = ['Kit', 'Parts', 'Pages', 'Other']
const byArea = computed(() =>
  AREAS.map((a) => ({ area: a, files: usage.files.filter((f) => f.area === a) })).filter(
    (g) => g.files.length
  )
)
const fileName = (p: string): string =>
  p
    .split('/')
    .pop()!
    .replace(/\.(vue|ts|css)$/, '')
</script>

<template>
  <div>
    <div class="mb-2 flex items-baseline justify-between">
      <h4 class="text-ui font-semibold">Used in</h4>
      <span class="text-ui text-subtle-foreground"
        >{{ usage.files.length }} files · {{ usage.total }} {{ noun }}</span
      >
    </div>
    <p v-if="!usage.files.length" class="text-ui text-subtle-foreground">Not used anywhere yet.</p>
    <div v-for="g in byArea" :key="g.area" class="mb-3">
      <p class="mb-1 text-ui font-medium tracking-wider text-subtle-foreground uppercase">
        {{ g.area }} · {{ g.files.length }}
      </p>
      <div
        v-for="f in g.files"
        :key="f.path"
        class="flex items-center gap-2 rounded-control px-2 py-1 hover:bg-secondary-background"
        :title="f.utilities.join('  ') || f.path"
      >
        <span class="min-w-0 flex-1 truncate text-ui">{{ fileName(f.path) }}</span>
        <span class="truncate font-mono text-ui text-subtle-foreground">{{
          f.path.split('/').slice(0, -1).join('/') || '.'
        }}</span>
        <span class="w-6 text-right text-ui text-muted-foreground tabular-nums">{{ f.count }}</span>
      </div>
    </div>
  </div>
</template>
