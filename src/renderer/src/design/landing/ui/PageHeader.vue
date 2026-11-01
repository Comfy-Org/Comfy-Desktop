<script setup lang="ts">
import { isMariana } from '../mar/proposal'

const { title, description } = defineProps<{ title: string; description?: string }>()
</script>

<template>
  <header class="flex items-end justify-between gap-6 pt-12 pb-8">
    <div class="min-w-0">
      <div class="flex items-center gap-3">
        <h1 class="text-title font-semibold tracking-[-0.01em]">{{ title }}</h1>
        <slot name="meta" />
      </div>
      <!-- New UI: no subtitles, so the title and tabs sit in one place. -->
      <p v-if="description && !isMariana" class="mt-1 text-ui text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
