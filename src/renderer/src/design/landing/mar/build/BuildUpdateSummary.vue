<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpCircle, Check, ChevronDown, CircleCheck, Loader2, RefreshCw } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import { toast } from '../../useProto'
import { notify } from '../pages/undo'
import type { ProtoInstance } from '../../mock'
import { CHANNELS, factsOf, pendingOf, stateOf, updateBuild } from './buildFacts'
import './buildTabs.css'

/**
 * Up to date or not, first thing on the page (UI Playground › Build page ›
 * Overview first): an icon, one line and the action. The channel sits in
 * that line, once, as a menu that says what each channel means. Beside
 * the button, the note that an update can be undone.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)
const pending = computed(() => pendingOf(env))
const channel = computed(() => CHANNELS.find((c) => c.value === state.channel)!)
function setChannel(c: (typeof CHANNELS)[number]): void {
  const was = state.channel
  if (c.value === was) return
  state.channel = c.value
  notify(`Update channel: ${c.label}`, () => (state.channel = was))
}
</script>

<template>
  <Card class="mar-bt-update" :class="pending && 'is-pending'">
    <span class="mar-bt-update-icon">
      <Loader2 v-if="state.updating" :size="18" class="animate-spin" />
      <ArrowUpCircle v-else-if="pending" :size="18" />
      <CircleCheck v-else :size="18" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="mar-bt-title">
        <template v-if="state.updating">Updating to {{ pending }}…</template>
        <template v-else-if="pending">ComfyUI {{ pending }} is available</template>
        <template v-else>Up to date</template>
      </p>
      <p class="mar-bt-sub bus-line">
        <template v-if="pending">You’re on {{ state.version }}</template>
        <template v-else>ComfyUI {{ state.version }}</template>
        <span aria-hidden="true">·</span>
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
        <span aria-hidden="true">·</span>
        <span>checked {{ facts.checked }}</span>
      </p>
    </div>
    <span v-if="pending && !state.updating" class="bus-safe">Saves a snapshot first</span>
    <Button v-if="pending" variant="primary" :disabled="state.updating" @click="updateBuild(env)"
      ><ArrowUpCircle :size="14" />Update Now</Button
    >
    <Button v-else variant="ghost" @click="toast(`${env.name} is up to date`)"
      ><RefreshCw :size="13" />Check for updates</Button
    >
  </Card>
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
