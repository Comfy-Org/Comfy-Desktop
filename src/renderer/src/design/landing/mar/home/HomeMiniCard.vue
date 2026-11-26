<script setup lang="ts">
import WorkflowCover from '../brand/WorkflowCover.vue'

defineProps<{ title: string; line: string; src?: string }>()
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <button
    type="button"
    class="hv-mini mar-surface flex min-w-0 items-center gap-3 rounded-card p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    @click="emit('open')"
  >
    <span class="hv-mini-thumb relative size-12 shrink-0 overflow-hidden rounded-control">
      <img v-if="src" :src="src" alt="" loading="lazy" class="size-full object-cover" />
      <WorkflowCover v-else :name="title" />
    </span>
    <span class="min-w-0">
      <span class="block truncate text-ui font-medium">{{ title }}</span>
      <span class="block truncate text-ui text-subtle-foreground">{{ line }}</span>
    </span>
  </button>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .hv-mini-thumb > .wfc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
