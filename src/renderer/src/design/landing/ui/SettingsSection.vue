<script setup lang="ts">
import { cn } from './cn'

/**
 * Settings group, two columns: what it is (title + description) on the
 * left, its controls in a card on the right. Rows (SettingsRow) inside the
 * card are separated by hairlines. `tone="danger"` for irreversible actions.
 */
const {
  title,
  description,
  tone = 'default'
} = defineProps<{
  title: string
  description?: string
  tone?: 'default' | 'danger'
}>()
</script>

<template>
  <section class="grid grid-cols-[minmax(0,15rem)_minmax(0,1fr)] gap-x-12 gap-y-3 py-8 first:pt-6">
    <header class="pt-1">
      <h3 class="text-ui font-semibold">{{ title }}</h3>
      <p v-if="description" class="mt-1.5 text-ui leading-relaxed text-muted-foreground">
        {{ description }}
      </p>
    </header>
    <!-- Card 12; rows are full-bleed with their own padding. -->
    <div
      :class="
        cn(
          'max-w-xl self-start divide-y divide-border-default rounded-card border bg-card-background shadow-elev',
          tone === 'danger' ? 'border-status-danger/40' : 'border-border-default'
        )
      "
    >
      <slot />
    </div>
  </section>
</template>
