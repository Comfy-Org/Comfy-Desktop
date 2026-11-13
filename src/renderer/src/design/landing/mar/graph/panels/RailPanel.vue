<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { RAIL_DEFAULT, railWidth, setRailWidth } from './railWidth'

/**
 * The chrome every rail panel shares (ComfyUI's SidebarTabTemplate, in
 * the New UI): one header row (title, the panel's actions, Close), then
 * the panel's controls (segmented tabs, search and its filter) closed by
 * a hairline, then the scrolling body and an optional footer. Actions
 * stay in view: tools that wait for the pointer are hard to find.
 * The right edge drags the width; a double-click puts it back.
 */
const props = withDefaults(defineProps<{ title: string; label?: string; closable?: boolean }>(), {
  closable: true
})
defineEmits<{ close: [] }>()

const width = computed(() => railWidth[props.title] ?? RAIL_DEFAULT)
const dragging = ref(false)
function drag(e: PointerEvent): void {
  const el = (e.currentTarget as HTMLElement).parentElement!
  const left = el.getBoundingClientRect().left
  dragging.value = true
  const move = (m: PointerEvent): void => setRailWidth(props.title, m.clientX - left)
  const up = (): void => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function nudge(e: KeyboardEvent): void {
  const step = e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0
  if (step) setRailWidth(props.title, width.value + step)
}
</script>

<template>
  <aside
    class="rp"
    :class="[dragging && 'is-resizing', !closable && 'no-close']"
    :style="{ width: `${width}px` }"
    :aria-label="label ?? title"
    @pointerdown.stop
    @wheel.stop
  >
    <div
      class="rp-resize"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="width"
      aria-label="Resize panel"
      title="Drag to resize · Double-click to reset"
      tabindex="0"
      @pointerdown.prevent="drag"
      @dblclick="setRailWidth(title, null)"
      @keydown="nudge"
    />
    <header class="rp-head">
      <h2 class="rp-title">{{ title }}<slot name="alt-title" /></h2>
      <span class="rp-tools"><slot name="tools" /></span>
      <button
        v-if="closable"
        type="button"
        class="rp-icon rp-close"
        aria-label="Close sidebar"
        title="Close sidebar"
        @click="$emit('close')"
      >
        <X :size="15" />
      </button>
    </header>
    <div v-if="$slots.header" class="rp-controls"><slot name="header" /></div>
    <div class="rp-body"><slot /></div>
    <slot name="footer" />
  </aside>
</template>

<style>
/* Shared by every panel and dialog of the rail (rp-*).
   Surface: the DS's Glass · menu recipe (mar/shell/marShell.css), more
   opaque so the canvas's dots don't read through, with a 1px ring so
   the edge holds on the dotted canvas. Current docks a solid panel with
   a real edge line, as ComfyUI does. */
.rp,
.sp,
.rp-dialog {
  --rp-surface: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-card-background)) 94%,
    transparent
  );
  /* Edge and dividers stay quiet: the shadow and surface carry the panel. */
  --rp-ring: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  --rp-line: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  --rp-hover: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  --rp-chip: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  --rp-chip-on: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
  --rp-raised: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  --rp-raised-shadow: 0 1px 2px rgb(0 0 0 / 0.22);
  --rp-shadow: 0 1px 2px rgb(0 0 0 / 0.2), 0 24px 56px -12px rgb(0 0 0 / 0.6);
  --rp-text: var(--color-base-foreground);
  --rp-meta: var(--color-muted-foreground);
  --rp-label: var(--color-muted-foreground);
}
:root[data-ds-theme='light'] :is(.rp, .sp, .rp-dialog) {
  --rp-surface: color-mix(in oklch, var(--color-card-background) 97%, transparent);
  --rp-ring: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  --rp-line: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  --rp-hover: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  --rp-chip: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  --rp-chip-on: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  --rp-raised: var(--color-card-background);
  --rp-raised-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
    0 1px 3px rgb(0 0 0 / 0.1);
  --rp-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 18px 44px -14px rgb(0 0 0 / 0.24);
  --rp-meta: color-mix(in oklch, var(--color-base-foreground) 62%, transparent);
  --rp-label: color-mix(in oklch, var(--color-base-foreground) 62%, transparent);
}
.mg.is-current :is(.rp, .sp, .rp-dialog) {
  --rp-surface: var(--mg-chrome);
  --rp-ring: var(--mg-chrome-line);
  --rp-line: var(--mg-chrome-line);
  --rp-text: var(--mg-text);
  --rp-meta: var(--mg-muted);
  --rp-label: var(--mg-muted);
}
.rp {
  position: absolute;
  top: calc(var(--mg-top) + 16px);
  bottom: 72px;
  left: 76px;
  z-index: 4;
  display: flex;
  width: 320px;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--rp-surface);
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow:
    inset 0 0 0 1px var(--rp-ring),
    var(--rp-shadow);
  color: var(--rp-text);
  font-size: 13px;
}
/* The right edge drags the width: a 6px strip, a hairline on hover. */
.rp-resize {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 6;
  width: 6px;
  cursor: col-resize;
  outline: none;
}
.rp-resize::after {
  position: absolute;
  top: 12px;
  right: 0;
  bottom: 12px;
  width: 2px;
  border-radius: 1px;
  background: var(--color-primary-background, #0b8ce9);
  content: '';
  opacity: 0;
  transition: opacity 0.15s;
}
.rp-resize:hover::after,
.rp-resize:focus-visible::after,
.rp.is-resizing .rp-resize::after {
  opacity: 1;
}
.rp.is-resizing,
.rp.is-resizing * {
  cursor: col-resize;
  user-select: none;
}
.mg.is-current .rp {
  top: calc(var(--mg-top) + 38px);
  bottom: 0;
  left: 56px;
  border-radius: 0;
  box-shadow: inset -1px 0 0 var(--rp-ring);
  backdrop-filter: none;
}

/* Header: title, actions, Close. Same height in every panel. */
.rp-head {
  display: flex;
  height: 52px;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 0 10px 0 16px;
}
:root .proto-ui.proto-ui.proto-ui .rp-title {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  margin: 0;
  color: var(--rp-text);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.rp-tools {
  display: flex;
  align-items: center;
  gap: 2px;
}
/* The hairline sets the panel's tools apart from Close; no Close, none. */
.rp:not(.no-close) .rp-tools:not(:empty)::after {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--rp-line);
  content: '';
}
/* Controls: the panel's tabs, then search and its filter. A hairline
   splits what stays put from what scrolls. */
.rp-controls {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px;
  box-shadow: inset 0 -1px 0 var(--rp-line);
}
.rp-controls .mar-pseg {
  display: flex;
  width: 100%;
}
:root .proto-ui.proto-ui.proto-ui .rp-controls .mar-pseg-btn {
  flex: 1;
}
.rp-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* Grows along a row, keeps its 32px in the column of controls. */
:root .proto-ui.proto-ui.proto-ui :is(.rp, .sp, .rp-dialog) .mar-pfind {
  width: auto;
  min-width: 0;
  flex: 1 1 auto;
}
/* While a panel is open the Agent button moves past it. */
:root .proto-ui.proto-ui.proto-ui .mg.is-current.has-panel .mg-agent-btn {
  left: 388px;
}

/* Icon buttons. `is-field` matches the search field beside it (same
   height, corner and ring), so filter and view read as part of it. */
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
  color: var(--rp-meta);
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .rp-icon:hover,
:root .proto-ui.proto-ui.proto-ui .rp-icon.is-on {
  background: var(--rp-hover);
  color: var(--rp-text);
}
:root .proto-ui.proto-ui.proto-ui .rp-icon:focus-visible,
:root .proto-ui.proto-ui.proto-ui .rp-row:focus-visible,
:root .proto-ui.proto-ui.proto-ui .rp-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}
:root .proto-ui.proto-ui.proto-ui .rp-icon.is-field {
  width: 32px;
  height: 32px;
  border-radius: var(--mar-tab-radius);
  background-color: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 9%, var(--color-card-background)) 82%,
    transparent
  );
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .rp-icon.is-field:hover,
:root .proto-ui.proto-ui.proto-ui .rp-icon.is-field.is-on {
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
  color: var(--rp-text);
}
.rp-icon .rp-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-primary-background, #0b8ce9);
  box-shadow: 0 0 0 2px var(--rp-surface);
}
.rp-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

/* Section labels: sentence case, as the DS's group labels. */
:root .proto-ui.proto-ui.proto-ui .rp-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 14px 8px 6px;
  color: var(--rp-label);
  font-size: 12px;
  font-weight: 600;
}
.rp-section .rp-count {
  margin-left: auto;
}
.rp-note {
  margin: 0;
  padding: 2px 8px 8px;
  color: var(--rp-meta);
  font-size: 12px;
}

/* Rows: hover lifts a shade; the current one is a raised row, as the
   current pick in a DS menu. */
:root .proto-ui.proto-ui.proto-ui .rp-row {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--rp-text);
  font-size: 13px;
  text-align: left;
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .rp-row:hover {
  background: var(--rp-hover);
}
:root .proto-ui.proto-ui.proto-ui .rp-row.is-on {
  background: var(--rp-raised);
  box-shadow: var(--rp-raised-shadow);
}
.rp-row-icon {
  flex: none;
  color: var(--rp-meta);
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
  color: var(--rp-meta);
  transition: rotate 0.15s ease;
}
.rp-chev.is-shut {
  rotate: -90deg;
}
.rp-count {
  flex: none;
  color: var(--rp-meta);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.rp-list {
  padding: 4px 8px 12px;
}
.rp-badge {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--rp-chip-on);
  color: var(--rp-meta);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
:root .proto-ui.proto-ui.proto-ui .rp-btn {
  display: inline-flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--mar-tab-item-radius);
  background: var(--rp-chip);
  color: var(--rp-text);
  font-size: 12.5px;
  font-weight: 500;
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
/* Small text-only notes in place of a list ("No bookmarks yet"); real
   empty states use MarEmpty. */
.rp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 24px;
  color: var(--rp-meta);
  font-size: 13px;
  line-height: 18px;
  text-align: center;
}
:is(.rp, .sp) .mar-empty.is-compact {
  padding: 40px 16px 32px;
}

/* Menus under a tool button: role="menu" gives them the DS's glass
   menu (surface, ring, radius 14, padding 6); the current pick is a
   raised row. */
.rp-anchor {
  position: relative;
  display: inline-flex;
}
.rp-menu {
  position: absolute;
  z-index: 8;
  display: flex;
  min-width: 200px;
  max-height: min(440px, calc(100vh - 340px));
  flex-direction: column;
  gap: 1px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.rp-menu > * {
  flex: none;
}
.rp-menu.is-end {
  top: calc(100% + 6px);
  right: 0;
}
:root .proto-ui.proto-ui.proto-ui .rp-menu .rp-row {
  min-height: 32px;
  border-radius: 8px;
}
:root .proto-ui.proto-ui.proto-ui .rp-menu .rp-row[data-state='checked'] {
  background: var(--rp-raised);
  box-shadow: var(--rp-raised-shadow);
}
.rp-menu-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 8px 8px 4px;
  color: var(--rp-label);
  font-size: 12px;
  font-weight: 600;
}
.rp-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--rp-line);
}
.rp-row small {
  display: block;
  color: var(--rp-meta);
  font-size: 11.5px;
}
.rp-row.is-danger,
.rp-icon.is-danger:hover {
  color: var(--color-danger-foreground, #e5484d);
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
  box-shadow: inset 0 -1px 0 var(--rp-line);
  color: var(--rp-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
@media (prefers-reduced-motion: reduce) {
  .rp-chev,
  :root .proto-ui.proto-ui.proto-ui .rp-row,
  :root .proto-ui.proto-ui.proto-ui .rp-icon {
    transition: none;
  }
}
</style>
