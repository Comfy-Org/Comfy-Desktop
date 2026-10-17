<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'

export type DotStatus = 'running' | 'ready' | 'busy' | 'error' | 'idle'

/** A build's state at a glance. Live states pulse: running and ready in
 *  green, busy (starting, stopping, updating) in amber. An error is red; idle
 *  is the quietest. */
const { status = 'idle', class: className } = defineProps<{
  status?: DotStatus
  class?: HTMLAttributes['class']
}>()

const TONE: Record<DotStatus, string> = {
  running: 'bg-status-running text-status-running animate-status-pulse',
  ready: 'bg-status-running text-status-running animate-status-pulse',
  busy: 'bg-status-warning text-status-warning animate-status-pulse',
  error: 'bg-status-danger',
  idle: 'bg-subtle-foreground/50'
}
</script>

<template>
  <span
    aria-hidden="true"
    :class="
      cn(
        'inline-block size-1.5 shrink-0 rounded-full motion-reduce:animate-none',
        TONE[status],
        className
      )
    "
  />
</template>
