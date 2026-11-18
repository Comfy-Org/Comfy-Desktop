<script setup lang="ts">
import Tooltip from './ui/Tooltip.vue'

defineProps<{
  tooltip?: string
}>()

const tagClass =
  'storage-tag inline-flex h-5 shrink-0 items-center gap-0.5 rounded-[999px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-2 text-[11px] leading-[14px] font-medium text-text-muted'
</script>

<template>
  <Tooltip
    v-if="tooltip"
    :text="tooltip"
    keep-open-on-click
    :class="[
      tagClass,
      'has-tooltip cursor-help transition-[color] duration-150 ease-[ease] hover:text-text focus-visible:text-text focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:[outline-style:auto]'
    ]"
    tabindex="0"
  >
    <slot />
  </Tooltip>
  <span v-else :class="tagClass">
    <slot />
  </span>
</template>
