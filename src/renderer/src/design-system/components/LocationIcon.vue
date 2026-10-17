<script setup lang="ts">
/** Where something runs, as an outline: a laptop for a computer, a cloud
 *  for Comfy Cloud. The one local-vs-cloud mark across the app; decorative,
 *  as the text next to it says where. */
const { kind, size = 16 } = defineProps<{ kind: 'local' | 'cloud'; size?: number }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    class="shrink-0 text-base-foreground"
    aria-hidden="true"
    fill="currentColor"
    fill-opacity="0.05"
    stroke="currentColor"
    stroke-opacity="0.6"
    stroke-width="1.4"
  >
    <path
      v-if="kind === 'cloud'"
      d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"
      stroke-linejoin="round"
    />
    <template v-else>
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M2.5 19.5h19" fill="none" stroke-linecap="round" />
    </template>
  </svg>
</template>
