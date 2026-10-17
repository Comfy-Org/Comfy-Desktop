<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'

/** A placeholder for content that is still loading: give it the size and
 *  radius of what it stands in for. A highlight sweeps across it, except
 *  under reduced motion. The region that is loading carries the label
 *  (`role="status"`); each placeholder is decorative. */
const { class: className } = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div
    aria-hidden="true"
    :class="
      cn(
        'h-4 rounded-min bg-secondary-background animate-shimmer motion-reduce:animate-none',
        '[background-image:linear-gradient(90deg,transparent_30%,var(--color-secondary-background-hover)_50%,transparent_70%)] [background-size:200%_100%]',
        className
      )
    "
  />
</template>
