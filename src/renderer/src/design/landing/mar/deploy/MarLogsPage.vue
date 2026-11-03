<script setup lang="ts">
import { computed, ref } from 'vue'
import { ScrollText } from 'lucide-vue-next'
import Select from '../../ui/Select.vue'
import { go } from '../../useProto'
import { deployments } from '../../parts/env/env'
import MarPage from '../pages/MarPage.vue'
import MarStatus from '../pages/MarStatus.vue'

/** Logs (Mar's proposal): requests to your deployments, newest first, in
 *  the library page frame (MarPage) and the one table, with the
 *  Deployments table's anatomy: the deployment is the row's name, the
 *  result is a MarStatus, a row opens its deployment. */
const filter = ref('all')
const WHEN = [
  '12:04:31',
  '12:04:02',
  '12:03:47',
  '12:01:15',
  '11:58:40',
  '11:57:02',
  '11:51:19',
  '11:44:08',
  '11:40:55'
]
const REASON: Record<number, string> = { 200: 'OK', 422: 'Invalid input', 500: 'Server error' }
const rows = computed(() =>
  WHEN.flatMap((t, i) => {
    const d = deployments.value[i % Math.max(1, deployments.value.length)]
    if (!d) return []
    const code = i === 1 ? 500 : i === 5 ? 422 : 200
    return [
      {
        t,
        id: d.id,
        d: d.name,
        req: `req_${(0x3fa2c + i * 0x1d7).toString(16)}`,
        code,
        ms: `${(4 + ((i * 3.7) % 9)).toFixed(1)} s`,
        cost: `${8 + ((i * 5) % 30)}`
      }
    ]
  }).filter((r) => filter.value === 'all' || r.d === filter.value)
)
const OPTIONS = computed(() => [
  { value: 'all', label: 'All deployments' },
  ...deployments.value.map((d) => ({ value: d.name, label: d.name }))
])
</script>

<template>
  <MarPage
    title="Logs"
    skeleton="list"
    :state="!deployments.length ? 'empty' : undefined"
    :empty="{
      icon: ScrollText,
      title: 'No requests yet',
      text: 'Every call to a deployment shows up here, newest first.',
      action: 'See deployments'
    }"
    @action="go('deployments')"
  >
    <template #toolbar>
      <div class="ml-auto flex items-center gap-2">
        <Select v-model="filter" :options="OPTIONS" class="w-44" />
      </div>
    </template>

    <div
      class="mar-table"
      role="table"
      aria-label="Requests"
      style="--mar-grid: minmax(0, 1fr) 96px 148px 88px 88px"
    >
      <div class="mar-table-head" role="row">
        <span role="columnheader">Deployment</span>
        <span role="columnheader">Time</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" class="is-num">Duration</span>
        <span role="columnheader" class="is-num is-end">Credits</span>
      </div>
      <div
        v-for="r in rows"
        :key="r.t"
        class="mar-table-row"
        role="row"
        tabindex="0"
        @click="go(`deployment:${r.id}`)"
        @keydown.enter="go(`deployment:${r.id}`)"
      >
        <span class="mar-table-name" role="cell">
          <span class="mar-table-title font-mono">{{ r.d }}</span>
          <span class="mar-table-sub">{{ r.req }}</span>
        </span>
        <span class="mar-table-cell" role="cell">{{ r.t }}</span>
        <span class="mar-table-cell" role="cell"
          ><MarStatus
            :status="r.code === 200 ? 'completed' : 'failed'"
            :label="`${r.code} ${REASON[r.code]}`"
        /></span>
        <span class="mar-table-cell is-num" role="cell">{{ r.ms }}</span>
        <span class="mar-table-cell is-num is-end" role="cell">{{ r.cost }}</span>
      </div>
      <div v-if="!rows.length" class="mar-table-empty" role="row">
        <strong>No requests here</strong>
        <span>Try another deployment.</span>
      </div>
    </div>
  </MarPage>
</template>
