import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { PerformanceTestBenchmark } from '../types/ipc'

/**
 * Benchmark-area navigation (design §2 IA).
 *
 * The benchmark area is three screens behind one entry: **Run** (PerformanceTestView),
 * **History** (BenchmarksView), and the pushed **Compare** state (BenchmarkCompareView).
 * Run ↔ History is a host panel switch (`performance-test` ↔ `benchmarks`); Compare is a
 * pushed state WITHIN the benchmarks panel.
 *
 * This store is the single owner of that routing + the compare selection, so the two
 * view engineers (History, Compare) only consume these actions and never touch the host
 * router (`PanelApp` / `usePanelOverlays`). PanelApp watches `panelRequest` to perform the
 * Run↔History switch, and renders Compare vs History off `screen`.
 */
export type BenchmarkScreen = 'history' | 'compare'

/** Host panel keys the segmented control can request (mirrors `PanelKey`). */
export type BenchmarkPanelRequest = 'performance-test' | 'benchmarks'

/** Compare caps at 5 columns for legibility + export width (resolved decision). */
export const COMPARE_COLUMN_CAP = 5

export const useBenchmarkNavStore = defineStore('benchmarkNav', () => {
  /** Which screen the benchmarks panel body shows. */
  const screen = ref<BenchmarkScreen>('history')
  /** Session ids selected for comparison, oldest-first (the baseline default). */
  const compareRunIds = ref<string[]>([])
  /**
   * The resolved run objects for the compare columns, index-aligned with
   * `compareRunIds` (oldest-first, same cap). History passes these in so Compare
   * reads real `PerformanceTestBenchmark` objects (`coreBenchmark` + recomputed
   * `steadyStateItPerS`) instead of re-listing them from disk.
   */
  const compareRuns = ref<PerformanceTestBenchmark[]>([])
  /** Which column deltas are measured against. Defaults to the oldest selected. */
  const baselineRunId = ref<string | null>(null)
  /** Pending Run↔History host panel switch; consumed + cleared by the host router. */
  const panelRequest = ref<BenchmarkPanelRequest | null>(null)

  const compareCount = computed(() => compareRunIds.value.length)
  /** Compare needs ≥2 runs; the entry button stays disabled below that. */
  const canCompare = computed(() => compareCount.value >= 2)

  /**
   * Open Compare with a set of run OBJECTS. Pass them OLDEST-FIRST. Caps at
   * `COMPARE_COLUMN_CAP` columns by keeping the MOST RECENT selections (trimming the
   * oldest from the head), so an over-cap selection surfaces the newest runs rather
   * than the oldest — while the kept columns stay oldest-first. The default baseline
   * is therefore the oldest of the kept runs (first column). Stores both the ids and
   * the resolved objects so Compare never re-lists from disk.
   */
  function openCompare(runs: PerformanceTestBenchmark[], baselineId?: string | null): void {
    const capped = runs.slice(-COMPARE_COLUMN_CAP)
    const cappedIds = capped.map((run) => run.id)
    compareRuns.value = capped
    compareRunIds.value = cappedIds
    baselineRunId.value =
      baselineId && cappedIds.includes(baselineId) ? baselineId : (cappedIds[0] ?? null)
    screen.value = 'compare'
  }

  /** Re-point every delta chip at a different column without reordering columns. */
  function setBaseline(runId: string | null): void {
    baselineRunId.value = runId
  }

  /** Leave Compare, returning to the History list (selection is retained). */
  function backToHistory(): void {
    screen.value = 'history'
  }

  /** Clear the compare selection + baseline (e.g. after an export or on unmount). */
  function clearSelection(): void {
    compareRunIds.value = []
    compareRuns.value = []
    baselineRunId.value = null
  }

  /** Request the Run panel via the host router (segmented control → Run). */
  function goToRun(): void {
    panelRequest.value = 'performance-test'
  }

  /** Request the History panel via the host router (segmented control → History). */
  function goToHistory(): void {
    panelRequest.value = 'benchmarks'
  }

  /** Host router consumes and clears any pending Run↔History switch. */
  function consumePanelRequest(): BenchmarkPanelRequest | null {
    const request = panelRequest.value
    panelRequest.value = null
    return request
  }

  return {
    screen,
    compareRunIds,
    compareRuns,
    baselineRunId,
    panelRequest,
    compareCount,
    canCompare,
    openCompare,
    setBaseline,
    backToHistory,
    clearSelection,
    goToRun,
    goToHistory,
    consumePanelRequest
  }
})
