<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import { notify } from '../pages/undo'
import type { ProtoInstance } from '../../mock'
import { CHANNELS, stateOf } from './buildFacts'

/**
 * A build's update channel, quiet inside a status line: the menu says
 * what each channel means. Changing it can be undone from the toast.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const state = stateOf(env)
const channel = computed(() => CHANNELS.find((c) => c.value === state.channel)!)
function setChannel(c: (typeof CHANNELS)[number]): void {
  const was = state.channel
  if (c.value === was) return
  state.channel = c.value
  notify(`Update channel: ${c.label}`, () => (state.channel = was))
}
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger class="bus-channel" aria-label="Update Channel"
      >{{ channel.label }}<ChevronDown :size="13"
    /></DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side-offset="6" class="w-60">
      <p class="bus-menu-head">Update Channel</p>
      <DropdownMenuItem
        v-for="c in CHANNELS"
        :key="c.value"
        class="bus-option"
        @select="setChannel(c)"
      >
        <span class="bus-check"><Check v-if="c.value === state.channel" :size="14" /></span>
        <span class="flex min-w-0 flex-col">
          <span>{{ c.label }}</span>
          <span class="bus-hint">{{ c.hint }}</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<style>
.bus-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .bus-channel {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 0 -5px;
  padding: 1px 5px;
  border-radius: 6px;
  color: inherit;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
/* Quiet like the rest of the line; it lights up only when reached for. */
:root .proto-ui.proto-ui.proto-ui .bus-channel:is(:hover, [data-state='open']) {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
.bus-menu-head {
  margin: 0;
  padding: 6px 8px 4px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .bus-option {
  align-items: flex-start;
  height: auto;
  padding-block: 6px;
}
.bus-check {
  display: inline-flex;
  width: 14px;
  flex-shrink: 0;
  padding-top: 2px;
}
.bus-hint {
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.bus-safe {
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  white-space: nowrap;
}
</style>
