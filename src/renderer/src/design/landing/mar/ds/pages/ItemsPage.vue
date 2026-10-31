<script setup lang="ts">
import { Copy, FileUp, Pencil, Trash2 } from 'lucide-vue-next'
import { thumb } from '../../../mock'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarItem from '../../pages/MarItem.vue'
import MarNewTile from '../../pages/MarNewTile.vue'
import type { MenuLine } from '../../pages/menu'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const LINES: MenuLine[] = [
  { label: 'Rename', icon: Pencil },
  { label: 'Duplicate', icon: Copy },
  'sep',
  { label: 'Delete', icon: Trash2, danger: true }
]
const PIC = thumb('image_flux2')
const base = {
  name: 'Product shots',
  meta: 'Local · 2h ago',
  icon: ComfyWorkflow,
  lines: LINES,
  favId: 'image_flux2',
  favKind: 'template' as const
}

const GRID = [
  { label: 'idle', props: { thumb: PIC } },
  { label: 'hover', props: { thumb: PIC }, force: 'hover' },
  { label: 'running', props: { thumb: PIC, status: 'executing' } },
  { label: 'draft (hollow dot)', props: { thumb: PIC, status: 'draft' } },
  { label: 'shared (icon on the meta line)', props: { thumb: PIC, status: 'shared' } },
  {
    label: 'shared, hover',
    props: { thumb: PIC, status: 'shared' },
    force: 'hover'
  },
  { label: 'running, hover', props: { thumb: PIC, status: 'executing' }, force: 'hover' },
  { label: 'selecting', props: { thumb: PIC, selecting: true } },
  {
    label: 'selected',
    props: { thumb: PIC, selecting: true, selected: true, status: 'completed' }
  },
  { label: 'no picture yet', props: {} },
  { label: 'renaming', props: { thumb: PIC, renaming: true } }
] as const
const LIST = [
  { label: 'idle', props: { thumb: PIC } },
  { label: 'hover', props: { thumb: PIC }, force: 'hover' },
  {
    label: 'selected (check over the thumbnail)',
    props: { thumb: PIC, selecting: true, selected: true }
  },
  { label: 'no picture yet', props: { status: 'draft' } }
] as const
</script>

<template>
  <Section
    title="Card"
    note="A library item. Hover lightens the surface and shows the star and ⋯; it never grows. Top-left is the select check's corner, always: nothing else lives there, so nothing jumps when it shows. The star and ⋯ sit top-right, a state chip bottom-left. Shared is not a state on a card: it is a small people icon before the meta line (the list keeps it in the State column). With no picture yet, the canvas's dot grid and the kind's icon."
  >
    <Cells :min="220">
      <Cell
        v-for="s in GRID"
        :key="s.label"
        :label="s.label"
        fill
        :force="'force' in s ? s.force : ''"
        target=".mar-item"
      >
        <MarItem v-bind="{ ...base, ...s.props }" />
      </Cell>
    </Cells>
  </Section>
  <Section
    title="New tile"
    note="Ends a grid with the way to add one more. Built like a card: the same picture ratio, an empty dashed slot with + and the label, and a quiet second way in on the caption line."
  >
    <Cells :min="220">
      <Cell label="idle" fill>
        <MarNewTile label="New workflow" alt-label="Import a file" :alt-icon="FileUp" />
      </Cell>
      <Cell label="hover" fill force="hover" target=".mar-add-main">
        <MarNewTile label="New workflow" alt-label="Import a file" :alt-icon="FileUp" />
      </Cell>
      <Cell label="next to a card" fill>
        <MarItem v-bind="{ ...base, thumb: PIC }" />
      </Cell>
    </Cells>
  </Section>
  <Section
    title="List row"
    note="The same item as a row: the select check sits over the thumbnail, so the row keeps its edge."
  >
    <Cells :min="420">
      <Cell
        v-for="s in LIST"
        :key="s.label"
        :label="s.label"
        fill
        :force="'force' in s ? s.force : ''"
        target=".mar-item"
      >
        <MarItem layout="list" v-bind="{ ...base, ...s.props }" />
      </Cell>
    </Cells>
  </Section>
</template>
