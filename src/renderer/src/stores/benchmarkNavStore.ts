import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
  /** Which column deltas are measured against. Defaults to the oldest selected. */
  const baselineRunId = ref<string | null>(null)
  /** Pending Run↔History host panel switch; consumed + cleared by the host router. */
  const panelRequest = ref<BenchmarkPanelRequest | null>(null)

  const compareCount = computed(() => compareRunIds.value.length)
  /** Compare needs ≥2 runs; the entry button stays disabled below that. */
  const canCompare = computed(() => compareCount.value >= 2)

  /**
   * Open Compare with a set of run session ids. Pass them OLDEST-FIRST so the default
   * baseline (first id) is the oldest selected (resolved decision). Caps at
   * `COMPARE_COLUMN_CAP` columns; extra selections are dropped from the tail.
   */
  function openCompare(runIds: string[], baselineId?: string | null): void {
    const capped = runIds.slice(0, COMPARE_COLUMN_CAP)
    compareRunIds.value = capped
    baselineRunId.value =
      baselineId && capped.includes(baselineId) ? baselineId : (capped[0] ?? null)
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
