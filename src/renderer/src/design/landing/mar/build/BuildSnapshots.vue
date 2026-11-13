<script setup lang="ts">
import { computed, ref } from 'vue'
import { Camera, ChevronRight, Download, RotateCcw, Trash2, Upload } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import MarEmpty from '../pages/MarEmpty.vue'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'
import {
  TRIGGERS,
  isStateTrigger,
  createSnapshot,
  deleteSnapshot,
  snapshotsOf,
  stateOf,
  type Snapshot
} from './buildFacts'
import { runOp } from './buildOps'
import './buildTabs.css'

/**
 * Desktop's Snapshots tab (views/comfyUISettings/SnapshotsView.vue): a
 * vertical timeline, a dot per snapshot with its date before it, the newest
 * first, each with what took it and how much changed. Open one to
 * see what changed in it and what restoring it would change: ComfyUI's
 * version, custom nodes, pip packages. Create asks for an optional label;
 * a restore runs in the tab (buildOps.ts).
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const snaps = snapshotsOf(env)
const state = stateOf(env)
const open = ref<string | undefined>(snaps[0]?.id)
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
/** What changed since the snapshot before: added in green, removed in
 *  red, per nodes and pkgs; nothing when nothing changed. */
const delta = (i: number): { n: string; tone: 'add' | 'del'; label: string }[] => {
  const older = snaps[i + 1]
  if (!older) return []
  const d = snaps[i]!.nodes - older.nodes
  const p = snaps[i]!.pkgs - older.pkgs
  const part = (v: number, label: string) =>
    v ? [{ n: `${v > 0 ? '+' : '−'}${Math.abs(v)}`, tone: v > 0 ? 'add' : 'del', label }] : []
  return [...part(d, 'nodes'), ...part(p, 'pkgs')] as ReturnType<typeof delta>
}
/** ComfyUI moved since the snapshot before: "v0.37.2 → v0.37.4". */
const moved = (i: number): string | undefined => {
  const older = snaps[i + 1]
  return !snaps[i]!.label && older && older.comfy !== snaps[i]!.comfy ? older.comfy : undefined
}
const diffOpen = ref<string[]>([])
function toggleDiff(key: string): void {
  const at = diffOpen.value.indexOf(key)
  if (at < 0) diffOpen.value.push(key)
  else diffOpen.value.splice(at, 1)
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
const latest = computed(() => snaps[0]?.when)
</script>

<template>
  <div class="mar-sn-bar">
    <span class="mar-bt-hint">{{ latest ? `Latest: ${latest}` : 'No snapshots yet' }}</span>
    <div class="ml-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" @click="toast('Choose a snapshot file to import')"
        ><Upload :size="13" />Import</Button
      >
      <Button v-if="snaps.length" variant="ghost" size="sm" @click="toast('Snapshots exported.')"
        ><Download :size="13" />Export All</Button
      >
      <Button size="sm" @click="naming = true"><Camera :size="13" />Create Snapshot</Button>
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

  <div v-if="snaps.length" class="mar-sn-list">
    <div
      v-for="(s, i) in snaps"
      :key="s.id"
      class="mar-sn"
      :class="[
        open === s.id && 'is-open',
        i === 0 && (state.run === 'running' ? 'is-now' : 'is-latest'),
        isStateTrigger(s.trigger) && 'is-state'
      ]"
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
        <span class="mar-sn-when">{{ s.when }}</span>
        <ChevronRight :size="14" class="mar-sn-chev" />
        <span class="mar-sn-trigger">{{ TRIGGERS[s.trigger] }}</span>
        <span class="mar-sn-name"
          ><template v-if="moved(i)"
            ><span class="mar-sn-prev">{{ moved(i) }} →</span> <b>{{ s.comfy }}</b></template
          ><template v-else>{{ s.label ?? s.comfy }}</template></span
        >
        <span v-if="i === 0" class="mar-sn-latest">Latest</span>
        <span v-if="delta(i).length" class="mar-sn-delta">
          <template v-for="(d, di) in delta(i)" :key="d.label"
            ><span v-if="di" aria-hidden="true">·</span
            ><span
              ><span :class="d.tone === 'add' ? 'is-add' : 'is-del'">{{ d.n }}</span>
              {{ d.label }}</span
            ></template
          >
        </span>
        <span class="mar-bt-acts" @click.stop>
          <Button v-if="i > 0" variant="ghost" size="sm" @click="restore(s)"
            ><RotateCcw :size="13" />Restore</Button
          >
          <MarItemMenu :lines="lines(s, i)" label="Snapshot actions" />
        </span>
      </div>
      <div v-if="open === s.id" class="mar-sn-body">
        <p class="mar-sn-meta">
          {{ s.nodes }} nodes<span aria-hidden="true">·</span>{{ s.pkgs }} packages<template
            v-if="s.label"
            ><span aria-hidden="true">·</span
            ><span class="text-base-foreground">{{ s.label }}</span></template
          >
        </p>
        <div
          v-for="part in [
            ...(snaps[i + 1]
              ? [{ title: 'What changed in this snapshot', d: diff(snaps[i + 1]!, s) }]
              : []),
            ...(i > 0 ? [{ title: 'What restoring this would change', d: diff(snaps[0]!, s) }] : [])
          ]"
          :key="part.title"
        >
          <button
            type="button"
            class="mar-sn-h"
            :aria-expanded="diffOpen.includes(`${s.id}:${part.title}`)"
            @click="toggleDiff(`${s.id}:${part.title}`)"
          >
            <ChevronRight
              :size="13"
              class="mar-sn-dchev"
              :class="diffOpen.includes(`${s.id}:${part.title}`) && 'rotate-90'"
            />{{ part.title }}
          </button>
          <div v-if="diffOpen.includes(`${s.id}:${part.title}`)" class="mar-sn-diffbox">
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
          </div>
        </div>
        <p v-if="i === 0 && !snaps[1]" class="mar-bt-hint">The first snapshot of this build.</p>
      </div>
    </div>
  </div>
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
