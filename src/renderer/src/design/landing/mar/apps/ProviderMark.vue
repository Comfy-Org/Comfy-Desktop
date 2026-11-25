<script setup lang="ts">
import type { ProviderLogo } from '../build/providerLogos'

/** A provider's mark, small and in the text color, beside a model's name. */
const { logo, size = 16 } = defineProps<{ logo: ProviderLogo; size?: number }>()
</script>

<template>
  <svg
    :viewBox="logo.viewBox"
    :width="size"
    :height="size"
    class="shrink-0"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      v-for="(p, i) in logo.paths.filter((x) => !x.cut)"
      :key="i"
      :d="p.d"
      :fill-rule="p.evenodd ? 'evenodd' : undefined"
    />
  </svg>
</template>
