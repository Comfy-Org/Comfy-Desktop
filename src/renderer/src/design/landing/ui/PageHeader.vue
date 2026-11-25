<script setup lang="ts">
const { title } = defineProps<{ title: string }>()
</script>

<template>
  <header class="flex items-end justify-between gap-6 pt-12 pb-8">
    <div class="min-w-0">
      <div class="flex items-center gap-3">
        <h1 class="text-title font-semibold tracking-[-0.01em]">{{ title }}</h1>
        <slot name="meta" />
      </div>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
