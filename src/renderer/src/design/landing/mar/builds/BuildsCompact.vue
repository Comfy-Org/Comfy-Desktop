<script setup lang="ts">
import type { ProtoInstance } from '../../mock'
import StatusDot from '../../ui/StatusDot.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import EnvLaunchButton from '../../parts/env/EnvLaunchButton.vue'
import { envKind, envStatus } from '../../parts/env/env'
import { go } from '../../useProto'
import '../table/table.css'

/** Builds, summarised (Mar's proposal): one line each with what you need
 *  to decide: is it on, where it runs, what's in it, and Open. The one
 *  table pattern (mar/table). */
defineProps<{ list: ProtoInstance[] }>()
</script>

<template>
  <div
    class="mar-table"
    role="table"
    aria-label="Builds"
    style="--mar-grid: 32px minmax(0, 1fr) 136px 136px minmax(0, 168px) 104px"
  >
    <div class="mar-table-head" role="row">
      <span role="columnheader" style="grid-column: span 2">Build</span>
      <span role="columnheader">State</span>
      <span role="columnheader">Runs on</span>
      <span role="columnheader">Contents</span>
      <span />
    </div>
    <div
      v-for="e in list"
      :key="e.id"
      role="row"
      tabindex="0"
      class="mar-table-row"
      @click="go(`environment:${e.id}`)"
      @keydown.enter="go(`environment:${e.id}`)"
    >
      <span class="is-center" role="cell"><InstanceGlyph :inst="e" size="sm" /></span>
      <span class="mar-table-title" role="cell">{{ e.name }}</span>
      <span class="mar-table-cell flex items-center gap-1.5" role="cell">
        <StatusDot :status="envStatus(e).live ? 'running' : 'idle'" />{{ envStatus(e).label }}
      </span>
      <span class="mar-table-cell" role="cell">{{
        e.kind === 'cloud' ? 'Comfy Cloud' : 'This computer'
      }}</span>
      <span class="mar-table-cell" role="cell">{{
        envKind(e) === 'managed' ? 'Every model' : `${e.models ?? 0} models · ${e.nodes ?? 0} nodes`
      }}</span>
      <span class="flex justify-end" role="cell"
        ><EnvLaunchButton :env="e" size="sm" @click.stop
      /></span>
    </div>
  </div>
</template>
