<script setup lang="ts">
/**
 * PROTOTYPE (throwaway branch) — floating HUD for flipping between the three
 * chooser IA layout candidates. Deliberately styled as a dev overlay, not
 * product chrome; dies with the branch. Keys 1/2/3 also switch (wired in
 * ChooserView).
 */
import type { ChooserProtoLayout } from './chooser-proto'

defineProps<{
  modelValue: ChooserProtoLayout
}>()

const emit = defineEmits<{
  'update:modelValue': [layout: ChooserProtoLayout]
}>()

const OPTIONS: { key: ChooserProtoLayout; hotkey: string; label: string }[] = [
  { key: 'shelves', hotkey: '1', label: 'Shelves' },
  { key: 'chips', hotkey: '2', label: 'Chips' },
  { key: 'zones', hotkey: '3', label: 'Zones' }
]
</script>

<template>
  <div class="proto-hud" role="group" aria-label="Prototype layout switcher">
    <span class="proto-hud-tag">Layout</span>
    <button
      v-for="opt in OPTIONS"
      :key="opt.key"
      type="button"
      class="proto-hud-btn"
      :class="{ 'proto-hud-btn--active': modelValue === opt.key }"
      @click="emit('update:modelValue', opt.key)"
    >
      <span class="proto-hud-key">{{ opt.hotkey }}</span>
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.proto-hud {
  position: fixed;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(12, 12, 14, 0.82);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
}

.proto-hud-tag {
  padding: 0 8px 0 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  user-select: none;
}

.proto-hud-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px 5px 7px;
  border: none;
  border-radius: 999px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 100ms ease,
    color 100ms ease;
}
.proto-hud-btn:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.proto-hud-btn--active {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text);
}

.proto-hud-key {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 1px solid currentColor;
  font-size: 10px;
  opacity: 0.65;
}
</style>
