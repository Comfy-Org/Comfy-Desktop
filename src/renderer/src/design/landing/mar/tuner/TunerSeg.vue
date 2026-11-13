<script setup lang="ts" generic="T extends string">
import type { Component } from 'vue'

/** UI Playground: a segmented control, for two to four short options. An
 *  option with an icon shows only the icon (its label names it). */
const { options, label, compact } = defineProps<{
  options: readonly { value: T; label: string; icon?: Component }[]
  label?: string
  compact?: boolean
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    :class="[
      'mar-seg flex rounded-control bg-secondary-background p-0.5',
      compact ? 'shrink-0 gap-0.5' : 'min-w-0 flex-1 gap-1'
    ]"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      :aria-pressed="model === o.value"
      :aria-label="o.icon ? o.label : undefined"
      :title="o.icon ? o.label : undefined"
      :class="[
        'h-7 min-w-0 truncate rounded-[7px] text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        o.icon
          ? 'inline-flex w-9 items-center justify-center'
          : ['flex-1', options.length > 3 ? 'px-1' : 'px-1.5'],
        model === o.value
          ? 'bg-secondary-background-hover font-medium text-base-foreground'
          : 'text-muted-foreground hover:text-base-foreground'
      ]"
      @click="model = o.value"
    >
      <component :is="o.icon" v-if="o.icon" :size="14" />
      <template v-else>{{ o.label }}</template>
    </button>
  </div>
</template>
