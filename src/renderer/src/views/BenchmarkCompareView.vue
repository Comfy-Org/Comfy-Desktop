<script setup lang="ts">
// PLACEHOLDER — foundation scaffold only. The Compare view engineer fills this in
// (design §4: columns, baseline selector, three-band metrics table, delta chips,
// cross-workflow honesty, and the paired/overlaid charts).
//
// What is already wired for you here:
//   - Routing: this view mounts when `benchmarkNav.screen === 'compare'` (see PanelApp).
//     `benchmarkNav.backToHistory()` returns to History; `goToRun()` opens the Run panel.
//   - Selection: `benchmarkNav.compareRunIds` (oldest-first, capped at COMPARE_COLUMN_CAP)
//     and `benchmarkNav.baselineRunId` (default = oldest selected). `setBaseline(id)` repoints.
//   - Pure helpers to build against: `buildBenchmarkCsv` / `buildBenchmarkJson`
//     (lib/benchmarkExport) and `buildMultiSeriesChart` / `buildCeilingLines` /
//     `buildOpTimeline` (lib/benchmarkCharts). Export IPCs: `window.api.exportBenchmarkData`
//     (CSV/JSON) and `window.api.exportResultsImage(png, 'benchmark-comparison', dir)`.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkNavStore } from '../stores/benchmarkNavStore'

const { t } = useI18n()
const benchmarkNav = useBenchmarkNavStore()

const runCount = computed(() => benchmarkNav.compareCount)
</script>

<template>
  <section class="benchmark-compare">
    <header class="benchmark-compare__header">
      <button type="button" class="benchmark-compare__back" @click="benchmarkNav.backToHistory()">
        {{ t('benchmarks.compare.backToHistory') }}
      </button>
      <h1 class="benchmark-compare__title">
        {{ t('benchmarks.compare.title', { count: runCount }) }}
      </h1>
    </header>

    <p class="benchmark-compare__hint">
      {{ t('benchmarks.compare.pickMore') }}
    </p>
  </section>
</template>

<style scoped>
.benchmark-compare {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  color: var(--neutral-100);
}

.benchmark-compare__header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.benchmark-compare__back {
  border: 1px solid var(--chooser-surface-border);
  border-radius: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: var(--chooser-surface-bg);
  color: var(--neutral-100);
  cursor: pointer;
}

.benchmark-compare__back:hover {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.benchmark-compare__back:focus-visible {
  outline: 2px solid var(--focus-ring);
}

.benchmark-compare__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.benchmark-compare__hint {
  margin: 0;
  color: var(--text-muted);
}
</style>
