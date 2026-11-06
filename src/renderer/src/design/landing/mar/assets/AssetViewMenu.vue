<script setup lang="ts">
import { LayoutGrid, List, Minus, Plus, Square, SlidersHorizontal } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { assetView, type AssetLayout, type AssetSize } from './assetView'

/** The View menu (Assets, Mar's proposal): layout, size and whether the
 *  name and details show under each picture. Three calm sections with
 *  room to breathe, hairlines between them. */
const LAYOUTS: { value: AssetLayout; label: string; hint: string; icon: unknown }[] = [
  { value: 'grid', label: 'Grid', hint: 'Each in its shape', icon: LayoutGrid },
  { value: 'square', label: 'Square', hint: 'Even tiles', icon: Square },
  { value: 'list', label: 'List', hint: 'Rows with details', icon: List }
]
const SIZES: AssetSize[] = ['s', 'm', 'l']
const SIZE_NAMES: Record<AssetSize, string> = { s: 'Small', m: 'Medium', l: 'Large' }
function step(d: number): void {
  const i = SIZES.indexOf(assetView.size) + d
  if (i >= 0 && i < SIZES.length) assetView.size = SIZES[i]!
}
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button type="button" class="mar-view-trigger" aria-label="View options">
        <SlidersHorizontal :size="14" />View
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent align="end" :side-offset="8" class="proto-ui mar-view" role="dialog">
        <section class="mar-view-sec">
          <p class="mar-view-title">Layout</p>
          <div class="mar-view-layouts">
            <button
              v-for="l in LAYOUTS"
              :key="l.value"
              type="button"
              :aria-pressed="assetView.layout === l.value"
              class="mar-view-layout"
              @click="assetView.layout = l.value"
            >
              <component :is="l.icon" :size="18" />
              <span class="mar-view-layout-name">{{ l.label }}</span>
              <span class="mar-view-layout-hint">{{ l.hint }}</span>
            </button>
          </div>
        </section>

        <section class="mar-view-sec" :class="assetView.layout === 'list' && 'is-off'">
          <div class="mar-view-row">
            <span class="flex flex-col gap-0.5">
              <span class="mar-view-title">Size</span>
              <span class="mar-view-sub">{{ SIZE_NAMES[assetView.size] }}</span>
            </span>
            <span class="flex items-center gap-2.5">
              <button
                type="button"
                class="mar-view-step"
                aria-label="Smaller"
                :disabled="assetView.size === 's'"
                @click="step(-1)"
              >
                <Minus :size="14" />
              </button>
              <span class="mar-view-track" aria-hidden="true">
                <i
                  v-for="s in SIZES"
                  :key="s"
                  :class="SIZES.indexOf(s) <= SIZES.indexOf(assetView.size) && 'is-on'"
                />
              </span>
              <button
                type="button"
                class="mar-view-step"
                aria-label="Bigger"
                :disabled="assetView.size === 'l'"
                @click="step(1)"
              >
                <Plus :size="14" />
              </button>
            </span>
          </div>
        </section>

        <section class="mar-view-sec">
          <label class="mar-view-row">
            <span class="flex flex-col gap-0.5">
              <span class="mar-view-title">Name and details</span>
              <span class="mar-view-sub">Under each picture</span>
            </span>
            <input v-model="assetView.details" type="checkbox" class="mar-view-switch" />
          </label>
        </section>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
/* Global: portalled, and buttons go past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-view-trigger {
  display: inline-flex;
  width: auto;
  height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  border-radius: var(--mar-tab-radius, 10px);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mar-view-trigger:hover,
:root .proto-ui.proto-ui.proto-ui .mar-view-trigger[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
/* Past the menu family's tight 6px padding: this is a small panel, not
   a list of items. */
:root .proto-ui.proto-ui.proto-ui.mar-view {
  z-index: 60;
  display: flex;
  width: 320px;
  flex-direction: column;
  padding: 6px 18px;
  border-radius: 18px;
  background: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-card-background)) 90%,
    transparent
  );
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent),
    0 24px 64px -20px rgb(0 0 0 / 0.6);
  color: var(--color-base-foreground);
}
.mar-view-sec {
  padding: 16px 0;
}
.mar-view-sec + .mar-view-sec {
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-view-sec.is-off {
  opacity: 0.4;
  pointer-events: none;
}
.mar-view-title {
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mar-view-sub {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.mar-view-layouts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mar-view-layout {
  display: flex;
  width: auto;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 6px 12px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  box-shadow: inset 0 0 0 1px transparent;
  color: var(--color-muted-foreground);
  transition:
    background-color 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-view-layout:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-view-layout[aria-pressed='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
  color: var(--color-base-foreground);
}
.mar-view-layout svg {
  margin-bottom: 4px;
}
.mar-view-layout-name {
  font-size: 13px;
  font-weight: 500;
}
.mar-view-layout-hint {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
}
.mar-view-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mar-view-step {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 9px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-view-step:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-view-step:disabled {
  opacity: 0.35;
}
.mar-view-track {
  display: flex;
  gap: 4px;
}
.mar-view-track i {
  width: 18px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  transition: background-color 150ms ease;
}
.mar-view-track i.is-on {
  background: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-view-switch {
  position: relative;
  display: block;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  border: 0;
  width: 36px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  appearance: none;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.mar-view-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--color-base-foreground);
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
:root .proto-ui.proto-ui.proto-ui .mar-view-switch:checked {
  background: var(--color-base-foreground);
}
.mar-view-switch:checked::after {
  background: var(--color-content-background);
  transform: translateX(14px);
}
@media (prefers-reduced-motion: reduce) {
  .mar-view-switch::after,
  .mar-view-track i {
    transition: none;
  }
}
</style>
