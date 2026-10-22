<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'

const { status = 'idle', class: className } = defineProps<{
  status?: 'running' | 'idle'
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span
    aria-hidden="true"
    :class="
      cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        status === 'running' ? 'bg-status-running' : 'bg-subtle-foreground',
        className
      )
    "
  />
</template>
