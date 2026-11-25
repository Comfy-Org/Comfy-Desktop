<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download } from 'lucide-vue-next'
import Button from '../../../../ui/Button.vue'
import PageHeader from '../../../../ui/PageHeader.vue'
import SegmentedControl from '../../../../ui/SegmentedControl.vue'
import Sparkline from '../../../../ui/Sparkline.vue'
import InstanceGlyph from '../../../../parts/InstanceGlyph.vue'
import { deployments, envById, fmt, fmtCompact } from '../../../../parts/env/env'
import { go, toast } from '../../../../useProto'
import { MEMBERS } from '../../../../mock'
import MarSeg from '../../MarSeg.vue'
import MarStatus from '../../MarStatus.vue'
import '../../../table/table.css'

const RANGES = ['24h', '7d', '30d', 'This month'] as const
const range = ref<(typeof RANGES)[number]>('7d')
type By = 'deployment' | 'model' | 'member'
const by = ref<By>('deployment')
const BY = [
  { value: 'deployment' as const, label: 'Deployment' },
  { value: 'model' as const, label: 'Model' },
  { value: 'member' as const, label: 'Member' }
]
const MODELS = [
  { name: 'Flux 1.1 Pro', kind: 'Image', runs: 1820, credits: 2140 },
  { name: 'Kling 2.1', kind: 'Video', runs: 240, credits: 1680 },
  { name: 'Wan 2.2', kind: 'Video', runs: 410, credits: 960 },
  { name: 'GPT Image', kind: 'Image', runs: 530, credits: 720 }
]
const total = computed(() =>
  by.value === 'model'
    ? MODELS.reduce((n, m) => n + m.credits, 0)
    : by.value === 'member'
      ? MEMBERS.reduce((n, m) => n + m.credits, 0)
      : deployments.value.reduce((n, d) => n + d.spend7d, 0)
)
const share = (n: number): string => `${Math.round((n / Math.max(1, total.value)) * 100)}%`
const deps = computed(() => [...deployments.value].sort((a, b) => b.spend7d - a.spend7d))
const TREND = [12, 18, 15, 22, 30, 26, 34, 29, 38, 41, 36, 44, 40, 48]
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-24">
    <PageHeader title="Usage" />
    <div class="mt-4 flex items-center justify-between gap-3">
      <SegmentedControl
        v-model="range"
        variant="contained"
        :options="RANGES.map((r) => ({ value: r, label: r }))"
      />
      <Button @click="toast('Exporting CSV…')"><Download :size="14" />Export CSV</Button>
    </div>

    <div class="mt-7 mb-8 flex items-end justify-between gap-6">
      <div>
        <p class="text-[40px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {{ fmt(total) }}
        </p>
        <p class="mt-2 text-ui text-muted-foreground">credits spent</p>
      </div>
      <Sparkline :values="TREND" :width="520" :height="56" />
    </div>

    <div class="mb-4 flex items-center gap-3">
      <span class="text-ui text-muted-foreground">Group by</span>
      <MarSeg v-model="by" :options="BY" label="Group by" />
    </div>

    <div
      v-if="by === 'deployment'"
      class="mar-table"
      role="table"
      aria-label="Spend by deployment"
      style="--mar-grid: minmax(0, 1.4fr) minmax(0, 1fr) 132px 72px 64px 88px 64px"
    >
      <div class="mar-table-head" role="row">
        <span role="columnheader">Deployment</span>
        <span role="columnheader">Build</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" class="is-num">Requests</span>
        <span role="columnheader" class="is-num">Errors</span>
        <span role="columnheader" class="is-num">Credits</span>
        <span role="columnheader" class="is-num is-end">Share</span>
      </div>
      <div
        v-for="d in deps"
        :key="d.id"
        class="mar-table-row"
        role="row"
        tabindex="0"
        @click="go(`deployment:${d.id}`)"
        @keydown.enter="go(`deployment:${d.id}`)"
      >
        <span class="mar-table-name" role="cell"
          ><span class="mar-table-title font-mono">{{ d.name }}</span></span
        >
        <span class="mar-table-cell flex items-center gap-2" role="cell">
          <InstanceGlyph v-if="envById(d.envId)" :inst="envById(d.envId)!" size="xs" />
          <span class="truncate">{{ envById(d.envId)?.name }}</span>
        </span>
        <span class="mar-table-cell" role="cell"
          ><MarStatus
            :status="d.status === 'running' ? 'running' : 'stopped'"
            :label="d.status === 'running' ? 'Running' : 'Scaled to zero'"
        /></span>
        <span class="mar-table-cell is-num" role="cell">{{ fmtCompact(d.requests7d) }}</span>
        <span
          class="mar-table-cell is-num"
          :class="d.errorRate > 1 && 'text-base-foreground'"
          role="cell"
          >{{ d.errorRate }}%</span
        >
        <span class="mar-table-cell is-num" role="cell">{{ fmt(d.spend7d) }}</span>
        <span class="mar-table-cell is-num is-end" role="cell">{{ share(d.spend7d) }}</span>
      </div>
    </div>

    <div
      v-else-if="by === 'model'"
      class="mar-table"
      role="table"
      aria-label="Spend by model"
      style="--mar-grid: minmax(0, 1.4fr) minmax(0, 1fr) 72px 88px 64px"
    >
      <div class="mar-table-head" role="row">
        <span role="columnheader">Model</span>
        <span role="columnheader">Kind</span>
        <span role="columnheader" class="is-num">Runs</span>
        <span role="columnheader" class="is-num">Credits</span>
        <span role="columnheader" class="is-num is-end">Share</span>
      </div>
      <div v-for="m in MODELS" :key="m.name" class="mar-table-row" role="row">
        <span class="mar-table-name" role="cell"
          ><span class="mar-table-title">{{ m.name }}</span></span
        >
        <span class="mar-table-cell" role="cell">{{ m.kind }}</span>
        <span class="mar-table-cell is-num" role="cell">{{ fmt(m.runs) }}</span>
        <span class="mar-table-cell is-num" role="cell">{{ fmt(m.credits) }}</span>
        <span class="mar-table-cell is-num is-end" role="cell">{{ share(m.credits) }}</span>
      </div>
    </div>

    <div
      v-else
      class="mar-table"
      role="table"
      aria-label="Spend by member"
      style="--mar-grid: minmax(0, 1.4fr) 72px 88px 64px"
    >
      <div class="mar-table-head" role="row">
        <span role="columnheader">Member</span>
        <span role="columnheader" class="is-num">Runs</span>
        <span role="columnheader" class="is-num">Credits</span>
        <span role="columnheader" class="is-num is-end">Share</span>
      </div>
      <div v-for="m in MEMBERS" :key="m.id" class="mar-table-row" role="row">
        <span class="mar-table-name" role="cell"
          ><span class="mar-table-title">{{ m.name }}</span
          ><span class="mar-table-sub">{{ m.email }}</span></span
        >
        <span class="mar-table-cell is-num" role="cell">{{ fmt(m.runs) }}</span>
        <span class="mar-table-cell is-num" role="cell">{{ fmt(m.credits) }}</span>
        <span class="mar-table-cell is-num is-end" role="cell">{{ share(m.credits) }}</span>
      </div>
    </div>
  </div>
</template>
