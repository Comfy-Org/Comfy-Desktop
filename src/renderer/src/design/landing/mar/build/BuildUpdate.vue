<script setup lang="ts">
import { ArrowUpCircle, Copy, Cpu, Loader2, RefreshCw } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { CHANNELS, factsOf, nextOn, stateOf, updateBuild, type Channel } from './buildFacts'
import './buildTabs.css'

/**
 * Production's Update tab in the New UI: Updates (the channels as cards,
 * each with the newest ComfyUI on it and what you can do: Update Now,
 * Copy & Update, or switch), Check for updates, then PyTorch.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)

function switchTo(c: Channel): void {
  state.channel = c
  toast(`Switched to ${CHANNELS.find((x) => x.value === c)!.label}`)
}
</script>

<template>
  <section class="mar-bt-section">
    <header class="mar-bt-head">
      <h2 class="mar-bt-h2">Updates</h2>
      <Button variant="ghost" size="sm" @click="toast(`${env.name} is up to date`)"
        ><RefreshCw :size="13" />Check for updates</Button
      >
    </header>
    <p class="mar-bt-lead">
      Pick the Update Channel. A snapshot is saved before every update, so you can go back.
    </p>
    <div class="mar-bt-channels" role="radiogroup" aria-label="Update Channel">
      <Card
        v-for="c in CHANNELS"
        :key="c.value"
        class="mar-bt-channel"
        :class="state.channel === c.value && 'is-on'"
        role="radio"
        :aria-checked="state.channel === c.value"
      >
        <div class="flex items-center gap-2">
          <span class="mar-bt-radio" aria-hidden="true" />
          <span class="mar-bt-title">{{ c.label }}</span>
          <Badge v-if="nextOn(env, c.value)" size="sm" class="ml-auto"
            >Update available: {{ nextOn(env, c.value) }}</Badge
          >
          <span v-else-if="state.channel === c.value" class="mar-bt-hint ml-auto">Up to date</span>
        </div>
        <p class="mar-bt-sub">
          {{ c.hint }} · newest {{ facts.latest[c.value] }}
          <template v-if="state.channel === c.value"> · you’re on {{ state.version }}</template>
        </p>
        <div v-if="nextOn(env, c.value)" class="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            :disabled="state.updating"
            @click="updateBuild(env, c.value)"
            ><Loader2 v-if="state.updating" :size="13" class="animate-spin" /><ArrowUpCircle
              v-else
              :size="13"
            />Update Now</Button
          >
          <Button
            size="sm"
            :disabled="state.updating"
            @click="toast(`Copying ${env.name}, then updating the copy`)"
            ><Copy :size="13" />Copy & Update</Button
          >
        </div>
        <div v-else-if="state.channel !== c.value">
          <Button size="sm" @click="switchTo(c.value)">Switch channel only</Button>
        </div>
      </Card>
    </div>
  </section>

  <section class="mar-bt-section">
    <header class="mar-bt-head"><h2 class="mar-bt-h2">PyTorch</h2></header>
    <Card class="mar-bt-row">
      <Cpu :size="16" class="shrink-0 text-subtle-foreground" />
      <div class="min-w-0 flex-1">
        <p class="mar-bt-title">PyTorch {{ facts.torch }}</p>
        <p class="mar-bt-sub">{{ facts.hardware }}</p>
      </div>
      <Button size="sm" @click="toast('Choose a PyTorch version')">Change</Button>
    </Card>
  </section>
</template>
