<script setup lang="ts">
import type { ProtoInstance } from '../../mock'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import { deploymentsOf, envKind, envKindLabel, isPublished, versionsOf } from '../../parts/env/env'
import { go } from '../../useProto'
import '../table/table.css'

/** Builds in Build mode (Mar's proposal): what you release, in the one
 *  table pattern (mar/table). Same columns as the original table. */
defineProps<{ list: ProtoInstance[] }>()

const runsOn = (e: ProtoInstance): string =>
  isPublished(e) ? (envKind(e) === 'local' ? 'This computer + cloud' : 'Cloud') : 'This computer'
</script>

<template>
  <div
    class="mar-table"
    role="table"
    aria-label="Builds"
    style="--mar-grid: 32px minmax(0, 1.5fr) 128px minmax(0, 1fr) minmax(0, 1fr) 92px 92px"
  >
    <div class="mar-table-head" role="row">
      <span role="columnheader" style="grid-column: span 2">Build</span>
      <span role="columnheader">Latest version</span>
      <span role="columnheader">Runs on</span>
      <span role="columnheader">Contents</span>
      <span role="columnheader" class="is-num">Deployments</span>
      <span role="columnheader" class="is-end">Edited</span>
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
      <span class="mar-table-name" role="cell">
        <span class="mar-table-title">{{ e.name }}</span>
        <span class="mar-table-sub">{{ envKindLabel(e) }}</span>
      </span>
      <span class="mar-table-cell" role="cell">
        <template v-if="versionsOf(e)[0]">
          <span class="text-base-foreground">{{ versionsOf(e)[0]!.label }}</span>
          <span v-if="!versionsOf(e)[0]!.published" class="mar-tag">Local only</span>
        </template>
        <span v-else class="is-quiet">Latest · managed</span>
      </span>
      <span class="mar-table-cell" role="cell">{{ runsOn(e) }}</span>
      <span class="mar-table-cell" role="cell">{{
        envKind(e) === 'managed' ? 'Everything' : `${e.models} models · ${e.nodes} nodes`
      }}</span>
      <span
        class="mar-table-cell is-num"
        :class="!deploymentsOf(e.id).length && 'is-quiet'"
        role="cell"
        >{{ deploymentsOf(e.id).length || '—' }}</span
      >
      <span class="mar-table-cell is-end is-quiet" role="cell">{{
        versionsOf(e)[0]?.when ?? '—'
      }}</span>
    </div>
    <div v-if="!list.length" class="mar-table-empty" role="row">
      <strong>No builds here</strong>
      <span>Try All, or set up a new build.</span>
    </div>
  </div>
</template>
