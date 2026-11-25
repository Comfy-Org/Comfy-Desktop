<script setup lang="ts">
/**
 * The image glyph: an outlined landscape frame, wider than tall, with a
 * filled sun and hills reaching its bottom. Drawn where a lucide icon goes
 * (the Image badge, empty states), so it takes `size`.
 */
const { size = 16 } = defineProps<{ size?: number }>()
</script>

<template>
  <svg :width="size" :height="Math.round((size * 17) / 24)" viewBox="0 0 24 17" aria-hidden="true">
    <rect
      x="1"
      y="1"
      width="22"
      height="15"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
    />
    <circle cx="7" cy="5.75" r="1.75" fill="currentColor" />
    <path d="M1.8 15.2V13L8 7.5l3.25 3 4.25-4.75 6.7 7.4v2.05Z" fill="currentColor" />
  </svg>
</template>
