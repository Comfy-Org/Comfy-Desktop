<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUpCircle, CopyPlus, ExternalLink, RefreshCw, Repeat2 } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { CHANNELS, factsOf, nextOn, stateOf, type Channel } from './buildFacts'
import { runOp } from './buildOps'
import './buildTabs.css'

/**
 * Desktop's Update tab (main/sources/standalone/updateSections.ts):
 * Updates, a card per channel with what's installed, the newest and when
 * it was checked, and what you can do there (Update Now, Copy & Update,
 * Switch Channel); then PyTorch, a card per official build. Long work runs
 * in the tab (buildOps.ts).
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)
const checked = ref(facts.checked)

const label = (c: Channel): string => CHANNELS.find((x) => x.value === c)!.label

function update(c: Channel): void {
  const next = facts.latest[c]
  runOp(env.id, {
    title: c === state.channel ? `Updating to ${next}` : `Switching to ${label(c)}`,
    done: 'Update complete',
    then: () => {
      state.channel = c
      state.version = next
    }
  })
}
function copyUpdate(c: Channel): void {
  runOp(env.id, {
    title: `Copy & Update to ${facts.latest[c]}`,
    done: 'Copy complete',
    fail: `Not enough free space to copy ${env.name}. Free up ${facts.disk} and try again.`,
    then: () => toast(`${env.name} (copy) is on ${facts.latest[c]}. The original is untouched.`)
  })
}
function switchTo(c: Channel): void {
  runOp(env.id, {
    title: `Moving to ${label(c)}`,
    done: `On ${label(c)}`,
    cancellable: false,
    then: () => (state.channel = c)
  })
}
function check(): void {
  checked.value = 'Just now'
  toast(nextOn(env, state.channel) ? 'An update is available' : `${env.name} is up to date`)
}

const TORCH = [
  { v: facts.torch.split(' ')[0]!, note: 'Installed', on: true },
  { v: '2.10.0', note: '2.4 GB download', on: false },
  {
    v: '2.11.0.dev',
    note: '2.6 GB download  ·  Nightly build: unstable, and installable for only about 60 days after publication',
    on: false
  }
]
function changeTorch(v: string, copy: boolean): void {
  runOp(env.id, {
    title: copy ? `Copying & changing PyTorch to ${v}…` : `Changing PyTorch to ${v}…`,
    done: copy ? 'Copy complete' : 'PyTorch changed'
  })
}
</script>

<template>
  <section class="mar-bt-section">
    <header class="mar-bt-head">
      <h2 class="mar-bt-h2">Updates</h2>
      <Button variant="ghost" size="sm" @click="check"
        ><RefreshCw :size="13" />Check for updates</Button
      >
    </header>
    <p class="mar-bt-lead">
      Where updates come from. A snapshot is saved before every update, so you can go back.
    </p>
    <div class="mar-bt-channels">
      <Card
        v-for="c in CHANNELS"
        :key="c.value"
        class="mar-bt-channel"
        :class="state.channel === c.value && 'is-on'"
      >
        <div class="flex items-center gap-2">
          <span class="mar-bt-title">{{ c.label }}</span>
          <span v-if="state.channel === c.value" class="mar-tag">Current</span>
          <span v-if="nextOn(env, c.value)" class="mar-bt-status is-warn ml-auto"
            >Update available</span
          >
          <span v-else-if="state.channel === c.value" class="mar-bt-status ml-auto"
            >Up to date</span
          >
        </div>
        <p class="mar-bt-sub">{{ c.hint }}</p>
        <dl class="mar-bt-dl">
          <div v-if="state.channel === c.value">
            <dt>Installed Version</dt>
            <dd>{{ state.version }}</dd>
          </div>
          <div>
            <dt>Latest Version</dt>
            <dd>{{ facts.latest[c.value] }}</dd>
          </div>
          <div>
            <dt>Last Checked</dt>
            <dd>{{ checked }}</dd>
          </div>
        </dl>
        <div class="mar-bt-acts-row">
          <template v-if="nextOn(env, c.value)">
            <Button variant="primary" size="sm" @click="update(c.value)"
              ><ArrowUpCircle :size="13" />Update Now</Button
            >
            <Button
              size="sm"
              title="Copy this instance and update the copy. The original is untouched."
              @click="copyUpdate(c.value)"
              ><CopyPlus :size="13" />Copy & Update</Button
            >
          </template>
          <template v-else-if="state.channel !== c.value">
            <Button size="sm" @click="update(c.value)">Switch to {{ c.label }}</Button>
            <Button variant="ghost" size="sm" @click="switchTo(c.value)"
              ><Repeat2 :size="13" />Switch Channel</Button
            >
          </template>
          <Button
            variant="ghost"
            size="sm"
            class="ml-auto"
            @click="toast(`Release notes for ${facts.latest[c.value]}`)"
            >Release Notes<ExternalLink :size="12"
          /></Button>
        </div>
      </Card>
    </div>
  </section>

  <section class="mar-bt-section">
    <header class="mar-bt-head"><h2 class="mar-bt-h2">PyTorch</h2></header>
    <p class="mar-bt-lead">
      Official builds tested with this install. Switching replaces torch, torchvision and
      torchaudio; the rest of the environment is kept.
    </p>
    <div class="flex flex-col gap-2">
      <Card v-for="t in TORCH" :key="t.v" class="mar-bt-row" :class="t.on && 'is-on'">
        <div class="min-w-0 flex-1">
          <p class="mar-bt-title flex items-center gap-2">
            PyTorch {{ t.v }}<span v-if="t.on" class="mar-tag">Selected</span>
          </p>
          <p class="mar-bt-sub">{{ t.on ? facts.torch : t.note }}</p>
        </div>
        <template v-if="!t.on">
          <Button variant="ghost" size="sm" @click="changeTorch(t.v, true)"
            ><CopyPlus :size="13" />Copy & Change</Button
          >
          <Button size="sm" @click="changeTorch(t.v, false)">Change PyTorch</Button>
        </template>
      </Card>
    </div>
  </section>
</template>
