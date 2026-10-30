<script setup lang="ts">
import { X } from 'lucide-vue-next'

/**
 * The chrome every rail panel shares, as ComfyUI's SidebarTabTemplate: a
 * header with the title and its tool buttons (shown on hover, as in the
 * product) and Close, then the panel's own header (tabs, search), its
 * body and an optional footer. Opens beside the rail.
 */
defineProps<{ title: string; label?: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <aside class="rp" :aria-label="label ?? title" @pointerdown.stop @wheel.stop>
    <header class="rp-head">
      <span class="rp-title">{{ title }}<slot name="alt-title" /></span>
      <span class="rp-tools"><slot name="tools" /></span>
      <button
        type="button"
        class="rp-icon"
        aria-label="Close sidebar"
        title="Close sidebar"
        @click="$emit('close')"
      >
        <X :size="15" />
      </button>
    </header>
    <slot name="header" />
    <div class="rp-body"><slot /></div>
    <slot name="footer" />
  </aside>
</template>

<style>
/* Shared by every panel and dialog of the rail (rp-*). Glass floats a
   card beside the rail; Current docks a flush panel, as ComfyUI does. */
.rp {
  position: absolute;
  top: calc(var(--mg-top) + 16px);
  bottom: 72px;
  left: 76px;
  z-index: 4;
  display: flex;
  width: 312px;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-content-background) 78%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.28);
  color: var(--mg-text);
  font-size: 13px;
}
:root[data-ds-theme='light'] .rp {
  background: oklch(1 0 0 / 0.82);
  box-shadow:
    0 0 0 1px oklch(0 0 0 / 0.06),
    0 18px 50px rgb(0 0 0 / 0.12);
}
.mg.is-current .rp {
  top: calc(var(--mg-top) + 38px);
  bottom: 0;
  left: 56px;
  border-radius: 0;
  background: var(--mg-chrome);
  box-shadow: inset -1px 0 0 var(--mg-chrome-line);
  backdrop-filter: none;
}
.rp-head {
  display: flex;
  min-height: 52px;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 16px;
  box-shadow: inset 0 -1px 0 var(--rp-line);
}
.rp,
.rp-dialog {
  --rp-line: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  --rp-chip: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  --rp-chip-on: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
.rp-title {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
}
/* While a panel is open the Agent button moves past it. */
:root .proto-ui.proto-ui.proto-ui .mg.is-current.has-panel .mg-agent-btn {
  left: 380px;
}
/* Tool buttons wait for the pointer, as the product's do. */
.rp-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.rp:hover .rp-tools,
.rp:focus-within .rp-tools {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .rp-icon {
  position: relative;
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .rp-icon:hover,
:root .proto-ui.proto-ui.proto-ui .rp-icon.is-on {
  background: var(--mg-hover);
  color: var(--mg-text);
}
:root .proto-ui.proto-ui.proto-ui .rp-icon.is-filled {
  background: var(--rp-chip);
}
.rp-icon .rp-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-primary-background, #0b8ce9);
}
.rp-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
}

/* Tabs: the product's TabList, in our pills. */
.rp-tabs {
  display: flex;
  flex: none;
  gap: 4px;
  padding: 10px 16px 2px;
}
:root .proto-ui.proto-ui.proto-ui .rp-tab {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
  font-size: 12.5px;
}
:root .proto-ui.proto-ui.proto-ui .rp-tab:hover {
  color: var(--mg-text);
}
:root .proto-ui.proto-ui.proto-ui .rp-tab.is-on {
  background: var(--rp-chip-on);
  color: var(--mg-text);
}

/* Search row: the field, then the panel's actions (SidebarTopArea). */
.rp-top {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
}
.rp-search {
  display: flex;
  min-width: 0;
  height: 32px;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: var(--mar-tab-radius);
  background: var(--rp-chip);
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .rp-search input {
  min-width: 0;
  height: auto;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: var(--mg-text);
  font: inherit;
  font-size: 12.5px;
}
.rp-search input::placeholder {
  color: var(--mg-dim);
}

/* Section headers and the rows under them. */
.rp-section {
  padding: 14px 16px 6px;
  color: var(--mg-dim);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.rp-note {
  padding: 4px 24px 8px;
  color: var(--mg-dim);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .rp-row {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-text);
  font-size: 12.5px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .rp-row:hover {
  background: var(--mg-hover);
}
:root .proto-ui.proto-ui.proto-ui .rp-row.is-on {
  background: var(--rp-chip-on);
}
.rp-row-icon {
  flex: none;
  color: var(--mg-muted);
}
.rp-row-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rp-chev {
  flex: none;
  color: var(--mg-dim);
  transition: rotate 0.15s ease;
}
.rp-chev.is-shut {
  rotate: -90deg;
}
.rp-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--rp-chip);
  color: var(--mg-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.rp-list {
  padding: 0 8px 12px;
}
.rp-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--rp-chip-on);
  color: var(--mg-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
:root .proto-ui.proto-ui.proto-ui .rp-btn {
  display: inline-flex;
  height: 28px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--mar-tab-item-radius);
  background: var(--rp-chip);
  color: var(--mg-text);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .rp-btn:hover:not(:disabled) {
  background: var(--rp-chip-on);
}
:root .proto-ui.proto-ui.proto-ui .rp-btn:disabled {
  opacity: 0.4;
}
:root .proto-ui.proto-ui.proto-ui .rp-btn.is-primary {
  background: var(--mg-run);
  color: var(--mg-run-text);
}
.rp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  color: var(--mg-dim);
  font-size: 12.5px;
  line-height: 18px;
  text-align: center;
}
.rp-empty strong {
  color: var(--mg-text);
  font-weight: 600;
}
/* A small menu under a tool button (filter, sort, view). */
.rp-menu {
  position: absolute;
  z-index: 8;
  display: flex;
  min-width: 190px;
  flex-direction: column;
  padding: 4px;
  border-radius: var(--mar-tab-radius);
  background: var(--color-content-background);
  box-shadow:
    0 0 0 1px var(--rp-line),
    0 12px 32px rgb(0 0 0 / 0.3);
}
.rp-menu-label {
  padding: 6px 8px 4px;
  color: var(--mg-dim);
  font-size: 11px;
}
.rp-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--rp-line);
}
.rp-kbd {
  display: inline-flex;
  min-width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--rp-chip-on);
  color: var(--mg-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
</style>
