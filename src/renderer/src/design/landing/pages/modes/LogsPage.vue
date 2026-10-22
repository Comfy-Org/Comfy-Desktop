<script setup lang="ts">
import { computed, ref } from 'vue'
import Card from '../../ui/Card.vue'
import PageHeader from '../../ui/PageHeader.vue'
import Select from '../../ui/Select.vue'
import { deployments } from '../../parts/env/env'

/** API requests, newest first. */
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
const rows = computed(() =>
  WHEN.map((t, i) => {
    const d = deployments.value[i % Math.max(1, deployments.value.length)]
    const code = i === 1 ? 500 : i === 5 ? 422 : 200
    return d
      ? {
          t,
          d: d.name,
          code,
          ms: `${(4 + ((i * 3.7) % 9)).toFixed(1)} s`,
          cost: `${8 + ((i * 5) % 30)} cr`
        }
      : undefined
  }).filter((r) => r && (filter.value === 'all' || r.d === filter.value))
)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader title="Logs" description="Requests to your deployments, newest first.">
      <template #actions>
        <Select
          v-model="filter"
          label="Deployment"
          class="w-64"
          :options="[
            { value: 'all', label: 'All' },
            ...deployments.map((d) => ({ value: d.name, label: d.name }))
          ]"
        />
      </template>
    </PageHeader>
    <Card class="overflow-hidden">
      <div
        class="grid h-10 grid-cols-[100px_minmax(0,1fr)_80px_90px_90px] items-center gap-4 border-b border-border-default bg-secondary-background/40 px-4 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
      >
        <span>Time</span><span>Deployment</span><span>Status</span
        ><span class="text-right">Duration</span><span class="text-right">Cost</span>
      </div>
      <div
        v-for="r in rows"
        :key="r!.t"
        class="grid min-h-11 grid-cols-[100px_minmax(0,1fr)_80px_90px_90px] items-center gap-4 border-b border-border-default px-4 font-mono text-ui last:border-b-0"
      >
        <span class="text-subtle-foreground">{{ r!.t }}</span>
        <span class="truncate">{{ r!.d }}</span>
        <span :class="r!.code === 200 ? 'text-muted-foreground' : 'text-base-foreground'">
          <span
            class="mr-1.5 inline-block size-1.5 rounded-full"
            :class="r!.code === 200 ? 'bg-status-running' : 'bg-status-danger'"
          />{{ r!.code }}
        </span>
        <span class="text-right text-muted-foreground">{{ r!.ms }}</span>
        <span class="text-right text-muted-foreground">{{ r!.cost }}</span>
      </div>
    </Card>
  </div>
</template>
