<script setup lang="ts">
/**
 * Inspiration's mark: three filled four-point stars, thin straight rays
 * (not the soft AI sparkle), one large and two small. Takes `size` like
 * a lucide icon.
 */
const { size = 16 } = defineProps<{ size?: number }>()
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      d="M9.50 5.50 L11.20 12.30 L18.00 14.00 L11.20 15.70 L9.50 22.50 L7.80 15.70 L1.00 14.00 L7.80 12.30 Z"
    />
    <path
      d="M19.00 1.00 L19.90 4.60 L23.50 5.50 L19.90 6.40 L19.00 10.00 L18.10 6.40 L14.50 5.50 L18.10 4.60 Z"
    />
    <path
      d="M19.50 14.90 L20.02 16.98 L22.10 17.50 L20.02 18.02 L19.50 20.10 L18.98 18.02 L16.90 17.50 L18.98 16.98 Z"
    />
  </svg>
</template>
