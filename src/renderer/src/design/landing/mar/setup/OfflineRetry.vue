<script setup lang="ts">
import { RotateCcw, WifiOff } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'

defineProps<{ message: string; waiting?: string; label: string; checking: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="mss-attach" data-edge-offline-unit>
    <p class="mss-attach-tray" role="status" data-edge-offline>
      <WifiOff :size="15" class="shrink-0" />
      <span class="truncate" :title="message">{{ message }}</span>
    </p>
    <Button
      variant="primary"
      size="lg"
      class="mss-attach-btn"
      :disabled="checking"
      data-edge-retry
      @click="$emit('retry')"
      ><RotateCcw :size="14" />{{ label }}</Button
    >
    <span v-if="waiting" class="mss-attach-meta">{{ waiting }}</span>
  </div>
</template>

<style scoped>
.mss-attach {
  --tuck: 22px;
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  row-gap: 6px;
}
.mss-attach-tray {
  display: flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 10px;
  margin: 0 calc(-1 * var(--tuck)) 0 0;
  padding: 0 calc(14px + var(--tuck)) 0 14px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  line-height: 20px;
  animation: mss-tray-out 380ms 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.mss-attach-tray > svg {
  color: var(--color-muted-foreground);
}
.mss-attach-btn {
  z-index: 1;
  box-shadow: -6px 0 12px -6px rgb(0 0 0 / 0.35);
}
.mss-attach-btn:disabled {
  opacity: 1;
}
.mss-attach-meta {
  grid-column: 1 / -1;
  padding-left: 39px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 16px;
}
@keyframes mss-tray-out {
  from {
    opacity: 0;
    transform: translateX(28px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mss-attach-tray {
    animation: none;
  }
}
</style>
