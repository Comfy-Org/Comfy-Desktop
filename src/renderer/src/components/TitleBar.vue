<script setup lang="ts">
import { computed } from 'vue'

defineProps<{
  title?: string
}>()

const isMac = computed(() => navigator.userAgent.toLowerCase().includes('mac'))
</script>

<template>
  <header
    class="titlebar relative z-[1000] box-border flex h-[var(--titlebar-height,37px)] shrink-0 items-center border-b border-solid border-[var(--border)] bg-surface"
    :class="{ 'titlebar--mac': isMac }"
  >
    <div
      class="titlebar-drag-region flex h-full min-w-0 flex-1 items-center pr-[140px] pl-3 [app-region:drag] [.titlebar--mac_&]:pr-3 [.titlebar--mac_&]:pl-[78px]"
    >
      <span
        v-if="title"
        class="titlebar-title min-w-0 truncate text-[12px] text-text-muted select-none"
        >{{ title }}</span
      >
    </div>
  </header>
</template>
