<script setup lang="ts">
import { ref } from 'vue'
import { Settings, X } from 'lucide-vue-next'
import { SHORTCUTS } from './panelData'

/**
 * Keyboard Shortcuts (ComfyUI's bottom panel, rail › Shortcuts): Essential
 * and View Controls, each a few columns of commands and their keys, with
 * Manage Shortcuts (Settings › Keybinding) and Close.
 */
const emit = defineEmits<{ close: []; manage: [] }>()
const tab = ref<keyof typeof SHORTCUTS>('Essential')
const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const key = (k: string): string => (mac && k === 'Ctrl' ? '⌘' : mac && k === 'Alt' ? '⌥' : k)
</script>

<template>
  <section class="sp" aria-label="Keyboard Shortcuts" @pointerdown.stop @wheel.stop>
    <header class="sp-head">
      <div class="rp-tabs sp-tabs" role="tablist">
        <button
          v-for="t in Object.keys(SHORTCUTS) as (keyof typeof SHORTCUTS)[]"
          :key="t"
          type="button"
          role="tab"
          class="rp-tab"
          :class="tab === t && 'is-on'"
          :aria-selected="tab === t"
          @click="tab = t"
        >
          {{ t }}
        </button>
      </div>
      <button type="button" class="rp-btn" @click="emit('manage')">
        <Settings :size="13" />Manage Shortcuts
      </button>
      <button type="button" class="rp-icon" aria-label="Close" @click="emit('close')">
        <X :size="15" />
      </button>
    </header>
    <div class="sp-cols">
      <div v-for="c in SHORTCUTS[tab]" :key="c.title" class="sp-col">
        <p class="rp-section sp-title">{{ c.title }}</p>
        <div v-for="[label, keys] in c.rows" :key="label" class="sp-row">
          <span>{{ label }}</span>
          <span class="sp-keys"
            ><kbd v-for="k in keys" :key="k" class="rp-kbd">{{ key(k) }}</kbd></span
          >
        </div>
      </div>
    </div>
  </section>
</template>

<style>
.sp {
  position: absolute;
  right: 16px;
  bottom: 72px;
  left: 76px;
  z-index: 6;
  max-height: 46%;
  overflow: auto;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-content-background) 84%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.3);
  color: var(--mg-text);
  --rp-line: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  --rp-chip: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  --rp-chip-on: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
:root[data-ds-theme='light'] .sp {
  background: oklch(1 0 0 / 0.86);
  box-shadow:
    0 0 0 1px oklch(0 0 0 / 0.06),
    0 18px 50px rgb(0 0 0 / 0.12);
}
.mg.is-current .sp {
  right: 0;
  bottom: 0;
  left: 56px;
  border-radius: 0;
  background: var(--mg-chrome);
  box-shadow: inset 0 1px 0 var(--mg-chrome-line);
  backdrop-filter: none;
}
.sp-head {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 0;
}
.sp-tabs {
  flex: 1;
  padding-top: 4px;
}
.sp-cols {
  display: grid;
  width: 90%;
  margin: 0 auto;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px 64px;
  padding: 4px 0 24px;
}
.sp-title {
  padding: 10px 0 8px;
}
.sp-row {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
}
.sp-keys {
  display: flex;
  flex: none;
  gap: 4px;
}
</style>
