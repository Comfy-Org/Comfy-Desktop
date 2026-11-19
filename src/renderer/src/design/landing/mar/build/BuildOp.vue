<script setup lang="ts">
import { Check, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { cancelOp, dismissOp, retryOp, type BuildOp } from './buildOps'

/** A build's long operation, in place of the tab's content (buildOps.ts). */
const { op, id, name } = defineProps<{ op: BuildOp; id: string; name: string }>()
</script>

<template>
  <div class="mar-op" role="status" aria-live="polite">
    <template v-if="op.status === 'running'">
      <p class="mar-op-title">{{ op.title }}</p>
      <p class="mar-op-sub">{{ name }}</p>
      <div class="mar-op-bar-head">
        <span>{{ op.step }}</span
        ><span class="tabular-nums">{{ op.pct }}%</span>
      </div>
      <div class="mar-op-bar"><i :style="{ width: `${op.pct}%` }" /></div>
      <Button v-if="op.cancellable" class="mt-5" @click="cancelOp(id)">Cancel</Button>
    </template>
    <template v-else-if="op.status === 'done'">
      <span class="mar-op-icon is-ok"><Check :size="18" /></span>
      <p class="mar-op-title">{{ op.done }}</p>
      <p class="mar-op-sub">{{ name }} · back to the tab in a moment</p>
    </template>
    <template v-else-if="op.status === 'failed'">
      <span class="mar-op-icon is-bad"><X :size="18" /></span>
      <p class="mar-op-title">Something went wrong</p>
      <p class="mar-op-sub">{{ op.error }}</p>
      <div class="mt-5 flex gap-2">
        <Button variant="primary" @click="retryOp(id)">Try Again</Button>
        <Button @click="dismissOp(id)">Dismiss</Button>
      </div>
    </template>
    <template v-else>
      <p class="mar-op-title">Cancelled</p>
      <p class="mar-op-sub">{{ name }} is as it was.</p>
      <Button class="mt-5" @click="dismissOp(id)">Dismiss</Button>
    </template>
  </div>
</template>

<style>
.mar-op {
  display: flex;
  max-width: 440px;
  flex-direction: column;
  align-items: flex-start;
  margin: 24px 0;
  padding: 24px;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  animation: mar-op-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes mar-op-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-op {
    animation: none;
  }
}
.mar-op-title {
  margin: 0;
  color: var(--color-base-foreground);
  font-size: 14px;
  font-weight: 600;
}
.mar-op-sub {
  margin: 2px 0 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mar-op-bar-head {
  display: flex;
  width: 100%;
  justify-content: space-between;
  margin: 18px 0 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.mar-op-bar {
  position: relative;
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
.mar-op-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--color-base-foreground);
  transition: width 160ms linear;
}
.mar-op-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  border-radius: 999px;
}
.mar-op-icon.is-ok {
  background: color-mix(in oklch, var(--color-status-running) 16%, transparent);
  color: var(--color-status-running);
}
.mar-op-icon.is-bad {
  background: color-mix(in oklch, var(--color-status-danger) 16%, transparent);
  color: var(--color-status-danger);
}
</style>
