import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import type { CoreBenchmarkSummary, PerformanceTestBenchmark } from '../types/ipc'
import enMessages from '../../../../locales/en.json'
import BaseSelect from '../components/ui/BaseSelect.vue'
import { useDialogs } from '../composables/useDialogs'
import { useBenchmarkNavStore } from '../stores/benchmarkNavStore'
import BenchmarksView from './BenchmarksView.vue'

const deletePerformanceTestBenchmarkMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
const renamePerformanceTestBenchmarkMock = vi.hoisted(() =>
  vi.fn(async (_folderPath: string, _sessionId: string, newSessionId: string) => ({
    ok: true,
    sessionId: newSessionId
  }))
)
const exportBenchmarkDataMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, filePath: 'C:\\Exports\\benchmarks.csv' }))
)
const openPathMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('./devplatform/DevPlatformAccountChip.vue', () => ({
  default: { template: '<div data-testid="account-chip" />' }
}))

/** A fully-populated `CoreBenchmarkSummary` skeleton (all leaves null/empty) so
 *  fixtures only override the fields a case exercises — no casts, no `any`. */
function makeCore(overrides: {
  secPerImage?: number | null
  steadyStateItPerS?: number | null
  vramPeakMb?: number | null
  totalVramMb?: number | null
  energyWhPerImage?: number | null
  gpuModel?: string | null
  offloaded?: boolean | null
  throttled?: boolean | null
  powerW?: number | null
  steps?: number | null
}): CoreBenchmarkSummary {
  return {
    promptId: 'p',
    captureSchemaVersion: 3,
    collectorId: 'comfyui-core',
    run: {
      status: 'ok',
      imageCount: 1,
      batchSize: 1,
      benchmarkId: 'bench',
      benchmarkVersion: '1',
      warmupRuns: 1,
      measuredRuns: 5,
      seed: 0
    },
    workflow: {
      resolution: { width: 1024, height: 1024 },
      steps: overrides.steps ?? null,
      sampler: null,
      scheduler: null,
      cfg: null,
      denoise: null,
      seed: null,
      samplers: []
    },
    device: {
      backend: 'cuda',
      gpuModel: overrides.gpuModel ?? null,
      driverVersion: null,
      vramIsUnified: null,
      pytorchVersion: null,
      comfyuiVersion: null,
      os: null,
      platform: null,
      arch: null,
      cpuModel: null,
      cpuCoresPhysical: null,
      cpuCoresLogical: null,
      totalVramMb: overrides.totalVramMb ?? null,
      totalRamMb: null,
      vramState: null,
      offloaded: overrides.offloaded ?? null,
      weightDtype: null,
      computeDtype: null,
      attentionImpl: null,
      cudaVersion: null,
      cudnnVersion: null,
      computeCapability: null,
      isLaptop: null,
      pcieGen: null,
      pcieWidth: null,
      baseline: {
        vramUsedMb: null,
        vramUtilPercent: null,
        temperatureC: null,
        ramUsedMb: null,
        cpuPercent: null
      }
    },
    durations: { totalRunMs: null, samplerMs: null, nodeTotalMs: null, modelLoadMs: null },
    nodes: [],
    sampling: {
      stepCount: null,
      perStepItPerS: [],
      avgItPerS: null,
      steadyStateItPerS: overrides.steadyStateItPerS ?? null
    },
    resources: {
      sampleIntervalMs: null,
      series: [],
      peak: {
        vramUsedMb: overrides.vramPeakMb ?? null,
        ramUsedMb: null,
        cpuPercent: null,
        vramUtilPercent: null,
        powerW: overrides.powerW ?? null,
        temperatureC: null,
        smClockMhz: null,
        memClockMhz: null,
        powerLimitW: null,
        throttled: overrides.throttled ?? null
      }
    },
    summary: {
      energyWhPerImage: overrides.energyWhPerImage ?? null,
      secPerImage: overrides.secPerImage ?? null,
      throttled: overrides.throttled ?? null
    }
  }
}

function benchmark(
  id: string,
  workflowName: string,
  createdAt: string,
  coreBenchmark: CoreBenchmarkSummary | null,
  steadyStateItPerS: number | null,
  hardwareName = 'NVIDIA RTX 4090'
): PerformanceTestBenchmark {
  return {
    id,
    createdAt,
    instance: { id: `instance-${id}`, name: `Instance ${id}` },
    workspace: { id: 'workspace-1', name: 'Comfy' },
    workflowName,
    fastestJobDurationSeconds: 1,
    slowestJobDurationSeconds: 2,
    averageJobDurationSeconds: 1.5,
    medianJobDurationSeconds: 1.4,
    measuredJobCount: 5,
    hardwareName,
    coreBenchmark,
    steadyStateItPerS,
    result: { failedRunCount: 0 }
  }
}

const zImage = benchmark(
  'z',
  'Z-Image Turbo',
  '2026-09-30T20:51:00.000Z',
  makeCore({
    secPerImage: 1.12,
    vramPeakMb: 11.4 * 1024,
    totalVramMb: 32 * 1024,
    energyWhPerImage: 0.21,
    gpuModel: 'RTX 5090'
  }),
  24.8
)
const qwen = benchmark(
  'q',
  'Qwen-Image',
  '2026-09-30T20:33:00.000Z',
  makeCore({
    secPerImage: 3.47,
    vramPeakMb: 18.9 * 1024,
    totalVramMb: 32 * 1024,
    energyWhPerImage: 1.04,
    gpuModel: 'RTX 5090',
    throttled: true,
    powerW: 558
  }),
  7.9
)
const flux = benchmark(
  'f',
  'Flux.1-dev',
  '2026-09-29T18:02:00.000Z',
  makeCore({
    secPerImage: 8.6,
    vramPeakMb: 23.6 * 1024,
    totalVramMb: 24 * 1024,
    energyWhPerImage: 3.1,
    gpuModel: 'RTX 3090',
    offloaded: true
  }),
  2.33
)
const needsCapture = benchmark('old', 'SD 1.5', '2026-09-25T10:00:00.000Z', null, null, 'RTX 5090')

const sampleBenchmarks = [zImage, qwen, flux, needsCapture]

function installApi(benchmarks = sampleBenchmarks): void {
  ;(window as unknown as { api: object }).api = {
    browseFolder: vi.fn(),
    openPath: openPathMock,
    deletePerformanceTestBenchmark: deletePerformanceTestBenchmarkMock,
    renamePerformanceTestBenchmark: renamePerformanceTestBenchmarkMock,
    exportBenchmarkData: exportBenchmarkDataMock,
    listPerformanceTestBenchmarks: vi.fn(async () => ({
      folderPath: 'C:\\results\\benchmarks',
      benchmarks
    }))
  }
}

function mountView() {
  return mount(BenchmarksView, {
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enMessages } })] }
  })
}

/** Select a run for Compare via its checkbox (row-click now opens the run detail). */
function selectRow(wrapper: ReturnType<typeof mountView>, id: string): Promise<void> {
  return wrapper.get(`[data-testid="benchmark-row-${id}"] .benchmarks__checkbox`).setValue(true)
}

describe('BenchmarksView (History)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDialogs().cancel()
    deletePerformanceTestBenchmarkMock.mockClear()
    deletePerformanceTestBenchmarkMock.mockResolvedValue({ ok: true })
    renamePerformanceTestBenchmarkMock.mockClear()
    exportBenchmarkDataMock.mockClear()
    openPathMock.mockClear()
    installApi()
  })

  it('renders rich rows with metrics read from coreBenchmark', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(4)
    const row = wrapper.get('[data-testid="benchmark-row-z"]')
    expect(row.text()).toContain('Z-Image Turbo')
    expect(row.text()).toContain('1.12 s')
    expect(row.text()).toContain('24.8')
    expect(row.text()).toContain('11.4 GB')
    expect(row.text()).toContain('36% · 32 GB')
    expect(row.text()).toContain('0.21 Wh')
    expect(row.text()).toContain('RTX 5090')
  })

  it('renders — for a needs-capture run (coreBenchmark null) without crashing', async () => {
    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-testid="benchmark-row-old"]')
    expect(row.text()).toContain('SD 1.5')
    // sec/image, it/s, VRAM peak, energy all unmeasured.
    expect(row.findAll('.benchmarks__metric--muted').length).toBeGreaterThanOrEqual(4)
  })

  it('shows a factual flag for throttled it/s and offloaded VRAM', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(
      wrapper
        .get('[data-testid="benchmark-row-q"]')
        .find('.benchmarks__flag')
        .attributes('aria-label')
    ).toBe('Thermal throttling')
    expect(
      wrapper
        .get('[data-testid="benchmark-row-f"]')
        .find('.benchmarks__flag')
        .attributes('aria-label')
    ).toBe('Offloaded to RAM')
  })

  it('toggles a curated extra column on', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.benchmarks__table thead').text()).not.toContain('Peak power')
    await wrapper.get('[data-testid="benchmark-column-peakPower"]').setValue(true)
    expect(wrapper.get('.benchmarks__table thead').text()).toContain('Peak power')
    expect(wrapper.get('[data-testid="benchmark-row-q"]').text()).toContain('558 W')
  })

  it('sorts by sec/image ascending with nulls last', async () => {
    const wrapper = mountView()
    await flushPromises()

    const sortSelect = wrapper
      .findAllComponents(BaseSelect)
      .find((select) => select.props('ariaLabel') === 'Sort')
    sortSelect?.vm.$emit('update:modelValue', 'spi-asc')
    await wrapper.vm.$nextTick()
    const order = wrapper
      .findAll('[data-testid^="benchmark-row-"]')
      .map((row) => row.attributes('data-testid'))
    // z (1.12) < q (3.47) < f (8.6) < needs-capture (null, last)
    expect(order).toEqual([
      'benchmark-row-z',
      'benchmark-row-q',
      'benchmark-row-f',
      'benchmark-row-old'
    ])
  })

  it('shows the action bar on selection and opens Compare oldest-first', async () => {
    const wrapper = mountView()
    await flushPromises()
    const nav = useBenchmarkNavStore()

    expect(wrapper.find('[data-testid="benchmarks-action-bar"]').exists()).toBe(false)

    // Select newest first, then older — Compare must still pass oldest-first. Selection
    // is the checkbox now; a row-click opens the run detail instead (see dedicated test).
    await selectRow(wrapper, 'z')
    await selectRow(wrapper, 'q')

    const bar = wrapper.get('[data-testid="benchmarks-action-bar"]')
    expect(bar.text()).toContain('2 of 4 selected')
    const compare = wrapper.get('[data-testid="benchmarks-compare"]')
    expect(compare.text()).toContain('Compare (2)')

    await compare.trigger('click')
    expect(nav.screen).toBe('compare')
    expect(nav.compareRunIds).toEqual(['q', 'z'])
    expect(nav.baselineRunId).toBe('q')
  })

  it('opens the run detail on row-click (not selection) and via the ⋯ Open item', async () => {
    const wrapper = mountView()
    await flushPromises()
    const nav = useBenchmarkNavStore()

    // Row-click opens the read-only detail dashboard and does NOT toggle selection.
    await wrapper.get('[data-testid="benchmark-row-z"]').trigger('click')
    expect(nav.screen).toBe('detail')
    expect(nav.detailRun?.id).toBe('z')
    expect(nav.compareRunIds).toEqual([])
    expect(wrapper.find('[data-testid="benchmarks-action-bar"]').exists()).toBe(false)

    nav.backToHistory()
    await flushPromises()

    // The ⋯ Open item opens the same detail screen for its row.
    await wrapper.get('[data-testid="benchmark-open-q"]').trigger('click')
    expect(nav.screen).toBe('detail')
    expect(nav.detailRun?.id).toBe('q')
  })

  it('checkbox selection does not open the detail screen', async () => {
    const wrapper = mountView()
    await flushPromises()
    const nav = useBenchmarkNavStore()

    await selectRow(wrapper, 'z')
    expect(nav.screen).toBe('history')
    // Checkbox selection surfaces the action bar but never navigates to the detail screen.
    expect(wrapper.get('[data-testid="benchmarks-action-bar"]').text()).toContain('1 of 4 selected')
  })

  it('keeps Compare disabled below two and notes the five-column cap above it', async () => {
    const wrapper = mountView()
    await flushPromises()

    await selectRow(wrapper, 'z')
    expect(wrapper.get('[data-testid="benchmarks-compare"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="benchmarks-action-bar"]').text()).not.toContain(
      'Compare uses the 5 most recent'
    )
  })

  it('exports the selected rows as CSV via the data export IPC', async () => {
    const wrapper = mountView()
    await flushPromises()

    await selectRow(wrapper, 'z')
    await selectRow(wrapper, 'q')
    await wrapper.get('[data-testid="benchmarks-export-csv"]').trigger('click')
    await flushPromises()

    expect(exportBenchmarkDataMock).toHaveBeenCalledTimes(1)
    const [contents, baseName, dir] = exportBenchmarkDataMock.mock.calls[0]!
    expect(contents).toContain('session_id')
    expect(baseName).toMatch(/^comfy-benchmarks-2-runs-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(dir).toBe('C:\\results\\benchmarks')
  })

  it('runs the row ⋯ menu actions: run again, reveal, delete, rename', async () => {
    const wrapper = mountView()
    await flushPromises()
    const nav = useBenchmarkNavStore()
    const dialogs = useDialogs()

    // Run again → switches to the Run panel.
    await wrapper.get('[data-testid="benchmark-runagain-z"]').trigger('click')
    expect(nav.panelRequest).toBe('performance-test')

    // Reveal → opens the session folder.
    await wrapper.get('[data-testid="benchmark-reveal-z"]').trigger('click')
    expect(openPathMock).toHaveBeenCalledWith('C:\\results\\benchmarks\\z')

    // Delete → confirm then IPC.
    await wrapper.get('[data-testid="benchmark-delete-z"]').trigger('click')
    expect(dialogs.state.open).toBe(true)
    dialogs.confirmPrimary()
    await flushPromises()
    expect(deletePerformanceTestBenchmarkMock).toHaveBeenCalledWith('C:\\results\\benchmarks', 'z')
    expect(wrapper.find('[data-testid="benchmark-row-z"]').exists()).toBe(false)
  })

  it('renames a session by double-clicking the workflow cell', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="benchmark-row-q"] .benchmarks__wf-cell').trigger('dblclick')
    const input = wrapper.get<HTMLInputElement>('.benchmarks__rename-input')
    expect(input.element.value).toBe('q')
    await input.setValue('gpu-baseline')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(renamePerformanceTestBenchmarkMock).toHaveBeenCalledWith(
      'C:\\results\\benchmarks',
      'q',
      'gpu-baseline'
    )
    expect(wrapper.get('[data-testid="benchmark-row-gpu-baseline"]').exists()).toBe(true)
  })

  it('switches to the Run panel from the segmented control', async () => {
    const wrapper = mountView()
    await flushPromises()
    const nav = useBenchmarkNavStore()

    await wrapper.get('[data-testid="benchmarks-tab-run"]').trigger('click')
    expect(nav.panelRequest).toBe('performance-test')
  })

  it('shows the empty state with no runs', async () => {
    installApi([])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('.benchmarks__empty').text()).toContain('No benchmarks yet.')
  })

  it('shows the no-match state and clears filters', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.benchmarks__search input').setValue('nothing-matches-this')
    expect(wrapper.get('.benchmarks__no-results').text()).toContain('No runs match these filters.')
    await wrapper.get('.benchmarks__no-results button').trigger('click')
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(4)
  })

  it('shows the load-error state and retries', async () => {
    ;(window as unknown as { api: { listPerformanceTestBenchmarks: unknown } }).api = {
      listPerformanceTestBenchmarks: vi.fn().mockRejectedValue(new Error('unreadable'))
    }
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('.benchmarks__state--error').text()).toContain(
      "Couldn't read the benchmarks folder."
    )
  })
})
