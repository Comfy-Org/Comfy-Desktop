<script setup lang="ts">
/**
 * Read-only single-run detail screen (design §7). Pushed from a History row ("Open" /
 * row-click), mirroring how Compare is pushed within the benchmarks panel. It renders
 * the shared <BenchmarkResultDashboard> from the selected run's data and offers a header
 * with Back to History, Run again, and Export image.
 *
 * No run controls live here — this is a historical view. Export reuses the single-run
 * PNG path (`buildPerformanceTestResultsSvg` → `createResultsPng` → `exportResultsImage`)
 * so the detail image is identical to the one the live Run view produces.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BenchmarkResultDashboard from '../components/BenchmarkResultDashboard.vue'
import { buildPerformanceTestResultsSvg, createResultsPng } from '../lib/performanceTestResultsSvg'
import { useBenchmarkNavStore } from '../stores/benchmarkNavStore'
import type { PerformanceTestResultsSummary, PerformanceTestStatistics } from '../types/ipc'

const { t } = useI18n()
const benchmarkNav = useBenchmarkNavStore()

const run = computed(() => benchmarkNav.detailRun)

/** The run's full result summary (the stored `results.json`), merged with the reliable
 *  top-level benchmark fields so the dashboard reads consistent context. */
const summary = computed<PerformanceTestResultsSummary | null>(() => {
  const current = run.value
  if (!current) return null
  const result = current.result as unknown as PerformanceTestResultsSummary
  return {
    ...result,
    createdAt: current.createdAt ?? result.createdAt,
    instance: current.instance,
    workspace: current.workspace,
    workflowName: current.workflowName,
    fastestJobDurationSeconds: current.fastestJobDurationSeconds,
    slowestJobDurationSeconds: current.slowestJobDurationSeconds,
    averageJobDurationSeconds: current.averageJobDurationSeconds,
    medianJobDurationSeconds: current.medianJobDurationSeconds,
    measuredJobCount: current.measuredJobCount,
    coreBenchmark: current.coreBenchmark ?? result.coreBenchmark ?? null
  }
})

/** Run-duration statistics reconstructed from the summary's aggregate fields; `null`
 *  when any aggregate is missing so the duration chart degrades honestly. */
const statistics = computed<PerformanceTestStatistics | null>(() => {
  const value = summary.value
  if (!value) return null
  const { fastestJobDurationSeconds, slowestJobDurationSeconds } = value
  const { averageJobDurationSeconds, medianJobDurationSeconds } = value
  if (
    fastestJobDurationSeconds == null ||
    slowestJobDurationSeconds == null ||
    averageJobDurationSeconds == null ||
    medianJobDurationSeconds == null
  ) {
    return null
  }
  return {
    fastest: { jobId: '', durationSeconds: fastestJobDurationSeconds },
    slowest: { jobId: '', durationSeconds: slowestJobDurationSeconds },
    averageDurationSeconds: averageJobDurationSeconds,
    medianDurationSeconds: medianJobDurationSeconds,
    measuredJobCount: value.measuredJobCount
  }
})

const isExportingImage = ref(false)
const exportError = ref<string | null>(null)

function runAgain(): void {
  const current = run.value
  if (current) benchmarkNav.requestRunAgain(current)
}

async function exportImage(): Promise<void> {
  const value = summary.value
  if (!value) return
  isExportingImage.value = true
  exportError.value = null
  try {
    const svg = buildPerformanceTestResultsSvg(value, t)
    if (!svg) throw new Error(t('performanceTest.exportImageFailed'))
    const png = await createResultsPng(svg)
    const result = await window.api.exportResultsImage(png, 'performance-test')
    if (!result.ok && !result.canceled) {
      exportError.value = result.message || t('performanceTest.exportImageFailed')
    }
  } catch (error) {
    exportError.value = (error as Error)?.message || t('performanceTest.exportImageFailed')
  } finally {
    isExportingImage.value = false
  }
}
</script>

<template>
  <section class="benchmark-detail" data-testid="benchmark-detail">
    <header class="benchmark-detail__header">
      <button
        type="button"
        class="benchmark-detail__back"
        data-testid="benchmark-detail-back"
        @click="benchmarkNav.backToHistory()"
      >
        ← {{ t('benchmarks.compare.backToHistory') }}
      </button>
      <h1 class="benchmark-detail__title">{{ run?.workflowName }}</h1>
      <span class="benchmark-detail__spacer" />
      <button
        type="button"
        class="benchmark-detail__btn"
        data-testid="benchmark-detail-runagain"
        @click="runAgain"
      >
        {{ t('benchmarks.menuRunAgain') }}
      </button>
      <button
        type="button"
        class="benchmark-detail__btn"
        :disabled="isExportingImage"
        data-testid="benchmark-detail-export"
        @click="exportImage"
      >
        {{ t('benchmarks.compare.exportImage') }}
      </button>
    </header>

    <p v-if="exportError" class="benchmark-detail__error" role="alert">{{ exportError }}</p>

    <div class="benchmark-detail__body">
      <BenchmarkResultDashboard
        :core-benchmark="run?.coreBenchmark ?? null"
        :steady-state-it-per-s="run?.steadyStateItPerS ?? null"
        :summary="summary"
        :statistics="statistics"
      />
    </div>
  </section>
</template>

<style scoped>
.benchmark-detail {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  overflow-y: auto;
  color: var(--text);
}

.benchmark-detail__header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.benchmark-detail__spacer {
  flex: 1;
}

.benchmark-detail__back {
  border: 1px solid var(--chooser-surface-border);
  border-radius: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: var(--chooser-surface-bg);
  color: var(--text);
  cursor: pointer;
}

.benchmark-detail__back:hover {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.benchmark-detail__back:focus-visible,
.benchmark-detail__btn:focus-visible {
  outline: 2px solid var(--focus-ring);
}

.benchmark-detail__title {
  margin: 0;
  overflow: hidden;
  font-size: 1.125rem;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.benchmark-detail__btn {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 0.5rem;
  background: var(--chooser-surface-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.benchmark-detail__btn:hover {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.benchmark-detail__btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.benchmark-detail__error {
  margin: 0;
  color: var(--danger);
  font-size: 12.5px;
}

.benchmark-detail__body {
  min-width: 0;
}
</style>
