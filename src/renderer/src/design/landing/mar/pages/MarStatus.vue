<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowUpCircle,
  CircleCheck,
  Clock,
  Loader2,
  LoaderCircle,
  OctagonAlert,
  Users
} from 'lucide-vue-next'
import MarSpin from '../brand/MarSpin.vue'

/**
 * One item's state, as a small pill (Mar's pages). Running and Live
 * breathe; Failed is the only red; Draft and Paused stay quiet.
 * A workflow's last run uses production's three (ComfyUI_frontend
 * WorkflowTab): executing spins, completed checks, failed is an octagon
 * alert (used for every Failed); no percentage, that lives in the queue.
 */
export type ItemStatus =
  | 'executing'
  | 'completed'
  | 'running'
  | 'queued'
  | 'failed'
  | 'draft'
  | 'shared'
  | 'live'
  | 'paused'
  | 'stopped'
  | 'launching'
  | 'update'
  | 'changes'

const { status, label, onMedia } = defineProps<{
  status: ItemStatus
  /** Overrides the default word, e.g. "Queued · 2nd". */
  label?: string
  /** Sits on a picture: dark glass instead of a tint. */
  onMedia?: boolean
}>()

const WORDS: Record<ItemStatus, string> = {
  executing: 'Running',
  completed: 'Completed',
  running: 'Running',
  queued: 'Queued',
  failed: 'Failed',
  draft: 'Draft',
  shared: 'Shared',
  live: 'Live',
  paused: 'Paused',
  stopped: 'Stopped',
  launching: 'Starting',
  update: 'Update',
  changes: 'Unpublished changes'
}
const tone = computed(() =>
  status === 'running' || status === 'live' || status === 'executing'
    ? 'is-go'
    : status === 'failed'
      ? 'is-bad'
      : status === 'update' || status === 'changes'
        ? 'is-warn'
        : 'is-quiet'
)
</script>

<template>
  <span class="mar-status" :class="[tone, onMedia && 'on-media']">
    <MarSpin
      v-if="status === 'executing'"
      :icon="LoaderCircle"
      :size="11"
      spin="motion-safe:animate-spin"
    />
    <CircleCheck v-else-if="status === 'completed'" :size="11" />
    <OctagonAlert v-else-if="status === 'failed'" :size="11" />
    <MarSpin v-else-if="status === 'launching'" :icon="Loader2" :size="11" spin="animate-spin" />
    <Clock v-else-if="status === 'queued'" :size="11" />
    <Users v-else-if="status === 'shared'" :size="11" />
    <ArrowUpCircle v-else-if="status === 'update'" :size="11" />
    <i v-else-if="status === 'draft'" class="mar-status-dot is-hollow" />
    <i v-else class="mar-status-dot" />
    {{ label ?? WORDS[status] }}
  </span>
</template>

<style scoped>
.mar-status {
  display: inline-flex;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
}
.mar-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
.is-go {
  background: color-mix(in oklch, var(--color-status-running) 14%, transparent);
  color: var(--color-status-running);
}
.is-go .mar-status-dot {
  animation: mar-breathe 1.6s ease-in-out infinite;
}
.is-bad {
  background: color-mix(in oklch, var(--color-status-danger) 16%, transparent);
  color: var(--color-status-danger);
}
.is-warn {
  background: color-mix(in oklch, oklch(0.8 0.14 75) 15%, transparent);
  color: oklch(0.8 0.14 75);
}
.on-media {
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
}
.on-media.is-quiet {
  color: rgb(255 255 255 / 0.88);
}
/* On a picture the tint is lost: the words go light, the colour stays
   in the dot or icon. */
.on-media.is-bad {
  color: oklch(0.86 0.08 25);
}
.on-media.is-go {
  color: oklch(0.9 0.1 155);
}
.on-media.is-warn {
  color: oklch(0.9 0.1 80);
}
@keyframes mar-breathe {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-go .mar-status-dot {
    animation: none;
  }
}
/* Draft / Unsaved: production marks unsaved work with a dot; hollow here
   so it reads as "not saved yet" rather than a live state. */
.mar-status-dot.is-hollow {
  background: transparent !important;
  box-shadow: inset 0 0 0 1.5px currentColor;
  animation: none !important;
}
</style>
