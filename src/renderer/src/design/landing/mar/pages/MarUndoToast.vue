<script setup lang="ts">
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-vue-next'
import { dismiss, runUndo, undoToast } from './undo'

/** Mar's one toast, top right: what just happened, in its tone, and Undo. */
const ICONS = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleX }
</script>

<template>
  <Transition name="mar-undo">
    <div
      v-if="undoToast.message"
      :key="undoToast.key"
      class="mar-undo"
      :class="`is-${undoToast.tone}`"
      :role="undoToast.tone === 'error' ? 'alert' : 'status'"
    >
      <component :is="ICONS[undoToast.tone]" :size="16" class="mar-undo-icon" />
      <span class="mar-undo-text">{{ undoToast.message }}</span>
      <button v-if="undoToast.undo" type="button" class="mar-undo-btn" @click="runUndo">
        Undo
      </button>
      <button type="button" class="mar-undo-x" aria-label="Dismiss" @click="dismiss">
        <X :size="13" />
      </button>
    </div>
  </Transition>
</template>

<style>
/* Comfy's palette (ds/theme/model.ts): azure-600, jade-600, gold-600,
   coral-500. */
.mar-undo.is-info {
  --tone: #0b8ce9;
}
.mar-undo.is-success {
  --tone: #00cd72;
}
.mar-undo.is-warning {
  --tone: #fd9903;
}
.mar-undo.is-error {
  --tone: #f75951;
}
/* Just under the title bar, in the air above the page's own actions. */
:root .proto-ui.proto-ui.proto-ui .mar-undo {
  position: fixed;
  top: 56px;
  right: 20px;
  z-index: 80;
  display: flex;
  max-width: min(420px, calc(100vw - 40px));
  min-height: 40px;
  align-items: center;
  gap: 10px;
  padding: 6px 6px 6px 12px;
  border-radius: 12px;
  background: color-mix(
    in oklab,
    var(--tone) 20%,
    color-mix(in oklab, var(--color-card-background) 70%, transparent)
  );
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  box-shadow: 0 16px 40px -12px rgb(0 0 0 / 0.5);
  backdrop-filter: blur(24px) saturate(1.7);
  pointer-events: auto;
}
/* Standing still in the design system's page, not over it. */
:root .proto-ui.proto-ui.proto-ui .mar-undo.is-still {
  position: static;
  width: fit-content;
  padding-right: 12px;
}
.mar-undo-icon {
  flex: none;
  color: color-mix(in oklab, var(--tone) 82%, var(--color-base-foreground));
}
.mar-undo-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
:root .proto-ui.proto-ui.proto-ui .mar-undo-btn {
  flex: none;
  width: auto;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  background: color-mix(in oklab, var(--color-base-foreground) 14%, transparent);
  color: var(--color-base-foreground);
  font-weight: 600;
  transition: background-color 140ms ease;
}
/* Undo and the close read as one pair at the end of the toast. */
:root .proto-ui.proto-ui.proto-ui .mar-undo-btn + .mar-undo-x {
  margin-left: -6px;
}
:root .proto-ui.proto-ui.proto-ui .mar-undo-btn:hover {
  background: color-mix(in oklab, var(--color-base-foreground) 22%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-undo-x:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-undo-x {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  color: var(--color-muted-foreground);
}
.mar-undo-enter-active,
.mar-undo-leave-active {
  transition:
    opacity 200ms ease,
    transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-undo-enter-from,
.mar-undo-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
@media (prefers-reduced-motion: reduce) {
  .mar-undo-enter-from,
  .mar-undo-leave-to {
    transform: none;
  }
}
</style>
