<script setup lang="ts">
// Shared grand title + subtitle for the Tier 3 takeover modals.
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <div class="takeover-header flex min-w-0 flex-auto flex-col gap-1">
    <div
      class="takeover-grand-title text-[20px] leading-[1.2] font-semibold text-text [word-break:break-word]"
    >
      {{ title }}
    </div>
    <div
      v-if="subtitle"
      class="takeover-grand-subtitle text-[13px] leading-[1.4] text-text-muted [word-break:break-word]"
    >
      {{ subtitle }}
    </div>
  </div>
</template>
