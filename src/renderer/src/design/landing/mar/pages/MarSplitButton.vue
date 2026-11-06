<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import MarItemMenu from './MarItemMenu.vue'
import type { MenuLine } from './menu'

/** The one primary action of a page header, with its close relatives
 *  (an address, a preview) one click away in the chevron's menu. Secondary
 *  sits on a card, where the page's primary is elsewhere. */
const {
  label,
  suffix,
  icon,
  lines,
  menuLabel,
  tone = 'primary',
  disabled = false
} = defineProps<{
  label: string
  /** Words after the label that a narrow card can drop (where it runs). */
  suffix?: string
  icon?: Component
  lines: MenuLine[]
  menuLabel: string
  tone?: 'primary' | 'secondary'
  disabled?: boolean
}>()
const emit = defineEmits<{ run: [] }>()
</script>

<template>
  <span class="mar-split" :class="`is-${tone}`" @click.stop>
    <button type="button" class="mar-split-main" :disabled @click="emit('run')">
      <component :is="icon" v-if="icon" :size="15" />{{ label
      }}<span v-if="suffix" class="mar-split-suffix">{{ suffix }}</span>
    </button>
    <MarItemMenu v-if="lines.length" :lines :label="menuLabel">
      <template #trigger>
        <button type="button" class="mar-split-more" :aria-label="menuLabel">
          <ChevronDown :size="14" />
        </button>
      </template>
    </MarItemMenu>
  </span>
</template>

<style>
.mar-split {
  display: inline-flex;
  height: 32px;
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-split-main, .mar-split-more) {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-split-main, .mar-split-more):hover,
:root .proto-ui.proto-ui.proto-ui .mar-split-more[data-state='open'] {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .mar-split-main {
  gap: 4px;
  padding: 0 12px;
  border-radius: var(--radius-control) 0 0 var(--radius-control);
}
:root .proto-ui.proto-ui.proto-ui .mar-split.is-secondary :is(.mar-split-main, .mar-split-more) {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
}
:root
  .proto-ui.proto-ui.proto-ui
  .mar-split.is-secondary
  :is(.mar-split-main, .mar-split-more):hover,
:root .proto-ui.proto-ui.proto-ui .mar-split.is-secondary .mar-split-more[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-split-main:only-child {
  border-radius: var(--radius-control);
}
:root .proto-ui.proto-ui.proto-ui .mar-split-more {
  width: 30px;
  justify-content: center;
  padding: 0;
  border-left: 1px solid color-mix(in oklch, var(--color-inverted-foreground) 18%, transparent);
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-split.is-secondary .mar-split-more {
  border-left-color: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
</style>
