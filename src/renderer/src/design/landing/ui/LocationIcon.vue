<script setup lang="ts">
/** Where something runs, as an outline: a laptop for this computer, a cloud
 *  for Comfy Cloud. The one local-vs-cloud mark across the app. */
const { kind, size = 16 } = defineProps<{ kind: 'local' | 'cloud'; size?: number }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    class="shrink-0 text-base-foreground"
    role="img"
    :aria-label="kind === 'cloud' ? 'Cloud' : 'This computer'"
  >
    <path
      v-if="kind === 'cloud'"
      d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"
      fill="rgb(255 255 255 / 0.05)"
      stroke="currentColor"
      stroke-opacity="0.6"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <template v-else>
      <rect
        x="4"
        y="5"
        width="16"
        height="11"
        rx="2"
        fill="rgb(255 255 255 / 0.05)"
        stroke="currentColor"
        stroke-opacity="0.6"
        stroke-width="1.4"
      />
      <path
        d="M2.5 19.5h19"
        stroke="currentColor"
        stroke-opacity="0.6"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </template>
  </svg>
</template>
