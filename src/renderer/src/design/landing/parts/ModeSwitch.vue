<script setup lang="ts">
import type { Component } from 'vue'

/**
 * Create / Build / Agent, compact: only the current mode shows its label.
 * Switching morphs in place - the old label folds away as the new one
 * unfolds (grid track 0fr ↔ 1fr), so the control stays one width-ish and
 * the highlight slides with the growing segment. Mode switches are
 * occasional, so they get a short, on-screen ease-in-out.
 */
const { options } = defineProps<{
  options: readonly { value: string; label: string; icon: Component }[]
}>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div
    role="radiogroup"
    aria-label="Mode"
    class="inline-flex h-8.5 items-center gap-0.5 rounded-control border border-border-default bg-secondary-background p-0.5"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :aria-label="o.label"
      :class="[
        'flex h-full items-center rounded-[7px] px-2 text-ui transition-colors duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        model === o.value
          ? 'bg-secondary-background-hover text-base-foreground'
          : 'text-muted-foreground hover:text-base-foreground'
      ]"
      @click="model = o.value"
    >
      <component :is="o.icon" :size="15" class="shrink-0" />
      <span
        :class="[
          'grid transition-[grid-template-columns,opacity,margin] duration-[240ms] ease-[cubic-bezier(0.645,0.045,0.355,1)] motion-reduce:transition-none',
          model === o.value
            ? 'ml-1.5 grid-cols-[1fr] opacity-100'
            : 'ml-0 grid-cols-[0fr] opacity-0'
        ]"
        aria-hidden="true"
        ><span class="min-w-0 overflow-hidden whitespace-nowrap">{{ o.label }}</span></span
      >
    </button>
  </div>
</template>
