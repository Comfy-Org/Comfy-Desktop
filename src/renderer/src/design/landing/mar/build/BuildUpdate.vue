<script setup lang="ts">
import { computed } from 'vue'
import { Check, CopyPlus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import type { ProtoInstance } from '../../mock'
import BuildUpdateSummary from './BuildUpdateSummary.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import { factsOf, selectedTorch } from './buildFacts'
import { runOp } from './buildOps'
import './buildTabs.css'

/**
 * Desktop's Update tab (main/sources/standalone/updateSections.ts), with
 * the update as one card: up to date or what's waiting, the Update
 * Channel as a menu in its status line (C·1), Check for updates or Update
 * Now. Then PyTorch, a card per official build: the one in use says Selected,
 * on the right where the others have their buttons. Change PyTorch moves
 * the selection once it finishes; Copy & Change leaves this build as it
 * is. Long work runs in the tab (buildOps.ts).
 */
const { env, torchOnly = false } = defineProps<{ env: ProtoInstance; torchOnly?: boolean }>()
const facts = factsOf(env)

const installed = facts.torch.split(' ')[0]!
const OPTIONS = [
  { v: installed, note: '' },
  { v: '2.10.0', note: '2.4 GB download' },
  {
    v: '2.11.0.dev',
    note: '2.6 GB download  ·  Nightly build: unstable, and installable for only about 60 days after publication'
  }
]
const TORCH = computed(() =>
  OPTIONS.map((t) => ({
    ...t,
    on: (selectedTorch[env.id] ?? installed) === t.v,
    note: t.v === installed ? facts.torch : t.note
  }))
)
function changeTorch(v: string, copy: boolean): void {
  runOp(env.id, {
    title: copy ? `Copying & changing PyTorch to ${v}…` : `Changing PyTorch to ${v}…`,
    done: copy ? 'Copy complete' : 'PyTorch changed',
    then: copy ? undefined : () => (selectedTorch[env.id] = v)
  })
}
</script>

<template>
  <BuildUpdateSummary v-if="!torchOnly" :env />

  <section class="mar-bt-section bus-torch">
    <SectionHeader class="mar-sec" title="PyTorch" />
    <p class="mar-bt-lead">
      Official builds tested with this install. Switching replaces torch, torchvision and
      torchaudio; the rest of the environment is kept.
    </p>
    <div class="flex flex-col gap-2">
      <Card v-for="t in TORCH" :key="t.v" class="mar-bt-row">
        <div class="min-w-0 flex-1">
          <p class="mar-bt-title">PyTorch {{ t.v }}</p>
          <p class="mar-bt-sub">{{ t.note }}</p>
        </div>
        <span v-if="t.on" class="mar-bt-selected"><Check :size="14" />Selected</span>
        <template v-else>
          <Button variant="ghost" size="sm" @click="changeTorch(t.v, true)"
            ><CopyPlus :size="13" />Copy & Change</Button
          >
          <Button size="sm" @click="changeTorch(t.v, false)">Change PyTorch</Button>
        </template>
      </Card>
    </div>
  </section>
</template>
