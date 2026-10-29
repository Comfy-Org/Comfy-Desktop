<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import MarItemMenu from './MarItemMenu.vue'
import type { MenuLine } from './menu'

/** The one primary action of a page header, with its close relatives
 *  (an address, a preview) one click away in the chevron's menu. */
const { label, icon, lines, menuLabel } = defineProps<{
  label: string
  icon?: Component
  lines: MenuLine[]
  menuLabel: string
}>()
const emit = defineEmits<{ run: [] }>()
</script>

<template>
  <span class="mar-split">
    <button type="button" class="mar-split-main" @click="emit('run')">
      <component :is="icon" v-if="icon" :size="15" />{{ label }}
    </button>
    <MarItemMenu :lines :label="menuLabel">
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
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-split-main, .mar-split-more):hover,
:root .proto-ui.proto-ui.proto-ui .mar-split-more[data-state='open'] {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .mar-split-main {
  padding: 0 12px;
  border-radius: var(--radius-control) 0 0 var(--radius-control);
}
:root .proto-ui.proto-ui.proto-ui .mar-split-more {
  width: 30px;
  justify-content: center;
  padding: 0;
  border-left: 1px solid color-mix(in oklch, var(--color-inverted-foreground) 18%, transparent);
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
}
</style>
