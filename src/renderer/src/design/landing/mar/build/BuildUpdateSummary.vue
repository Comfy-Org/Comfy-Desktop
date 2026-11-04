<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpCircle, CircleCheck, Loader2, RefreshCw } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Select from '../../ui/Select.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { CHANNELS, factsOf, pendingOf, stateOf, updateBuild } from './buildFacts'
import './buildTabs.css'

/**
 * Up to date or not, first thing on the page (UI Playground › Build page ›
 * Overview first): an icon, one line and the action, then the channel
 * under a hairline.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)
const pending = computed(() => pendingOf(env))
const channel = computed(() => CHANNELS.find((c) => c.value === state.channel)!)
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
      <p class="mar-bt-sub">
        <template v-if="pending"
          >You’re on {{ state.version }}. A snapshot is saved first, so you can go back.</template
        >
        <template v-else
          >ComfyUI {{ state.version }} · {{ channel.label }} · checked {{ facts.checked }}</template
        >
      </p>
    </div>
    <Button v-if="pending" variant="primary" :disabled="state.updating" @click="updateBuild(env)"
      ><ArrowUpCircle :size="14" />Update Now</Button
    >
    <Button v-else variant="ghost" @click="toast(`${env.name} is up to date`)"
      ><RefreshCw :size="13" />Check for updates</Button
    >
    <div class="mar-bt-update-foot">
      <span class="mar-bt-label">Update Channel</span>
      <Select v-model="state.channel" :options="CHANNELS" variant="ghost" size="sm" class="w-44" />
      <span class="mar-bt-hint ml-auto">{{ channel.hint }}</span>
    </div>
  </Card>
</template>
