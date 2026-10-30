<script setup lang="ts">
import { Copy, Pencil, Trash2 } from 'lucide-vue-next'
import { thumb } from '../../../mock'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarItem from '../../pages/MarItem.vue'
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
const base = { name: 'Product shots', meta: 'Local · 2h ago', icon: ComfyWorkflow, lines: LINES }

const GRID = [
  { label: 'idle', props: { thumb: PIC } },
  { label: 'hover', props: { thumb: PIC, fav: false }, force: 'hover' },
  { label: 'running', props: { thumb: PIC, status: 'executing' } },
  { label: 'unsaved (hollow dot)', props: { thumb: PIC, status: 'draft' } },
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
  { label: 'hover', props: { thumb: PIC, fav: false }, force: 'hover' },
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
    note="A library item. Hover lightens the surface and shows the star and ⋯; it never grows. The state chip sits top-left and moves right when the select check shows. With no picture yet, the canvas's dot grid and the kind's icon."
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
