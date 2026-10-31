<script setup lang="ts">
import { computed } from 'vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatusDot from '../../ui/StatusDot.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import { envById, fmt, fmtCompact } from '../../parts/env/env'
import { SPACES } from '../../spaces'
import type { Deployment } from '../../mock'
import { go, proto } from '../../useProto'
import '../table/table.css'

/** Deployments (Mar's proposal): the same columns as the original list,
 *  in the one table pattern (mar/table). */
const { list, projectsOf } = defineProps<{
  list: Deployment[]
  projectsOf: (envId: string) => string[]
}>()

// Deployment, [Project], [Space], Build, Endpoint, Status, Req, Errors, Spend, Trend
const grid = computed(
  () =>
    `--mar-grid: minmax(0, 1.3fr) ${proto.projects ? 'minmax(0, 0.9fr) ' : ''}${proto.spaces ? '132px ' : ''}minmax(0, 1fr) minmax(0, 1fr) 120px 64px 56px 72px 88px`
)
const spaceOf = (id?: string) => (id ? SPACES.find((s) => s.id === id) : undefined)
</script>

<template>
  <div class="mar-table" role="table" aria-label="Deployments" :style="grid">
    <div class="mar-table-head" role="row">
      <span role="columnheader">Deployment</span>
      <span v-if="proto.projects" role="columnheader">Project</span>
      <span v-if="proto.spaces" role="columnheader">Space</span>
      <span role="columnheader">Build</span>
      <span role="columnheader">Endpoint</span>
      <span role="columnheader">Status</span>
      <span role="columnheader" class="is-num">Req 7d</span>
      <span role="columnheader" class="is-num">Errors</span>
      <span role="columnheader" class="is-num">Spend 7d</span>
      <span role="columnheader" class="is-end">Trend</span>
    </div>
    <div
      v-for="d in list"
      :key="d.id"
      role="row"
      tabindex="0"
      class="mar-table-row"
      @click="go(`deployment:${d.id}`)"
      @keydown.enter="go(`deployment:${d.id}`)"
    >
      <span class="mar-table-name" role="cell">
        <span class="flex min-w-0 items-center gap-2"
          ><span class="mar-table-title min-w-0 font-mono">{{ d.name }}</span
          ><span v-if="d.stage === 'staging'" class="mar-tag">Staging</span></span
        >
        <span v-if="d.tool" class="mar-table-sub">{{ d.tool }}</span>
      </span>
      <span v-if="proto.projects" class="mar-table-cell" role="cell">{{
        projectsOf(d.envId).join(', ') || '—'
      }}</span>
      <span v-if="proto.spaces" class="mar-table-cell flex items-center gap-2" role="cell">
        <template v-if="spaceOf(d.spaceId)">
          <SpaceMark :brand="spaceOf(d.spaceId)!.brand" size="xs" />
          <span class="truncate">{{ spaceOf(d.spaceId)!.name }}</span>
        </template>
        <span v-else class="is-quiet">—</span>
      </span>
      <span class="mar-table-cell flex items-center gap-2" role="cell">
        <InstanceGlyph v-if="envById(d.envId)" :inst="envById(d.envId)!" size="xs" />
        <span class="truncate">{{ envById(d.envId)?.name }} · {{ d.version }}</span>
      </span>
      <code class="mar-table-cell is-quiet font-mono" role="cell">{{
        d.endpoint.replace('https://', '')
      }}</code>
      <span class="mar-table-cell flex items-center gap-1.5" role="cell"
        ><StatusDot :status="d.status === 'running' ? 'running' : 'idle'" />{{
          d.status === 'running' ? 'Running' : 'Scaled to zero'
        }}</span
      >
      <span class="mar-table-cell is-num" role="cell">{{ fmtCompact(d.requests7d) }}</span>
      <span
        class="mar-table-cell is-num"
        :class="d.errorRate > 1 && 'text-base-foreground'"
        role="cell"
        >{{ d.errorRate }}%</span
      >
      <span class="mar-table-cell is-num" role="cell">{{ fmt(d.spend7d) }}</span>
      <span class="is-center flex justify-end" role="cell"
        ><Sparkline :values="d.trend" :width="80" :height="20"
      /></span>
    </div>
    <div v-if="!list.length" class="mar-table-empty" role="row">
      <strong>No deployments here</strong>
      <span>Try another project or space, or deploy a build.</span>
    </div>
  </div>
</template>
