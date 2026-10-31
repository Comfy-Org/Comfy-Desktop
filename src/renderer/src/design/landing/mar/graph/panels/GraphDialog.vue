<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { X } from 'lucide-vue-next'

/**
 * A dialog over the graph, as ComfyUI's BaseModalLayout: a left panel with
 * its icon, title and nav; a header (search, actions); the content; and,
 * when given, an info panel on the right. Escape or the scrim closes it.
 */
defineProps<{ title: string; size?: 'md' | 'lg' }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="rp-scrim" @pointerdown.self="emit('close')" @wheel.stop>
    <section class="rp-dialog" :class="`is-${size ?? 'lg'}`" role="dialog" :aria-label="title">
      <nav class="rp-dialog-nav">
        <p class="rp-dialog-brand"><slot name="icon" />{{ title }}</p>
        <slot name="nav" />
      </nav>
      <div class="rp-dialog-main">
        <header class="rp-dialog-head">
          <slot name="header" />
          <button type="button" class="rp-icon" aria-label="Close" @click="emit('close')">
            <X :size="16" />
          </button>
        </header>
        <div class="rp-dialog-body"><slot /></div>
        <slot name="footer" />
      </div>
      <aside v-if="$slots.info" class="rp-dialog-info"><slot name="info" /></aside>
    </section>
  </div>
</template>

<style>
.rp-scrim {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--mg-top) + 24px) 32px 24px;
  background: rgb(0 0 0 / 0.42);
  animation: rp-fade 0.14s ease-out;
}
:root[data-ds-theme='light'] .rp-scrim {
  background: rgb(0 0 0 / 0.18);
}
@keyframes rp-fade {
  from {
    opacity: 0;
  }
}
.rp-dialog {
  display: flex;
  width: min(1240px, 100%);
  height: min(800px, 100%);
  overflow: hidden;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-card-background) 97%, transparent);
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow:
    inset 0 0 0 1px var(--rp-ring),
    0 1px 2px rgb(0 0 0 / 0.2),
    0 28px 64px -20px rgb(0 0 0 / 0.6);
  color: var(--rp-text);
  font-size: 13px;
}
.rp-dialog.is-md {
  width: min(960px, 100%);
  height: min(680px, 100%);
}
.rp-dialog-nav {
  display: flex;
  width: 232px;
  flex: none;
  flex-direction: column;
  gap: 1px;
  overflow: auto;
  padding: 16px 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
  box-shadow: inset -1px 0 0 var(--rp-line);
}
.rp-dialog-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  padding: 4px 8px;
  font-size: 14px;
  font-weight: 600;
}
.rp-dialog-group {
  margin: 14px 0 4px;
  padding: 0 8px;
  color: var(--rp-label);
  font-size: 12px;
  font-weight: 600;
}
.rp-dialog-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.rp-dialog-head {
  display: flex;
  min-height: 60px;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 12px 24px;
}
:root .proto-ui.proto-ui.proto-ui .rp-dialog-head .mar-pfind {
  max-width: 420px;
  height: 36px;
}
.rp-dialog-head > .rp-icon:last-child {
  margin-left: auto;
}
.rp-dialog-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0 24px 24px;
}
.rp-dialog-info {
  display: flex;
  width: 280px;
  flex: none;
  flex-direction: column;
  padding: 20px;
  box-shadow: inset 1px 0 0 var(--rp-line);
}
.rp-dialog-foot {
  flex: none;
  padding: 10px 24px;
  color: var(--rp-meta);
  font-size: 12px;
  box-shadow: inset 0 1px 0 var(--rp-line);
}
.rp-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 0 0 16px;
}
.rp-filters .rp-spacer {
  flex: 1;
}
:root .proto-ui.proto-ui.proto-ui .rp-btn.is-inverted {
  background: var(--mg-run);
  color: var(--mg-run-text);
}
.rp-title-lg {
  margin: 0 0 14px;
  font-size: 18px;
  font-weight: 600;
}
:root[data-ds-theme='light'] .rp-dialog {
  box-shadow:
    inset 0 0 0 1px var(--rp-ring),
    0 1px 2px rgb(0 0 0 / 0.06),
    0 28px 64px -20px rgb(0 0 0 / 0.28);
}
.mg.is-current .rp-dialog {
  background: var(--mg-chrome);
  backdrop-filter: none;
}
@media (prefers-reduced-motion: reduce) {
  .rp-scrim {
    animation: none;
  }
}
</style>
