<script setup lang="ts">
import { computed } from 'vue'
import { instances } from '../../useProto'
import { USER } from '../../mock'
import { fmt, fmtGpu, statsOf } from '../../parts/env/env'

/**
 * 10 · Pulse: this week at a glance, under the prompt. Four tiles, each a
 * figure, a grey or green change chip and a sparkline: credits left, runs,
 * GPU time and success rate. Runs and GPU time add up the builds you can
 * see; credits and success rate are mock figures.
 */
interface Tile {
  label: string
  value: string
  delta: string
  up: boolean
  trend: number[]
}

const week = computed(() => instances.value.map(statsOf))
const daily = computed(() =>
  Array.from({ length: 7 }, (_, d) => week.value.reduce((n, s) => n + (s.trend[d] ?? 0), 0))
)

const tiles = computed<Tile[]>(() => {
  const runs = week.value.reduce((n, s) => n + s.runs7d, 0)
  const gpu = week.value.reduce((n, s) => n + s.gpuMin7d, 0)
  return [
    {
      label: 'Credits',
      value: USER.credits,
      delta: '−1,240',
      up: false,
      trend: [15.1, 14.9, 14.95, 14.5, 14.2, 14.3, 13.9]
    },
    { label: 'Runs', value: fmt(runs), delta: '+18%', up: true, trend: daily.value },
    {
      label: 'GPU time',
      value: fmtGpu(gpu),
      delta: '+0.8 h',
      up: true,
      trend: daily.value.map((v, i) => v * (0.8 + ((i * 7) % 5) / 10))
    },
    {
      label: 'Success rate',
      value: '97%',
      delta: '+2%',
      up: true,
      trend: [92, 94, 93, 95, 96, 96.5, 97]
    }
  ]
})

/** Line through the week, scaled to its own range so the shape reads. */
function path(values: number[]): string {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const step = 100 / Math.max(1, values.length - 1)
  return values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${(i * step).toFixed(2)} ${(36 - ((v - lo) / span) * 32).toFixed(2)}`
    )
    .join(' ')
}
</script>

<template>
  <div class="mt-6 grid grid-cols-4 gap-3">
    <div
      v-for="t in tiles"
      :key="t.label"
      class="p10-tile relative h-30 min-w-0 overflow-hidden rounded-[16px] px-[18px] pt-4"
    >
      <p class="text-[12px] leading-[1.4] text-muted-foreground">{{ t.label }}</p>
      <p
        class="mt-1.5 text-[28px] leading-[1.12] font-semibold tracking-[-0.02em] text-base-foreground tabular-nums"
      >
        {{ t.value }}
      </p>
      <span
        :class="[
          'absolute bottom-4 left-[18px] inline-flex h-[22px] items-center rounded-[6px] px-1.5 text-[11px] font-medium tabular-nums',
          t.up ? 'p10-up' : 'p10-flat'
        ]"
        >{{ t.delta }}</span
      >
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        :class="[
          'absolute right-[17px] bottom-[18px] h-10 w-[45%] overflow-visible',
          t.up ? 'text-status-running' : 'text-muted-foreground'
        ]"
        aria-hidden="true"
      >
        <path
          :d="path(t.trend)"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.p10-tile {
  background-color: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(24px);
}
.p10-up {
  color: var(--color-status-running);
  background-color: color-mix(in oklch, var(--color-status-running) 14%, transparent);
}
.p10-flat {
  color: var(--color-muted-foreground);
  background-color: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
</style>
