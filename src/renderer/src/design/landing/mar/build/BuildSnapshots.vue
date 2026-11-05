<script setup lang="ts">
import { ref } from 'vue'
import { Camera, Download, Plus, RotateCcw, Trash2, Upload } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import MarEmpty from '../pages/MarEmpty.vue'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'
import {
  TRIGGERS,
  createSnapshot,
  deleteSnapshot,
  snapshotsOf,
  stateOf,
  type Snapshot
} from './buildFacts'
import { runOp } from './buildOps'
import './buildTabs.css'

/**
 * Desktop's Snapshots tab (views/comfyUISettings/SnapshotsView.vue) as a
 * timeline (A·3): when on the left, then a line with a dot per snapshot,
 * the newest on top. Open one to see what changed in it and what restoring
 * it would change: ComfyUI's version, custom nodes, pip packages. Create
 * asks for an optional label; a restore runs in the tab (buildOps.ts).
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const snaps = snapshotsOf(env)
const state = stateOf(env)
const open = ref<string>()
const naming = ref(false)
const label = ref('')

function create(): void {
  createSnapshot(env, label.value)
  label.value = ''
  naming.value = false
}
function restore(s: Snapshot): void {
  runOp(env.id, {
    title: 'Restoring snapshot…',
    done: 'Snapshot restored',
    then: () => (state.version = s.comfy)
  })
}

const NODES = [
  'ComfyUI-KJNodes 1.1.4',
  'rgthree-comfy 1.0.2',
  'ComfyUI-VideoHelperSuite 1.6.1',
  'ComfyUI-Impact-Pack 8.15',
  'was-node-suite 3.0.1'
]
const PKGS = ['transformers: 4.45.2 → 4.46.1', 'accelerate 1.1.0', 'opencv-python 4.10.0']
/** What differs going from `a` to `b`, in Desktop's diff lines. */
function diff(a: Snapshot, b: Snapshot) {
  const nodes: string[] = []
  const d = b.nodes - a.nodes
  for (let i = 0; i < Math.abs(d); i++)
    nodes.push(`${d > 0 ? '+' : '−'} ${NODES[(Math.min(a.nodes, b.nodes) + i) % NODES.length]}`)
  const p = b.pkgs - a.pkgs
  const pkgs = p
    ? PKGS.slice(0, Math.min(3, Math.abs(p))).map((x, i) =>
        i ? `${p > 0 ? '+' : '−'} ${x}` : `~ ${x}`
      )
    : []
  return {
    comfy: a.comfy !== b.comfy ? `${a.comfy} → ${b.comfy}` : undefined,
    nodes,
    pkgs,
    more: Math.max(0, Math.abs(p) - 3)
  }
}
const count = (n: number, one: string): string =>
  `${n > 0 ? '+' : '−'}${Math.abs(n)} ${one}${Math.abs(n) === 1 ? '' : 's'}`
/** The line under a snapshot's name: what it is, then how much changed. */
function detail(s: Snapshot, i: number): string {
  const older = snaps[i + 1]
  const d = older ? s.nodes - older.nodes : 0
  const p = older ? s.pkgs - older.pkgs : 0
  return [
    s.label && i > 0 ? TRIGGERS[s.trigger] : s.comfy,
    d && count(d, 'node'),
    p && count(p, 'pkg')
  ]
    .filter(Boolean)
    .join(' · ')
}
const lines = (s: Snapshot, i: number): MenuLine[] => [
  { label: 'Export', icon: Download, run: () => toast('Snapshot exported.') },
  'sep',
  {
    label: 'Delete',
    icon: Trash2,
    danger: true,
    disabled: i === 0,
    run: () => deleteSnapshot(env, s.id)
  }
]
</script>

<template>
  <div class="mar-sn-bar">
    <span class="mar-bt-hint">Saved when ComfyUI starts, and before every update.</span>
    <div class="ml-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" @click="toast('Choose a snapshot file to import')"
        ><Upload :size="13" />Import</Button
      >
      <Button v-if="snaps.length" variant="ghost" size="sm" @click="toast('Snapshots exported.')"
        ><Download :size="13" />Export All</Button
      >
      <Button size="sm" @click="naming = true"><Plus :size="13" />Create Snapshot</Button>
    </div>
  </div>

  <form v-if="naming" class="mar-sn-create" @submit.prevent="create">
    <p class="mar-bt-sub mt-0">
      Saves this build’s ComfyUI, custom nodes and packages as they are now. A label is optional.
    </p>
    <div class="flex items-center gap-2">
      <Input
        v-model="label"
        placeholder="e.g. before-experiment"
        aria-label="Snapshot label"
        autofocus
        class="max-w-72"
      />
      <Button type="submit" variant="primary" size="sm">Create</Button>
      <Button type="button" variant="ghost" size="sm" @click="naming = false">Cancel</Button>
    </div>
  </form>

  <ol v-if="snaps.length" class="mar-sn-list">
    <li v-for="(s, i) in snaps" :key="s.id" class="mar-sn">
      <span class="mar-sn-when">{{ i === 0 && state.run === 'running' ? 'Now' : s.when }}</span>
      <div
        class="mar-sn-item"
        :class="i === 0 && (state.run === 'running' ? 'is-now' : 'is-latest')"
      >
        <span class="mar-sn-dot" />
        <div
          class="mar-sn-row"
          role="button"
          tabindex="0"
          :aria-expanded="open === s.id"
          @click="open = open === s.id ? undefined : s.id"
          @keydown.enter="open = open === s.id ? undefined : s.id"
        >
          <div class="min-w-0 flex-1">
            <p class="mar-sn-name">
              <span class="truncate">{{ s.label ?? TRIGGERS[s.trigger] }}</span
              ><span v-if="i === 0" class="mar-tag">Latest</span>
            </p>
            <p class="mar-sn-detail">{{ detail(s, i) }}</p>
          </div>
          <span class="mar-bt-acts" @click.stop>
            <Button v-if="i > 0" variant="ghost" size="sm" @click="restore(s)"
              ><RotateCcw :size="13" />Restore</Button
            >
            <MarItemMenu :lines="lines(s, i)" label="Snapshot actions" />
          </span>
        </div>
        <div v-if="open === s.id" class="mar-sn-body">
          <template
            v-for="part in [
              ...(snaps[i + 1]
                ? [{ title: 'What changed in this snapshot', d: diff(snaps[i + 1]!, s) }]
                : []),
              ...(i > 0
                ? [{ title: 'What restoring this would change', d: diff(snaps[0]!, s) }]
                : [])
            ]"
            :key="part.title"
          >
            <p class="mar-sn-h">{{ part.title }}</p>
            <p
              v-if="!part.d.comfy && !part.d.nodes.length && !part.d.pkgs.length"
              class="mar-bt-hint"
            >
              No changes from the previous snapshot.
            </p>
            <dl class="mar-sn-diff">
              <template v-if="part.d.comfy"
                ><dt>ComfyUI</dt>
                <dd>{{ part.d.comfy }}</dd></template
              >
              <template v-if="part.d.nodes.length"
                ><dt>Custom Nodes ({{ part.d.nodes.length }})</dt>
                <dd>
                  <span
                    v-for="n in part.d.nodes"
                    :key="n"
                    :class="n[0] === '+' ? 'is-add' : 'is-del'"
                    >{{ n }}</span
                  >
                </dd></template
              >
              <template v-if="part.d.pkgs.length"
                ><dt>Pip Packages ({{ part.d.pkgs.length + part.d.more }})</dt>
                <dd>
                  <span
                    v-for="n in part.d.pkgs"
                    :key="n"
                    :class="n[0] === '+' ? 'is-add' : n[0] === '~' ? '' : 'is-del'"
                    >{{ n }}</span
                  ><span v-if="part.d.more" class="mar-bt-hint">and {{ part.d.more }} more</span>
                </dd></template
              >
            </dl>
          </template>
          <p v-if="i === 0 && !snaps[1]" class="mar-bt-hint">The first snapshot of this build.</p>
        </div>
      </div>
    </li>
  </ol>
  <MarEmpty
    v-else
    compact
    :icon="Camera"
    title="No snapshots yet"
    text="Snapshots are captured automatically when ComfyUI starts."
    action="Create Snapshot"
    @action="naming = true"
  />
</template>
