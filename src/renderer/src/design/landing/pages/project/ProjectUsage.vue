<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Meter from '../../ui/Meter.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { toast } from '../../useProto'
import { MEMBERS } from '../../mock'

/** Credits spent in the project, per member against their limit. */
const { personal = false } = defineProps<{ personal?: boolean }>()

const ranges = ['24h', '7d', '30d', 'This month', '3 months', '12 months', 'Custom range'] as const
const range = ref<(typeof ranges)[number]>('This month')
const scale = computed(
  () =>
    ({
      '24h': 0.05,
      '7d': 0.3,
      '30d': 0.9,
      'This month': 1,
      '3 months': 2.7,
      '12 months': 9.5,
      'Custom range': 1
    })[range.value]
)

const rows = computed(() => [
  ...MEMBERS.filter((m) => !personal || m.you).map((m) => ({
    key: m.id,
    name: m.name,
    email: m.email,
    runs: Math.round(m.runs * scale.value),
    credits: Math.round(m.credits * scale.value),
    limit: m.limit
  })),
  ...(personal
    ? []
    : [
        {
          key: 'api',
          name: 'API keys / unattributed',
          email: '',
          runs: Math.round(6 * scale.value),
          credits: Math.round(655 * scale.value),
          limit: 2000
        }
      ])
])
const total = computed(() => rows.value.reduce((n, r) => n + r.credits, 0))
const fmt = (n: number): string => n.toLocaleString('en-US')
</script>

<template>
  <div class="mt-4 flex items-center justify-between gap-3">
    <SegmentedControl
      v-model="range"
      variant="contained"
      :options="ranges.map((r) => ({ value: r, label: r }))"
    />
    <Button @click="toast('Exporting CSV…')"><Download :size="14" />Export CSV</Button>
  </div>

  <div class="mt-7 mb-6">
    <p class="text-[40px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
      {{ fmt(total) }}
    </p>
    <p class="mt-2 text-ui text-muted-foreground">credits spent</p>
  </div>

  <Card class="overflow-hidden">
    <div
      class="grid h-11 grid-cols-[minmax(0,1fr)_90px_110px_minmax(220px,0.9fr)] items-center gap-4 border-b border-border-default bg-secondary-background/40 px-5 text-ui text-subtle-foreground"
    >
      <span>Member</span><span class="text-right">Runs</span><span class="text-right">Credits</span
      ><span class="text-right">Limit</span>
    </div>
    <div
      v-for="r in rows"
      :key="r.key"
      class="grid min-h-15 grid-cols-[minmax(0,1fr)_90px_110px_minmax(220px,0.9fr)] items-center gap-4 border-b border-border-default px-5 last:border-b-0"
    >
      <div class="min-w-0">
        <p class="truncate text-ui">{{ r.name }}</p>
        <p v-if="r.email" class="truncate text-ui text-subtle-foreground">{{ r.email }}</p>
      </div>
      <span class="text-right text-muted-foreground tabular-nums">{{ r.runs }}</span>
      <span class="text-right font-medium tabular-nums">{{ fmt(r.credits) }}</span>
      <div class="flex items-center justify-end gap-3">
        <span class="text-ui text-subtle-foreground tabular-nums"
          >{{ fmt(r.credits) }} of {{ fmt(r.limit) }}</span
        >
        <Meter :value="r.credits" :max="r.limit" class="w-32" />
      </div>
    </div>
  </Card>
</template>
