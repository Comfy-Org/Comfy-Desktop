<script setup lang="ts">
/**
 * Inspiration's mark: three sharp four-point stars of different sizes,
 * drawn straight-edged (not the soft AI sparkle). Takes `size` like a
 * lucide icon.
 */
const { size = 16 } = defineProps<{ size?: number }>()
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      d="M9.00 7.00 L11.25 12.25 L16.50 14.50 L11.25 16.75 L9.00 22.00 L6.75 16.75 L1.50 14.50 L6.75 12.25 Z"
    />
    <path
      d="M18.50 2.00 L19.70 4.80 L22.50 6.00 L19.70 7.20 L18.50 10.00 L17.30 7.20 L14.50 6.00 L17.30 4.80 Z"
    />
    <path
      d="M19.00 14.30 L19.66 15.84 L21.20 16.50 L19.66 17.16 L19.00 18.70 L18.34 17.16 L16.80 16.50 L18.34 15.84 Z"
    />
  </svg>
</template>
