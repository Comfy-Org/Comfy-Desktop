import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { PerformanceTestBenchmark } from '../types/ipc'
import type * as PerformanceTestResultsSvg from '../lib/performanceTestResultsSvg'
import BaseSelect from '../components/ui/BaseSelect.vue'
import { useDialogs } from '../composables/useDialogs'
import BenchmarksView from './BenchmarksView.vue'

const createResultsPngMock = vi.hoisted(() =>
  vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)
)
const exportResultsImageMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, filePath: 'C:\\Exports\\benchmark-comparison.png' }))
)
const deletePerformanceTestBenchmarkMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
const renamePerformanceTestBenchmarkMock = vi.hoisted(() =>
  vi.fn(async (_folderPath: string, _sessionId: string, newSessionId: string) => ({
    ok: true,
    sessionId: newSessionId
  }))
)

vi.mock('../lib/performanceTestResultsSvg', async (importOriginal) => ({
  ...(await importOriginal<typeof PerformanceTestResultsSvg>()),
  createResultsPng: createResultsPngMock
}))

vi.mock('./devplatform/DevPlatformAccountChip.vue', () => ({
  default: { template: '<div data-testid="account-chip" />' }
}))

const messages = {
  common: { loading: 'Loading...' },
  benchmarks: {
    title: 'Benchmarks',
    description: 'Compare results from your performance tests.',
    runsLibrary: 'Runs library',
    openFolder: 'Select folder',
    refresh: 'Refresh sessions',
    searchPlaceholder: 'Search runs...',
    allWorkspaces: 'All workspaces',
    allInstances: 'All instances',
    allHardware: 'All hardware',
    allWorkflows: 'All workflows',
    columns: 'Properties',
    columnsToDisplay: 'Columns to display',
    unmanagedWorkspace: 'Unmanaged',
    unknownHardware: 'Unknown hardware',
    session: 'Session',
    dateTime: 'Date / Time',
    workflow: 'Workflow',
    instance: 'Instance',
    workspace: 'Workspace',
    runs: 'Runs',
    hardware: 'GPU / Hardware',
    fastest: 'Fastest',
    average: 'Average',
    median: 'Median',
    slowest: 'Slowest',
    measuredRuns: 'Measured runs',
    selectVisible: 'Select all visible runs',
    selectRun: 'Select {workflow}',
    actions: 'Actions',
    deleteRecord: 'Delete {workflow} benchmark',
    deleteConfirmTitle: 'Delete {workflow}?',
    deleteConfirmMessage:
      'This will permanently delete all files for session {session}. This cannot be undone.',
    deleteFiles: 'Delete files',
    deleteErrorTitle: 'Could not delete benchmark',
    deleteErrorMessage: 'The benchmark files could not be deleted.',
    sessionName: 'Session name',
    editSessionName: 'Edit session {session}',
    renameErrorTitle: 'Could not rename session',
    renameErrorMessage: 'The session folder could not be renamed.',
    sessionNameRequired: 'Enter a session name.',
    comparison: 'Comparison',
    sortComparison: 'Sort comparison',
    manualSort: 'Manual sort',
    switchSortAscending: 'Switch to ascending sort',
    switchSortDescending: 'Switch to descending sort',
    reorderComparisonColumn: 'Reorder {workflow} comparison column',
    reorderComparisonHint: 'Drag to reorder. You can also press Alt+Left or Alt+Right.',
    comparisonImageTitle: 'Benchmark Comparison',
    exportResultsImage: 'Export results',
    exportingImage: 'Exporting image...',
    exportImageFailed: 'Could not export the comparison image.',
    metric: 'Metric',
    durationRange: 'Duration range (min → max)',
    durationRangeHint: 'Range hint',
    selectPrompt: 'Select runs from the library to compare them.',
    empty: 'No performance test results yet.',
    noMatches: 'No runs match these filters.',
    loadError: 'Could not load performance test results.'
  }
}

function benchmark(
  id: string,
  workflowName: string,
  average: number,
  hardwareName = 'NVIDIA RTX 4090'
): PerformanceTestBenchmark {
  const createdAt = `2026-09-${id.padStart(2, '0')}T10:00:00.000Z`
  const instance = { id: `instance-${id}`, name: `Instance ${id}` }
  const workspace = { id: 'workspace-1', name: 'Comfy' }
  return {
    id,
    createdAt,
    instance,
    workspace,
    workflowName,
    fastestJobDurationSeconds: average - 0.4,
    slowestJobDurationSeconds: average + 0.7,
    averageJobDurationSeconds: average,
    medianJobDurationSeconds: average - 0.1,
    measuredJobCount: 5,
    hardwareName,
    result: {
      createdAt,
      instance,
      workspace,
      workflowName,
      fastestJobDurationSeconds: average - 0.4,
      slowestJobDurationSeconds: average + 0.7,
      averageJobDurationSeconds: average,
      medianJobDurationSeconds: average - 0.1,
      measuredJobCount: 5,
      hardware: { deviceName: hardwareName },
      systemInfo: { cpu_model: 'Test CPU' },
      customScore: Number(id)
    }
  }
}

const sampleBenchmarks = [
  benchmark('13', 'portrait.json', 2),
  benchmark('12', 'product.json', 3.4),
  benchmark('11', 'portrait.json', 1.2, 'NVIDIA RTX 5090'),
  benchmark('10', 'landscape.json', 8.7, 'Apple M3 Max')
]

function mountView() {
  return mount(BenchmarksView, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: messages } })]
    }
  })
}

describe('BenchmarksView', () => {
  beforeEach(() => {
    useDialogs().cancel()
    createResultsPngMock.mockClear()
    exportResultsImageMock.mockClear()
    deletePerformanceTestBenchmarkMock.mockClear()
    deletePerformanceTestBenchmarkMock.mockResolvedValue({ ok: true })
    renamePerformanceTestBenchmarkMock.mockClear()
    ;(window as unknown as { api: object }).api = {
      browseFolder: vi.fn(),
      exportResultsImage: exportResultsImageMock,
      deletePerformanceTestBenchmark: deletePerformanceTestBenchmarkMock,
      renamePerformanceTestBenchmark: renamePerformanceTestBenchmarkMock,
      listPerformanceTestBenchmarks: vi.fn(async () => ({
        folderPath: 'C:\\results\\performance-tests',
        benchmarks: sampleBenchmarks
      }))
    }
  })

  it('selects the three newest runs and highlights only the best duration in each metric', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(4)
    expect(wrapper.findAll('.benchmarks__table thead th').map((header) => header.text())).toEqual([
      '',
      'Workflow',
      'Session',
      'GPU / Hardware',
      'Runs',
      'Date / Time ↓',
      ''
    ])
    expect(wrapper.get('[data-testid="benchmark-row-13"]').text()).toContain('13')
    expect(wrapper.find('.benchmarks__selection-tray').exists()).toBe(false)
    expect(wrapper.get('[data-testid="benchmark-row-13"]').attributes('style')).toContain(
      '--series-color: #55e0d1'
    )
    expect(wrapper.findAll('.benchmarks__best').map((cell) => cell.text())).toEqual([
      '0.8 s',
      '1.2 s',
      '1.1 s',
      '1.9 s'
    ])
    expect(
      wrapper.findAll('[data-testid^="benchmark-comparison-13-"]').map((field) => field.text())
    ).toEqual(['portrait.json', 'Session: 13', 'GPU / Hardware: NVIDIA RTX 4090'])
    expect(
      wrapper.findAll('[data-testid^="benchmark-chart-13-"]').map((field) => field.text())
    ).toEqual([
      'portrait.json',
      'Session: 13',
      'GPU / Hardware: NVIDIA RTX 4090',
      '1.6 s',
      '2.7 s',
      '2 s'
    ])
    expect(
      wrapper
        .get('[data-testid="benchmark-chart-13-slowest-label"]')
        .classes('benchmarks__chart-point-label--slowest')
    ).toBe(true)

    const exportButton = wrapper.get('.benchmarks__export-results')
    expect(exportButton.text()).toBe('Export results')
    await exportButton.trigger('click')
    await flushPromises()
    expect(exportResultsImageMock).toHaveBeenCalledTimes(1)
    const [png, imageType, defaultPath] = exportResultsImageMock.mock.calls[0]!
    expect(png).toBeInstanceOf(ArrayBuffer)
    expect(imageType).toBe('benchmark-comparison')
    expect(defaultPath).toBe('C:\\results\\performance-tests')
    const svg = createResultsPngMock.mock.calls[0]![0]
    expect(svg).toContain('Benchmark Comparison')
    expect(svg).toContain('portrait.json')
    expect(svg).toContain('Duration range')
    expect(svg).toContain('role="img" aria-label="Comfy"')
    expect(svg).toContain('class="footer-date"')
    expect(svg.match(/class="table-cell best-cell"/g)).toHaveLength(4)
    expect(svg).toContain('.best-cell { fill: #f2ff59; fill-opacity: 0.08; }')
    expect(svg.match(/class="chart-point-label"/g)).toHaveLength(9)
  })

  it('filters the run library and updates the comparison selection directly', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="benchmark-column-systemInfo.cpu_model"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="benchmark-comparison-13-customScore"]').exists()).toBe(false)
    await wrapper.get('[data-testid="benchmark-column-customScore"]').setValue(true)
    expect(wrapper.get('.benchmarks__table thead').text()).toContain('Custom Score')
    expect(wrapper.get('[data-testid="benchmark-row-13"]').text()).toContain('13')
    expect(wrapper.find('[data-testid="benchmark-comparison-13-customScore"]').exists()).toBe(false)
    await wrapper.get('[data-testid="benchmark-comparison-column-customScore"]').setValue(true)
    expect(wrapper.get('[data-testid="benchmark-comparison-13-customScore"]').text()).toBe(
      'Custom Score: 13'
    )
    expect(wrapper.get('[data-testid="benchmark-comparison-12-customScore"]').text()).toBe(
      'Custom Score: 12'
    )
    expect(wrapper.get('[data-testid="benchmark-chart-13-customScore"]').text()).toBe(
      'Custom Score: 13'
    )
    expect(
      wrapper.get('[data-testid="benchmark-column-workflowName"]').attributes('disabled')
    ).toBe('')
    expect(wrapper.get('.benchmarks__table thead').text()).toContain('Workflow')
    expect(wrapper.get('[data-testid="benchmark-comparison-13-workflowName"]').text()).toContain(
      'portrait.json'
    )
    expect(
      wrapper.get('[data-testid="benchmark-comparison-column-workflowName"]').attributes('disabled')
    ).toBe('')
    expect(wrapper.get('[data-testid="benchmark-comparison-13-workflowName"]').text()).toContain(
      'portrait.json'
    )
    expect(wrapper.get('[data-testid="benchmark-chart-13-workflowName"]').text()).toContain(
      'portrait.json'
    )

    await wrapper.get('input[type="text"]').setValue('landscape')
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="benchmark-row-10"]').text()).toContain('landscape.json')

    await wrapper.get('[data-testid="benchmark-row-10"] input[type="checkbox"]').setValue(true)
    expect(wrapper.get('[data-testid="benchmark-row-10"]').attributes('style')).toContain(
      '--series-color: #ff8a65'
    )
    expect(wrapper.get('.benchmarks__comparison').text()).toContain('landscape.json')

    const comparisonToggle = wrapper.get('#comparison-title')
    expect(comparisonToggle.attributes('aria-expanded')).toBe('true')
    await comparisonToggle.trigger('click')
    expect(comparisonToggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.benchmarks__comparison').attributes('style')).toContain('display: none')
    await comparisonToggle.trigger('click')

    await wrapper.get('[data-testid="benchmark-row-10"] input[type="checkbox"]').setValue(false)
    expect(wrapper.get('[data-testid="benchmark-row-10"]').attributes('style')).toBeUndefined()
    await wrapper.get('input[type="text"]').setValue('')
    await wrapper.get('[data-testid="benchmark-row-13"] input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-testid="benchmark-row-12"] input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-testid="benchmark-row-11"] input[type="checkbox"]').setValue(false)
    expect(wrapper.get('.benchmarks__comparison').text()).toContain(
      'Select runs from the library to compare them.'
    )
  })

  it('reorders comparison columns by dragging a column title', async () => {
    const wrapper = mountView()
    await flushPromises()

    const columnIds = () =>
      wrapper
        .findAll('[data-testid^="benchmark-comparison-column-title-"]')
        .map((header) => header.attributes('data-testid')?.split('-').at(-1))

    expect(columnIds()).toEqual(['13', '12', '11'])

    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => '13')
    }
    await wrapper
      .get('[data-testid="benchmark-comparison-column-title-13"] .benchmarks__matrix-title')
      .trigger('dragstart', { dataTransfer })
    await wrapper.get('[data-testid="benchmark-comparison-column-title-11"]').trigger('dragover', {
      dataTransfer
    })
    expect(
      wrapper
        .get('[data-testid="benchmark-comparison-column-title-11"]')
        .classes('benchmarks__matrix-column--drop-target')
    ).toBe(true)
    await wrapper.get('[data-testid="benchmark-comparison-column-title-11"]').trigger('drop', {
      dataTransfer
    })

    expect(columnIds()).toEqual(['12', '13', '11'])

    await wrapper
      .get('[data-testid="benchmark-comparison-column-title-11"] .benchmarks__matrix-title')
      .trigger('dragstart', { dataTransfer })
    await wrapper.get('[data-testid="benchmark-comparison-column-title-12"]').trigger('drop', {
      dataTransfer
    })

    expect(columnIds()).toEqual(['11', '12', '13'])
    expect(wrapper.findAll('.benchmarks__chart-row strong').map((title) => title.text())).toEqual([
      'portrait.json',
      'product.json',
      'portrait.json'
    ])
  })

  it('sorts comparison columns by duration metrics in either direction', async () => {
    const wrapper = mountView()
    await flushPromises()

    const columnIds = () =>
      wrapper
        .findAll('[data-testid^="benchmark-comparison-column-title-"]')
        .map((header) => header.attributes('data-testid')?.split('-').at(-1))
    const sortSelect = wrapper
      .findAllComponents(BaseSelect)
      .find((select) => select.props('ariaLabel') === 'Sort comparison')

    expect(sortSelect?.props('options').map((option) => option.label)).toEqual([
      'Manual sort',
      'Fastest',
      'Average',
      'Median',
      'Slowest'
    ])

    sortSelect?.vm.$emit('update:modelValue', 'fastestJobDurationSeconds')
    await wrapper.vm.$nextTick()
    expect(columnIds()).toEqual(['11', '13', '12'])

    await wrapper.get('.benchmarks__sort-direction').trigger('click')
    expect(columnIds()).toEqual(['12', '13', '11'])
    expect(wrapper.get('.benchmarks__sort-direction').attributes('aria-label')).toBe(
      'Switch to ascending sort'
    )
  })

  it('places endpoint labels immediately outside their data point markers', async () => {
    const edgeBenchmark = {
      ...benchmark('14', 'qwen_image_2.1_int8_bf16.json', 45.83),
      fastestJobDurationSeconds: 44.7,
      averageJobDurationSeconds: 45.83,
      medianJobDurationSeconds: 45.61,
      slowestJobDurationSeconds: 47.24
    }
    vi.mocked(window.api.listPerformanceTestBenchmarks).mockResolvedValueOnce({
      folderPath: 'C:\\results\\performance-tests',
      benchmarks: [edgeBenchmark]
    })
    const wrapper = mountView()
    await flushPromises()

    const fastestLabel = wrapper.get('[data-testid="benchmark-chart-14-fastest-label"]')
    expect(fastestLabel.classes()).toContain('benchmarks__chart-point-label--fastest')
    expect(wrapper.get('[data-testid="benchmark-chart-14-slowest-label"]').classes()).toContain(
      'benchmarks__chart-point-label--slowest'
    )
    expect(wrapper.get('[data-testid="benchmark-chart-14-average-label"]').classes()).toContain(
      'benchmarks__chart-point-label--center'
    )

    await wrapper.get('.benchmarks__export-results').trigger('click')
    await flushPromises()
    const svg = createResultsPngMock.mock.calls[0]![0]
    const markerMatches = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="4"[^>]*\/>/g)]
    const fastestLabelMatch = svg.match(
      /<text x="([^"]+)" y="([^"]+)" class="chart-point-label" text-anchor="end">44\.7 s<\/text>/
    )
    const slowestLabelMatch = svg.match(
      /<text x="([^"]+)" y="([^"]+)" class="chart-point-label" text-anchor="start">47\.24 s<\/text>/
    )
    const averageMarkerX = svg.match(
      /<circle cx="([^"]+)"[^>]+r="5"[^>]+class="chart-average"/
    )?.[1]
    expect(svg).toContain('r="5" fill="#55e0d1" class="chart-average"')
    const averageLabelX = svg.match(
      /<text x="([^"]+)"[^>]+class="chart-point-label" text-anchor="middle">45\.83 s<\/text>/
    )?.[1]
    expect(Number(fastestLabelMatch?.[1])).toBe(Number(markerMatches[0]?.[1]) - 4)
    expect(Number(slowestLabelMatch?.[1])).toBe(Number(markerMatches[1]?.[1]) + 4)
    expect(Number(fastestLabelMatch?.[2])).toBe(Number(markerMatches[0]?.[2]) + 4)
    expect(Number(slowestLabelMatch?.[2])).toBe(Number(markerMatches[1]?.[2]) + 4)
    expect(averageLabelX).toBe(averageMarkerX)
  })

  it('confirms before deleting all files for a benchmark record', async () => {
    const wrapper = mountView()
    await flushPromises()
    const dialogs = useDialogs()

    expect(wrapper.findAll('.benchmarks__delete-record')).toHaveLength(4)
    await wrapper
      .get('[data-testid="benchmark-row-13"] .benchmarks__delete-record')
      .trigger('click')
    expect(dialogs.state.open).toBe(true)
    expect(dialogs.state.kind).toBe('confirm')
    expect(dialogs.state.confirm.title).toBe('Delete portrait.json?')
    expect(dialogs.state.confirm.message).toContain('permanently delete all files for session 13')
    expect(deletePerformanceTestBenchmarkMock).not.toHaveBeenCalled()

    dialogs.confirmPrimary()
    await flushPromises()

    expect(deletePerformanceTestBenchmarkMock).toHaveBeenCalledWith(
      'C:\\results\\performance-tests',
      '13'
    )
    expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="benchmark-comparison-column-title-13"]').exists()).toBe(
      false
    )
  })

  it('shows an error when the benchmark delete bridge rejects', async () => {
    deletePerformanceTestBenchmarkMock.mockRejectedValueOnce(new Error('Delete IPC unavailable'))
    const wrapper = mountView()
    await flushPromises()
    const dialogs = useDialogs()

    await wrapper
      .get('[data-testid="benchmark-row-13"] .benchmarks__delete-record')
      .trigger('click')
    dialogs.confirmPrimary()
    await flushPromises()

    expect(dialogs.state.kind).toBe('alert')
    expect(dialogs.state.alert.title).toBe('Could not delete benchmark')
    expect(dialogs.state.alert.message).toBe('Delete IPC unavailable')
    expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(true)
  })

  it('renames a session inline and preserves its comparison selection', async () => {
    const wrapper = mountView()
    await flushPromises()

    const sessionButton = wrapper.get('[data-testid="benchmark-row-13"] .benchmarks__session-name')
    expect(sessionButton.text()).toBe('13')
    expect(sessionButton.attributes('aria-label')).toBe('Edit session 13')

    await sessionButton.trigger('click')
    const input = wrapper.get<HTMLInputElement>('.benchmarks__session-name-input')
    expect(input.element.value).toBe('13')
    expect(
      wrapper.get('[data-testid="benchmark-row-13"] .benchmarks__delete-record').attributes()
    ).toHaveProperty('disabled')
    await input.setValue('gpu-baseline')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(renamePerformanceTestBenchmarkMock).toHaveBeenCalledWith(
      'C:\\results\\performance-tests',
      '13',
      'gpu-baseline'
    )
    expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="benchmark-row-gpu-baseline"]').text()).toContain(
      'gpu-baseline'
    )
    expect(
      wrapper.find('[data-testid="benchmark-comparison-column-title-gpu-baseline"]').exists()
    ).toBe(true)
  })

  it('opens the current results folder in the picker and loads a selected folder', async () => {
    const customFolder = 'D:\\shared-benchmarks'
    const api = window.api
    vi.mocked(api.browseFolder).mockResolvedValue(customFolder)
    vi.mocked(api.listPerformanceTestBenchmarks)
      .mockReset()
      .mockResolvedValueOnce({
        folderPath: 'C:\\results\\performance-tests',
        benchmarks: sampleBenchmarks
      })
      .mockResolvedValueOnce({
        folderPath: customFolder,
        benchmarks: [sampleBenchmarks[3]!]
      })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.benchmarks__open-folder').trigger('click')
    await flushPromises()

    expect(api.browseFolder).toHaveBeenCalledWith('C:\\results\\performance-tests')
    expect(api.listPerformanceTestBenchmarks).toHaveBeenLastCalledWith(customFolder)
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="benchmark-row-10"]').text()).toContain('landscape.json')
  })

  it('refreshes the currently selected sessions folder', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="benchmarks-refresh"]').trigger('click')
    await flushPromises()

    expect(window.api.listPerformanceTestBenchmarks).toHaveBeenLastCalledWith(
      'C:\\results\\performance-tests'
    )
  })
})
