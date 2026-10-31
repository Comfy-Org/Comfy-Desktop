<script setup lang="ts">
import { Copy, Pencil, Trash2 } from 'lucide-vue-next'
import { thumb } from '../../../mock'
import { instances } from '../../../useProto'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import BuildsTable from '../../builds/BuildsTable.vue'
import MarItem from '../../pages/MarItem.vue'
import type { MenuLine } from '../../pages/menu'
import Section from '../kit/Section.vue'
import '../../table/table.css'

const LINES: MenuLine[] = [
  { label: 'Rename', icon: Pencil },
  { label: 'Duplicate', icon: Copy },
  'sep',
  { label: 'Delete', icon: Trash2, danger: true }
]
const ROWS = [
  {
    name: 'hero-shot-v4',
    meta: 'This computer',
    pic: 'image_flux2',
    project: 'Hero shots',
    size: '2.4 MB',
    when: '12 min ago',
    status: 'executing'
  },
  {
    name: 'rice-terraces-i2v',
    meta: 'Cloud',
    pic: 'video_ltx2_5_i2v',
    project: 'My first project',
    size: '18.2 MB',
    when: '1 hour ago',
    selected: true
  },
  {
    name: 'product-relight',
    meta: 'Cloud',
    pic: 'image_qwen_image_edit_2511',
    project: 'Product campaign',
    size: '640 KB',
    when: 'Yesterday',
    status: 'shared'
  }
] as const
</script>

<template>
  <Section
    title="Data table"
    note="Builds in Build mode. One grid for the head and the rows; numbers on the right; the last column ends on the right."
  >
    <BuildsTable :list="instances" />
  </Section>
  <Section
    title="Item rows"
    note="A library page's list view: picture, name over a quiet line, the page's columns, state, row tools. The other cells sit on the name's baseline."
  >
    <div class="mar-table is-items" style="--mar-cols: minmax(0, 180px) 88px 112px">
      <div class="mar-table-head">
        <span>Name</span><span>Project</span><span class="is-num">Size</span><span>Made</span
        ><span class="is-end">State</span><span />
      </div>
      <MarItem
        v-for="r in ROWS"
        :key="r.name"
        layout="list"
        :name="r.name"
        :meta="r.meta"
        :thumb="thumb(r.pic)"
        :icon="ComfyWorkflow"
        :status="'status' in r ? r.status : undefined"
        :selected="'selected' in r"
        :selecting="false"
        :lines="LINES"
      >
        <template #cols>
          <span class="mar-item-col">{{ r.project }}</span>
          <span class="mar-item-col is-num">{{ r.size }}</span>
          <span class="mar-item-col">{{ r.when }}</span>
        </template>
      </MarItem>
    </div>
  </Section>
  <Section title="Empty" note="One quiet row in the table's place, under the head.">
    <BuildsTable :list="[]" />
  </Section>
</template>
