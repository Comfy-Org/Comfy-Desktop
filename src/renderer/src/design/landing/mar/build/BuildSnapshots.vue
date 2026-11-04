<script setup lang="ts">
import { Camera, Download, RotateCcw, Trash2 } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import MarEmpty from '../pages/MarEmpty.vue'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'
import {
  TRIGGERS,
  createSnapshot,
  deleteSnapshot,
  restoreSnapshot,
  snapshotsOf
} from './buildFacts'
import '../table/table.css'
import './buildTabs.css'

/**
 * Production's Snapshots tab (SnapshotTab) as the one table: each
 * ComfyUI-Manager snapshot with what took it, its ComfyUI, node and
 * package counts and when; Restore on the row, Export and Delete in ⋯.
 * Create Snapshot, Import and Export All sit on the page's tab row.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const snaps = snapshotsOf(env)

const lines = (id: string, current: boolean): MenuLine[] => [
  { label: 'Export', icon: Download, run: () => toast('Snapshot exported.') },
  'sep',
  {
    label: 'Delete',
    icon: Trash2,
    danger: true,
    disabled: current,
    run: () => deleteSnapshot(env, id)
  }
]
</script>

<template>
  <div
    v-if="snaps.length"
    class="mar-table"
    role="table"
    aria-label="Snapshot History"
    style="--mar-grid: minmax(0, 1fr) 120px 80px 96px 120px 128px"
  >
    <div class="mar-table-head" role="row">
      <span role="columnheader">Snapshot</span>
      <span role="columnheader">ComfyUI</span>
      <span role="columnheader" class="is-num">Nodes</span>
      <span role="columnheader" class="is-num">Packages</span>
      <span role="columnheader">Captured</span>
      <span role="columnheader" class="is-end" />
    </div>
    <div v-for="(s, i) in snaps" :key="s.id" role="row" class="mar-table-row cursor-default">
      <span class="mar-table-name" role="cell">
        <span class="mar-table-title"
          >{{ s.label ?? TRIGGERS[s.trigger]
          }}<span v-if="i === 0" class="mar-tag ml-2">Current</span></span
        >
        <span v-if="s.label" class="mar-table-sub">{{ TRIGGERS[s.trigger] }}</span>
      </span>
      <span class="mar-table-cell" role="cell">{{ s.comfy }}</span>
      <span class="mar-table-cell is-num" role="cell">{{ s.nodes }}</span>
      <span class="mar-table-cell is-num" role="cell">{{ s.pkgs }}</span>
      <span class="mar-table-cell" role="cell">{{ s.when }}</span>
      <span class="mar-table-cell is-end is-center mar-bt-acts" role="cell">
        <Button v-if="i > 0" variant="ghost" size="sm" @click="restoreSnapshot(env, s.id)"
          ><RotateCcw :size="13" />Restore</Button
        >
        <MarItemMenu :lines="lines(s.id, i === 0)" label="Snapshot actions" />
      </span>
    </div>
  </div>
  <MarEmpty
    v-else
    compact
    :icon="Camera"
    title="No snapshots yet"
    text="Snapshots are captured automatically when ComfyUI starts."
    action="Create Snapshot"
    @action="createSnapshot(env)"
  />
</template>
