<script setup lang="ts">
import { ref } from 'vue'
import { Settings, X } from 'lucide-vue-next'
import { SHORTCUTS } from './panelData'
import MarSeg from '../../pages/MarSeg.vue'

/**
 * Keyboard Shortcuts (ComfyUI's bottom panel, rail › Shortcuts): Essential
 * and View Controls, each a few columns of commands and their keys, with
 * Manage Shortcuts (Settings › Keybinding) and Close.
 */
const emit = defineEmits<{ close: []; manage: [] }>()
const tab = ref<keyof typeof SHORTCUTS>('Essential')
const TABS = (Object.keys(SHORTCUTS) as (keyof typeof SHORTCUTS)[]).map((t) => ({
  value: t,
  label: t
}))
const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const key = (k: string): string => (mac && k === 'Ctrl' ? '⌘' : mac && k === 'Alt' ? '⌥' : k)
</script>

<template>
  <section class="sp" aria-label="Keyboard Shortcuts" @pointerdown.stop @wheel.stop>
    <header class="sp-head">
      <h2 class="rp-title sp-h">Keyboard Shortcuts</h2>
      <MarSeg v-model="tab" :options="TABS" label="Shortcut groups" />
      <span class="sp-gap" />
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
  background: var(--rp-surface);
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow:
    inset 0 0 0 1px var(--rp-ring),
    var(--rp-shadow);
  color: var(--rp-text);
}
.mg.is-current .sp {
  right: 0;
  bottom: 0;
  left: 56px;
  border-radius: 0;
  box-shadow: inset 0 1px 0 var(--rp-ring);
  backdrop-filter: none;
}
.sp-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  height: 52px;
  align-items: center;
  gap: 12px;
  padding: 0 10px 0 16px;
  background: var(--rp-surface);
  box-shadow: inset 0 -1px 0 var(--rp-line);
}
:root .proto-ui.proto-ui.proto-ui .sp-h {
  flex: none;
}
.sp-gap {
  flex: 1;
}
.sp-cols {
  display: grid;
  width: 90%;
  margin: 0 auto;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px 64px;
  padding: 4px 0 24px;
}
:root .proto-ui.proto-ui.proto-ui .sp-title {
  padding: 16px 0 6px;
}
.sp-row {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--rp-text);
  font-size: 13px;
}
.sp-row + .sp-row {
  box-shadow: inset 0 1px 0 var(--rp-line);
}
.sp-keys {
  display: flex;
  flex: none;
  gap: 4px;
}
</style>
