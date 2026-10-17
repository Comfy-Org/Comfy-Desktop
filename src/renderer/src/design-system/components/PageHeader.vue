<script setup lang="ts">
const { title, description } = defineProps<{ title: string; description?: string }>()
</script>

<template>
  <header class="flex items-end justify-between gap-6 pt-12 pb-8">
    <div class="min-w-0">
      <h1 class="text-title font-semibold tracking-[-0.01em]">{{ title }}</h1>
      <p v-if="description" class="mt-1 text-ui text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
