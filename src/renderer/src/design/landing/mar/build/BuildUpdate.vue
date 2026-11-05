<script setup lang="ts">
import { CopyPlus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import type { ProtoInstance } from '../../mock'
import BuildUpdateSummary from './BuildUpdateSummary.vue'
import { factsOf } from './buildFacts'
import { runOp } from './buildOps'
import './buildTabs.css'

/**
 * Desktop's Update tab (main/sources/standalone/updateSections.ts), with
 * the update as one card: up to date or what's waiting, the Update
 * Channel as a menu in its status line (C·1), Check for updates or Update
 * Now. Then PyTorch, a card per official build. Long work runs in the tab
 * (buildOps.ts).
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)

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
  <BuildUpdateSummary :env />

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
