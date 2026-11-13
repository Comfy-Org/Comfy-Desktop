<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpCircle, CircleCheck, Loader2, RefreshCw } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Select from '../../ui/Select.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import { toast } from '../../useProto'
import { notify } from '../pages/undo'
import type { ProtoInstance } from '../../mock'
import { CHANNELS, factsOf, pendingOf, stateOf, updateBuild, type Channel } from './buildFacts'
import './buildTabs.css'

/**
 * The Update tab's top, as Desktop ships it (Comfy-Desktop#2061): one
 * status card (a round icon for the state, ComfyUI and its version, then
 * the status and when it was last checked, Check for updates or Update Now
 * beside it), and the Update channel as its own section under it, with an
 * uppercase title, the picker and what the channel means.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)
const pending = computed(() => pendingOf(env))
const channel = computed(() => CHANNELS.find((c) => c.value === state.channel)!)
const CHANNEL_OPTIONS = CHANNELS.map((c) => ({ value: c.value, label: c.label, hint: c.hint }))
const picked = computed<Channel>({
  get: () => state.channel,
  set: (v) => {
    const was = state.channel
    if (v === was) return
    state.channel = v
    notify(`Update channel: ${channel.value.label}`, () => (state.channel = was))
  }
})
</script>

<template>
  <Card class="mar-bt-update" :class="pending && 'is-pending'">
    <span class="mar-bt-update-icon">
      <Loader2 v-if="state.updating" :size="18" class="animate-spin" />
      <ArrowUpCircle v-else-if="pending" :size="18" />
      <CircleCheck v-else :size="18" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="mar-bt-title">ComfyUI {{ state.version }}</p>
      <p class="mar-bt-sub">
        <template v-if="state.updating">Updating to {{ pending }}…</template>
        <template v-else-if="pending"
          >Update available · Latest version {{ pending }} · Last checked
          {{ facts.checked }}</template
        >
        <template v-else>Up to date · Last checked {{ facts.checked }}</template>
      </p>
    </div>
    <span v-if="pending && !state.updating" class="bus-safe">Saves a snapshot first</span>
    <Button v-if="pending" variant="primary" :disabled="state.updating" @click="updateBuild(env)"
      ><ArrowUpCircle :size="14" />Update Now</Button
    >
    <Button v-else variant="secondary" @click="toast(`${env.name} is up to date`)"
      ><RefreshCw :size="13" />Check for updates</Button
    >
  </Card>

  <section class="bus-channel-section">
    <SectionHeader class="mar-sec" title="Update channel" />
    <Select v-model="picked" :options="CHANNEL_OPTIONS" class="w-full" />
    <p class="bus-hint-line">{{ channel.hint }}</p>
  </section>
</template>

<style>
.bus-channel-section,
.bus-channel-section + .bus-torch {
  margin-top: 36px;
}
.bus-hint-line {
  margin: 8px 0 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.bus-safe {
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  white-space: nowrap;
}
</style>
