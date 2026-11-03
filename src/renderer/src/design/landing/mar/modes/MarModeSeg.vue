<script setup lang="ts" generic="T extends string">
import type { Component } from 'vue'

/**
 * The one Create / Build (/ Agent) switch, wherever it sits: the sidebar,
 * the rail, the dock, the title bar and the Split mode style. The tabs'
 * track and corners (MarSeg); the pill slides (motion/tabSlide.ts).
 *
 * `show` says what each option shows: `both` (icon and name), `label`,
 * `icon`, or `picked` (icons, and the picked one's name). `vertical`
 * stacks icons (the rail); `fill` shares the width; `lg` is the dock's.
 */
const {
  options,
  show = 'both',
  size = 'md',
  fill = false,
  vertical = false
} = defineProps<{
  options: readonly { value: T; label: string; icon?: Component }[]
  show?: 'both' | 'label' | 'icon' | 'picked'
  size?: 'md' | 'lg'
  fill?: boolean
  vertical?: boolean
}>()
const model = defineModel<T>({ required: true })

const named = (v: T): boolean =>
  !vertical && (show === 'both' || show === 'label' || (show === 'picked' && model.value === v))
</script>

<template>
  <div
    role="radiogroup"
    aria-label="Mode"
    class="mar-mode"
    :class="[size === 'lg' && 'is-lg', fill && 'is-fill', vertical && 'is-vertical']"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :aria-label="named(o.value) ? undefined : o.label"
      :title="named(o.value) ? undefined : o.label"
      class="mar-mode-btn"
      :class="!named(o.value) && 'is-icon'"
      @click="model = o.value"
    >
      <component
        :is="o.icon"
        v-if="o.icon && show !== 'label'"
        :size="size === 'lg' ? 17 : 15"
      /><span v-if="named(o.value)">{{ o.label }}</span>
    </button>
  </div>
</template>

<style>
/* Past the prototype's button reset (.proto-ui x3). */
:root .proto-ui.proto-ui.proto-ui .mar-mode {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 3px;
  border-radius: var(--mar-tab-radius, 10px);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-mode.is-fill {
  width: 100%;
}
:root .proto-ui.proto-ui.proto-ui .mar-mode.is-vertical {
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .mar-mode-btn {
  display: inline-flex;
  width: auto;
  height: 28px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--mar-tab-item-radius, 7px);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  white-space: nowrap;
  transition: color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-mode.is-fill .mar-mode-btn {
  min-width: 0;
  flex: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-mode-btn.is-icon {
  width: 32px;
  padding: 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-mode.is-vertical .mar-mode-btn {
  width: 40px;
  height: 32px;
}
:root .proto-ui.proto-ui.proto-ui .mar-mode-btn:hover,
:root .proto-ui.proto-ui.proto-ui .mar-mode-btn[aria-checked='true'] {
  color: var(--color-base-foreground);
}
/* Under the sliding pill this stays transparent; it shows where the
   script doesn't run. */
:root .proto-ui.proto-ui.proto-ui .mar-mode-btn[aria-checked='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-mode-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}
/* The dock: bigger cells, corners a step rounder to match. */
:root .proto-ui.proto-ui.proto-ui .mar-mode.is-lg {
  border-radius: calc(var(--mar-tab-radius, 10px) + 4px);
}
:root .proto-ui.proto-ui.proto-ui .mar-mode.is-lg .mar-mode-btn {
  height: 38px;
  border-radius: calc(var(--mar-tab-item-radius, 7px) + 4px);
}
:root .proto-ui.proto-ui.proto-ui .mar-mode.is-lg .mar-mode-btn.is-icon {
  width: 38px;
}
</style>
