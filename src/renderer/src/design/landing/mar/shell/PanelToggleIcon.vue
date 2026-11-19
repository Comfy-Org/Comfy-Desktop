<script setup lang="ts">
/** The sidebar toggle glyph: a rounded window with its side panel, drawn
 *  as a bar at rest and filled on hover (`filled`). */
defineProps<{ filled?: boolean; size?: number }>()
</script>

<template>
  <svg
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 18 18"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <rect
      x="2.25"
      y="3.25"
      width="13.5"
      height="11.5"
      rx="3.25"
      stroke="currentColor"
      stroke-width="1.6"
    />
    <rect v-if="filled" x="5" y="6" width="3.5" height="6" rx="1.25" fill="currentColor" />
    <path
      v-else
      d="M6.25 6.25v5.5"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  </svg>
</template>
