<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PerformanceTestStage } from '../../composables/usePerformanceTestRun'

const SEGMENTED_TRACK_LIMIT = 30

const props = defineProps<{
  stage: PerformanceTestStage
  completedRuns: number
  totalRuns: number
  warmupRuns: number
}>()

const { t } = useI18n()

const isRunning = computed(() => props.stage === 'running')
const currentRun = computed(() => Math.min(props.completedRuns + 1, props.totalRuns))
const heading = computed(() => {
  if (props.stage === 'starting') return t('performanceTest.startingBuild')
  if (props.stage === 'running') {
    return t('performanceTest.runNumber', { current: currentRun.value, total: props.totalRuns })
  }
  return t('performanceTest.stopping')
})
const detail = computed(() => {
  if (!isRunning.value) return ''
  if (currentRun.value <= props.warmupRuns) return t('performanceTest.runPhaseWarmup')
  return t('performanceTest.runPhaseMeasured', {
    current: currentRun.value - props.warmupRuns,
    total: props.totalRuns - props.warmupRuns
  })
})
const progressPercent = computed(() =>
  props.totalRuns > 0 ? Math.round((props.completedRuns / props.totalRuns) * 100) : 0
)

function segmentClass(run: number): string {
  if (run <= props.completedRuns) return run <= props.warmupRuns ? 'bg-white/40' : 'bg-neutral-100'
  if (isRunning.value && run === props.completedRuns + 1) return 'animate-pulse bg-white/25'
  return 'bg-white/8'
}
</script>

<template>
  <div class="performance-test__progress grid gap-4" :data-stage="stage">
    <div class="flex items-baseline gap-2.5">
      <span
        class="performance-test__progress-heading text-[22px] leading-none font-medium text-foreground tabular-nums"
        >{{ heading }}</span
      >
      <span v-if="detail" class="performance-test__progress-detail tabular-nums">{{ detail }}</span>
    </div>
    <div
      class="performance-test__progress-track flex h-1.5 gap-1"
      role="progressbar"
      :aria-label="t('performanceTest.runProgress')"
      :aria-valuenow="completedRuns"
      aria-valuemin="0"
      :aria-valuemax="totalRuns"
      :aria-valuetext="detail ? `${heading}, ${detail}` : heading"
    >
      <template v-if="totalRuns <= SEGMENTED_TRACK_LIMIT">
        <i
          v-for="run in totalRuns"
          :key="run"
          class="block h-full flex-1 rounded-[3px] transition-colors duration-[180ms]"
          :class="segmentClass(run)"
        />
      </template>
      <span v-else class="block h-full flex-1 overflow-hidden rounded-[3px] bg-white/8">
        <i
          class="block h-full rounded-[inherit] bg-neutral-100 transition-[width] duration-[180ms]"
          :style="{ width: `${progressPercent}%` }"
        />
      </span>
    </div>
  </div>
</template>
