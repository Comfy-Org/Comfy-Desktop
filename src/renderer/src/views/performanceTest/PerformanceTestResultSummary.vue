<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { durationRows, formatDuration, summaryDurations } from '../../lib/performanceTestResults'
import type { PerformanceTestResultsSummary } from '../../types/ipc'
import { durationLabels } from './labels'

const props = defineProps<{
  summary: PerformanceTestResultsSummary
}>()

const { t } = useI18n()

const durations = computed(() => summaryDurations(props.summary))
const rows = computed(() => (durations.value ? durationRows(durations.value) : []))
const labels = computed(() => durationLabels(t))
const counts = computed(() => ({
  count: props.summary.measuredJobCount,
  failed: props.summary.failedRunCount
}))
</script>

<template>
  <div
    class="performance-test__summary grid grid-cols-[minmax(180px,max-content)_minmax(0,1fr)] items-center gap-x-12 gap-y-5 @max-[640px]:grid-cols-1"
  >
    <div class="performance-test__median flex flex-col gap-2.5">
      <span
        v-if="durations"
        class="performance-test__median-value text-[44px] leading-none font-medium tracking-[-0.02em] whitespace-nowrap text-foreground tabular-nums"
        >{{ formatDuration(durations.median) }}</span
      >
      <span class="performance-test__median-summary text-[12.5px]">{{
        durations
          ? t('performanceTest.medianSummary', counts)
          : t('performanceTest.runCounts', counts)
      }}</span>
    </div>
    <dl
      v-if="rows.length > 0"
      class="performance-test__duration-chart m-0 grid min-w-0"
      :aria-label="t('performanceTest.runDurationChart')"
    >
      <div
        v-for="row in rows"
        :key="row.key"
        class="performance-test__duration-row grid min-h-7 grid-cols-[96px_minmax(0,1fr)_72px] items-center gap-3"
        :data-highlight="row.highlight || undefined"
      >
        <dt class="text-[12px]">{{ labels[row.key] }}</dt>
        <dd class="m-0 h-1.5 overflow-hidden rounded-full bg-white/8" aria-hidden="true">
          <i
            class="block h-full rounded-[inherit]"
            :class="row.highlight ? 'bg-neutral-100' : 'bg-white/35'"
            :style="{ width: `${row.share * 100}%` }"
          />
        </dd>
        <dd
          class="m-0 text-right text-[13px] tabular-nums"
          :class="row.highlight ? 'font-medium text-foreground' : 'text-[var(--text-primary)]'"
        >
          {{ formatDuration(row.seconds) }}
        </dd>
      </div>
    </dl>
  </div>
</template>
