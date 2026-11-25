<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Check, ChevronsUpDown } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import MarModeSeg from './MarModeSeg.vue'
import { modeStyle } from './modeStyle'
import { marNav, marPanelsOn } from '../shell/marShell'

/** The Create / Build / Agent switch in the style picked in the UI
 *  Playground (Split is the one on offer). */
const { options } = defineProps<{
  options: { value: string; label: string; icon: Component }[]
}>()
const model = defineModel<string>({ required: true })
const current = computed(() => options.find((o) => o.value === model.value) ?? options[0]!)
const agent = computed(() => options.find((o) => o.value === 'agent'))
const pair = computed(() => options.filter((o) => o.value !== 'agent'))
// Floating panels collapsed to a rail: the pair stacks as icons.
const rail = computed(() => marPanelsOn.value && marNav.collapsed)
const HINT: Record<string, string> = {
  create: 'Make images, video and 3D',
  build: 'Ship workflows as APIs',
  agent: 'Ask Comfy to do it'
}
</script>

<template>
  <!-- Title: the current mode is the sidebar's heading; it opens a list. -->
  <DropdownMenuRoot v-if="modeStyle.id === 'title'" :modal="false">
    <DropdownMenuTrigger as-child>
      <button type="button" class="mms-title">
        <span>{{ current.label }}</span>
        <ChevronsUpDown :size="14" class="text-subtle-foreground" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-60">
      <DropdownMenuItem v-for="o in options" :key="o.value" @select="model = o.value">
        <component :is="o.icon" :size="15" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span>{{ o.label }}</span>
          <span class="text-[12px] text-subtle-foreground">{{ HINT[o.value] }}</span>
        </span>
        <Check v-if="model === o.value" :size="14" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>

  <!-- Stack: each mode a row with what it is for. -->
  <div v-else-if="modeStyle.id === 'stack'" class="mms-stack" role="radiogroup" aria-label="Mode">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      class="mms-row"
      @click="model = o.value"
    >
      <span class="mms-ico"><component :is="o.icon" :size="15" /></span>
      <span class="flex min-w-0 flex-col text-left">
        <span class="mms-name">{{ o.label }}</span>
        <span class="mms-hint">{{ HINT[o.value] }}</span>
      </span>
    </button>
  </div>

  <!-- Split (and Foot): Create / Build as a toggle, Agent its own button. -->
  <div v-else class="mms-split" :class="modeStyle.id === 'foot' && 'is-foot'">
    <MarModeSeg
      v-model="model"
      :options="pair"
      :fill="!rail"
      :vertical="rail"
      :class="!rail && 'min-w-0 flex-1'"
    />
    <button
      v-if="agent"
      type="button"
      class="mms-agent"
      :aria-pressed="model === 'agent'"
      :title="agent.label"
      :aria-label="agent.label"
      @click="model = 'agent'"
    >
      <component :is="agent.icon" :size="15" />
    </button>
  </div>
</template>

<style>
/* Global: buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mms-title {
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: 10px;
  color: var(--color-base-foreground);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
:root .proto-ui.proto-ui.proto-ui .mms-title:hover,
:root .proto-ui.proto-ui.proto-ui .mms-title[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.mms-stack {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .mms-row {
  display: flex;
  width: 100%;
  height: 44px;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  border-radius: 12px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mms-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mms-row[aria-checked='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
.mms-ico {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.mms-name {
  font-size: 13px;
  font-weight: 500;
}
.mms-hint {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mms-split {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .mms-agent {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mms-agent[aria-pressed='true'],
:root .proto-ui.proto-ui.proto-ui .mms-agent:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
  color: var(--color-base-foreground);
}
/* Foot: the switch moves to the bottom of the sidebar, above the
   workspace (the stack and title stay on top). */
.proto-sidebar > div:has(.mms-split.is-foot) > div:first-child {
  order: 90;
  height: auto;
  margin: auto 0 8px;
}
.proto-sidebar > div:has(.mms-split.is-foot) > .mt-auto {
  order: 91;
  margin-top: 0;
}
/* The stack needs its own height. */
.proto-sidebar > div:has(.mms-stack) > div:first-child {
  height: auto;
}
</style>
