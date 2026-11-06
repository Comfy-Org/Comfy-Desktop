<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { MenuAction } from './menu'
import MarItemMenu from './MarItemMenu.vue'

/** What you can do to everything selected (Mar's pages): a dark bar at
 *  the foot with the count, the common actions, and Esc to let go. */
const {
  n,
  noun,
  actions,
  more = []
} = defineProps<{
  n: number
  noun: string
  actions: MenuAction[]
  more?: MenuAction[]
}>()
const emit = defineEmits<{ clear: []; all: [] }>()
</script>

<template>
  <Transition name="mar-selbar">
    <div
      v-if="n > 0"
      class="mar-selbar"
      role="toolbar"
      :aria-label="`${n} selected`"
      @keydown.esc="emit('clear')"
    >
      <button
        type="button"
        class="mar-selbar-x"
        aria-label="Clear selection"
        @click="emit('clear')"
      >
        <X :size="14" />
      </button>
      <span class="mar-selbar-n">{{ n }} {{ noun }}{{ n === 1 ? '' : 's' }} selected</span>
      <button type="button" class="mar-selbar-btn is-quiet" @click="emit('all')">Select all</button>
      <span class="mar-selbar-sep" />
      <template v-for="a in actions" :key="a.label">
        <MarItemMenu v-if="a.sub" :lines="a.sub" side="top">
          <template #trigger>
            <button type="button" class="mar-selbar-btn">
              <component :is="a.icon" v-if="a.icon" :size="14" />{{ a.label }}
            </button>
          </template>
        </MarItemMenu>
        <button
          v-else
          type="button"
          class="mar-selbar-btn"
          :class="a.danger && 'is-danger'"
          @click="a.run?.()"
        >
          <component :is="a.icon" v-if="a.icon" :size="14" />{{ a.label }}
        </button>
      </template>
      <MarItemMenu v-if="more.length" :lines="more" side="top" />
    </div>
  </Transition>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-selbar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  z-index: 55;
  display: flex;
  height: 44px;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: 14px;
  background: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 8%, var(--color-card-background)) 88%,
    transparent
  );
  backdrop-filter: blur(30px) saturate(1.3);
  box-shadow:
    0 20px 50px -16px rgb(0 0 0 / 0.6),
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 13px;
  transform: translateX(-50%);
}
.mar-selbar-n {
  padding: 0 8px 0 2px;
  font-weight: 500;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.mar-selbar-sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .mar-selbar-btn,
:root .proto-ui.proto-ui.proto-ui .mar-selbar-x {
  display: inline-flex;
  width: auto;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--color-base-foreground);
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mar-selbar-x {
  width: 32px;
  justify-content: center;
  padding: 0;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-selbar-btn.is-quiet {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-selbar-btn.is-danger {
  color: var(--color-status-danger);
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-selbar-btn, .mar-selbar-x):hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-selbar-enter-active,
.mar-selbar-leave-active {
  transition:
    opacity 180ms ease,
    transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-selbar-enter-from,
.mar-selbar-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
</style>
