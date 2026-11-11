import { defineComponent, h, KeepAlive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { PerformanceTestBenchmark } from '../types/ipc'
import type * as PerformanceTestResultsSvg from '../lib/performanceTestResultsSvg'
import BaseSelect from '../components/ui/BaseSelect.vue'
import { useDialogs } from '../composables/useDialogs'
import BenchmarksView from './BenchmarksView.vue'
import { setChecked } from './testHelpers'

const createResultsPngMock = vi.hoisted(() =>
  vi.fn(async (_svg: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)
)
const exportResultsImageMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      ok: boolean
      canceled?: boolean
      message?: string
      filePath?: string
    }> => ({ ok: true, filePath: 'C:\\Exports\\benchmark-comparison.png' })
  )
)
const deletePerformanceTestBenchmarkMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
const renamePerformanceTestBenchmarkMock = vi.hoisted(() =>
  vi.fn(
    async (
      _folderPath: string,
      _sessionId: string,
      newSessionId: string
    ): Promise<{ ok: boolean; sessionId?: string; message?: string }> => ({
      ok: true,
      sessionId: newSessionId
    })
  )
)
const navigatePanelMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/performanceTestResultsSvg', async (importOriginal) => ({
  ...(await importOriginal<typeof PerformanceTestResultsSvg>()),
  createResultsPng: createResultsPngMock
}))

vi.mock('./devplatform/DevPlatformAccountChip.vue', () => ({
  default: { template: '<div data-testid="account-chip" />' }
}))

function benchmark(
  id: string,
  workflowName: string,
  average: number,
  hardwareName: string | null = 'NVIDIA RTX 4090',
  build = 'Nightly 0.3.62'
): PerformanceTestBenchmark {
  const createdAt = `2026-09-${id.padStart(2, '0')}T10:00:00.000Z`
  const instance = { id: `instance-${build}`, name: build }
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

function emptyRun(id: string): PerformanceTestBenchmark {
  return {
    ...benchmark(id, 'portrait.json', 1, 'NVIDIA RTX 4090', 'Broken build'),
    fastestJobDurationSeconds: null,
    slowestJobDurationSeconds: null,
    averageJobDurationSeconds: null,
    medianJobDurationSeconds: null,
    measuredJobCount: 0
  }
}

const sampleBenchmarks = [
  benchmark('13', 'portrait.json', 2),
  benchmark('12', 'portrait.json', 2.2, 'NVIDIA RTX 4090', 'Stable 0.3.60'),
  benchmark('11', 'portrait.json', 1.2, 'NVIDIA RTX 5090'),
  benchmark('10', 'landscape.json', 8.7, 'Apple M3 Max', 'Stable 0.3.60'),
  {
    ...benchmark('9', 'portrait.json', 3, 'NVIDIA RTX 4090', 'Stable 0.3.55'),
    fastestJobDurationSeconds: 1
  }
]
const PORTRAIT_4090 = 'benchmark-group-portrait.json-NVIDIA RTX 4090'

function listMock(): ReturnType<typeof vi.fn> {
  return window.api.listPerformanceTestBenchmarks as unknown as ReturnType<typeof vi.fn>
}

function useBenchmarks(list: PerformanceTestBenchmark[]): void {
  listMock().mockResolvedValue({ folderPath: 'C:\\results\\performance-tests', benchmarks: list })
}

function mountView() {
  return mount(BenchmarksView, { attachTo: document.body })
}

function group(wrapper: VueWrapper, testId = PORTRAIT_4090) {
  return wrapper.get(`[data-testid="${testId}"]`)
}

function rowIds(wrapper: VueWrapper, testId = PORTRAIT_4090): Array<string | undefined> {
  return group(wrapper, testId)
    .findAll('[data-testid^="benchmark-row-"]')
    .map((row) => row.attributes('data-testid')?.replace('benchmark-row-', ''))
}

function vsLabels(wrapper: VueWrapper, testId = PORTRAIT_4090): string[] {
  return group(wrapper, testId)
    .findAll('.benchmarks__vs')
    .map((cell) => cell.text())
}

function compareBySelect(wrapper: VueWrapper) {
  return wrapper
    .findAllComponents(BaseSelect)
    .find((select) => select.props('ariaLabel') === 'Compare by')!
}

async function compareBy(wrapper: VueWrapper, value: string): Promise<void> {
  compareBySelect(wrapper).vm.$emit('update:modelValue', value)
  await flushPromises()
}

async function openMenu(wrapper: VueWrapper, selector: string): Promise<void> {
  await wrapper.get(selector).trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
}

function menuItem(selector: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[role="menu"] ${selector}`)
}

async function chooseMenuItem(selector: string): Promise<void> {
  menuItem(selector)!.click()
  await vi.waitFor(() => expect(document.body.querySelector('[role="menu"]')).toBeNull())
  await flushPromises()
}

async function openRowMenu(wrapper: VueWrapper, id: string): Promise<void> {
  await openMenu(wrapper, `[data-testid="benchmark-row-${id}"] .benchmarks__row-menu`)
}

async function selectRow(wrapper: VueWrapper, id: string, checked = true): Promise<void> {
  await setChecked(wrapper.get(`[data-testid="benchmark-row-${id}"] [role="checkbox"]`), checked)
}

function lastExportedSvg(): string {
  return createResultsPngMock.mock.calls.at(-1)![0]
}

function mountKeptAlive() {
  const Page = defineComponent({
    props: { visible: { type: Boolean, required: true } },
    setup: (props) => () =>
      h(KeepAlive, null, { default: () => (props.visible ? h(BenchmarksView) : h('div')) })
  })
  return mount(Page, {
    props: { visible: true }
  })
}

describe('BenchmarksView', () => {
  beforeEach(() => {
    useDialogs().cancel()
    document.body.innerHTML = ''
    createResultsPngMock.mockClear()
    exportResultsImageMock.mockClear()
    exportResultsImageMock.mockResolvedValue({
      ok: true,
      filePath: 'C:\\Exports\\benchmark-comparison.png'
    })
    deletePerformanceTestBenchmarkMock.mockClear()
    deletePerformanceTestBenchmarkMock.mockResolvedValue({ ok: true })
    renamePerformanceTestBenchmarkMock.mockClear()
    navigatePanelMock.mockClear()
    ;(window as unknown as { api: object }).api = {
      browseFolder: vi.fn(),
      navigatePanel: navigatePanelMock,
      exportResultsImage: exportResultsImageMock,
      deletePerformanceTestBenchmark: deletePerformanceTestBenchmarkMock,
      renamePerformanceTestBenchmark: renamePerformanceTestBenchmarkMock,
      listPerformanceTestBenchmarks: vi.fn(async () => ({
        folderPath: 'C:\\results\\performance-tests',
        benchmarks: sampleBenchmarks
      }))
    }
  })

  describe('returning to the page', () => {
    const browseFolder = (): ReturnType<typeof vi.fn> =>
      window.api.browseFolder as unknown as ReturnType<typeof vi.fn>

    async function leaveAndReturn(wrapper: ReturnType<typeof mountKeptAlive>): Promise<void> {
      await wrapper.setProps({ visible: false })
      await wrapper.setProps({ visible: true })
      await flushPromises()
    }

    it('loads once on first open', async () => {
      mountKeptAlive()
      await flushPromises()

      expect(listMock()).toHaveBeenCalledOnce()
    })

    it('keeps the folder, search and picked runs', async () => {
      browseFolder().mockResolvedValue('D:\\other')
      listMock().mockImplementation(async (folderPath?: string) => ({
        folderPath: folderPath ?? 'C:\\results\\performance-tests',
        benchmarks: sampleBenchmarks
      }))
      const wrapper = mountKeptAlive()
      await flushPromises()
      await wrapper.get('.benchmarks__open-folder').trigger('click')
      await flushPromises()
      await selectRow(wrapper, '10')
      await wrapper.get<HTMLInputElement>('input[type="text"]').setValue('json')

      await leaveAndReturn(wrapper)

      expect(listMock()).toHaveBeenLastCalledWith('D:\\other')
      expect(wrapper.get<HTMLInputElement>('input[type="text"]').element.value).toBe('json')
      const checked = (id: string): string | undefined =>
        wrapper
          .get(`[data-testid="benchmark-row-${id}"] [role="checkbox"]`)
          .attributes('aria-checked')
      expect(checked('13')).toBe('false')
      expect(checked('10')).toBe('true')
    })

    it('shows runs that finished meanwhile and drops picks that are gone', async () => {
      const wrapper = mountKeptAlive()
      await flushPromises()
      await selectRow(wrapper, '13')
      await selectRow(wrapper, '12')
      useBenchmarks([benchmark('14', 'new.json', 1), ...sampleBenchmarks.slice(1)])

      await leaveAndReturn(wrapper)

      expect(wrapper.find('[data-testid="benchmark-row-14"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(false)
      expect(
        wrapper.get('[data-testid="benchmark-row-14"] [role="checkbox"]').attributes('aria-checked')
      ).toBe('false')
      expect(wrapper.get('.benchmarks__selected-count').text()).toBe('1 selected')
    })

    it('keeps the list on screen when the refresh fails', async () => {
      const wrapper = mountKeptAlive()
      await flushPromises()
      listMock().mockRejectedValue(new Error('offline'))

      await leaveAndReturn(wrapper)

      expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(5)
    })
  })

  it('groups runs by workflow and hardware, newest group first', async () => {
    const wrapper = mountView()
    await flushPromises()

    const groups = wrapper.findAll('.benchmarks__group')
    expect(groups.map((card) => card.get('.benchmarks__group-toggle').text())).toEqual([
      'portrait.json',
      'portrait.json',
      'landscape.json'
    ])
    expect(groups.map((card) => card.get('.benchmarks__group-meta').text())).toEqual([
      'NVIDIA RTX 4090 · 3 sessions · 15 runs',
      'NVIDIA RTX 5090 · 1 session · 5 runs',
      'Apple M3 Max · 1 session · 5 runs'
    ])
    expect(rowIds(wrapper)).toEqual(['13', '12', '9'])
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
    expect(
      group(wrapper)
        .findAll('thead th')
        .map((header) => header.text())
    ).toEqual(['', 'Session', 'Build', 'Median and range', 'Median ↑', 'Vs fastest', ''])
    expect(group(wrapper).get('[data-testid="benchmark-row-13"]').text()).toContain(
      'Nightly 0.3.62'
    )
    expect(
      group(wrapper).get('[data-testid="benchmark-row-13"] .benchmarks__session-meta').text()
    ).toContain('5 runs')
  })

  it('names the fastest build and compares it with the runner-up', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(group(wrapper).get('.benchmarks__summary').text()).toBe(
      'Nightly 0.3.62 is the fastest, 10% ahead of Stable 0.3.60.'
    )
    expect(group(wrapper).get('.benchmarks__summary .text-success').text()).toBe('10% ahead')
    expect(vsLabels(wrapper)).toEqual(['Fastest', '1.11× slower', '1.53× slower'])
    expect(
      group(wrapper)
        .findAll('.benchmarks__value')
        .map((cell) => cell.text())
    ).toEqual(['1.9 s', '2.1 s', '2.9 s'])
    expect(
      group(wrapper)
        .findAll('.benchmarks__bar-fill--best')
        .map((fill) => fill.element.closest('tr')?.getAttribute('data-testid'))
    ).toEqual(['benchmark-row-13'])
    expect(group(wrapper).find('.benchmarks__axis').exists()).toBe(false)
    expect(
      Number.parseFloat(
        (
          group(wrapper).get('[data-testid="benchmark-bar-13"] .benchmarks__bar-fill')
            .element as HTMLElement
        ).style.width
      )
    ).toBeCloseTo((1.9 / 3.7) * 100, 3)
  })

  it('describes a single-run group without a comparison', async () => {
    const wrapper = mountView()
    await flushPromises()
    const single = group(wrapper, 'benchmark-group-landscape.json-Apple M3 Max')

    expect(single.find('.benchmarks__summary').exists()).toBe(false)
    expect(single.get('.benchmarks__single-note').text()).toBe(
      'Only one build ran this workflow here. Run it on another build to compare.'
    )
    expect(single.get('.benchmarks__vs').text()).toBe('')
  })

  it('compares against a chosen baseline and resets it', async () => {
    const wrapper = mountView()
    await flushPromises()

    await openRowMenu(wrapper, '12')
    await chooseMenuItem('.benchmarks__set-baseline')

    expect(group(wrapper).get('.benchmarks__summary').text()).toBe(
      'Nightly 0.3.62 is 10% ahead of Stable 0.3.60, the baseline.'
    )
    expect(vsLabels(wrapper)).toEqual(['1.11× faster', 'Baseline', '1.38× slower'])
    expect(group(wrapper).get('.benchmarks__vs-head').text()).toBe('Vs baseline')
    expect(group(wrapper).get('.benchmarks__baseline-foot').text()).toContain(
      'Speed = baseline time ÷ run time'
    )
    expect(
      group(wrapper, 'benchmark-group-portrait.json-NVIDIA RTX 5090')
        .find('.benchmarks__baseline-foot')
        .exists()
    ).toBe(false)

    await compareBy(wrapper, 'fastestJobDurationSeconds')
    expect(vsLabels(wrapper)).toEqual(['1.80× faster', '1.13× faster', 'Baseline'])

    await group(wrapper).get('.benchmarks__reset-baseline').trigger('click')
    expect(vsLabels(wrapper)).toEqual(['Fastest', '1.60× slower', '1.80× slower'])
    expect(group(wrapper).get('.benchmarks__vs-head').text()).toBe('Vs fastest')
  })

  it('does not label another equally fast run as the baseline', async () => {
    useBenchmarks([
      benchmark('21', 'a.json', 2, 'GPU', 'Build A'),
      benchmark('22', 'a.json', 2, 'GPU', 'Build B')
    ])
    const wrapper = mountView()
    await flushPromises()

    expect(vsLabels(wrapper, 'benchmark-group-a.json-GPU')).toEqual(['Fastest', 'Same speed'])
    expect(group(wrapper, 'benchmark-group-a.json-GPU').get('.benchmarks__summary').text()).toBe(
      'Build A and Build B run at the same speed.'
    )
  })

  it('shows runs without measurements as unavailable', async () => {
    useBenchmarks([...sampleBenchmarks, emptyRun('8')])
    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-testid="benchmark-row-8"]')
    expect(rowIds(wrapper)).toEqual(['13', '12', '9', '8'])
    expect(row.get('.benchmarks__no-data').text()).toBe('No measured runs')
    expect(row.find('.benchmarks__bar').exists()).toBe(false)
    expect(row.get('.benchmarks__value').text()).toBe('—')
    expect(row.get('.benchmarks__vs').text()).toBe('Unavailable')
    await openRowMenu(wrapper, '8')
    expect(menuItem('.benchmarks__set-baseline')?.hasAttribute('data-disabled')).toBe(true)
  })

  it('shows every time of a run when its bar is hovered', async () => {
    const wrapper = mountView()
    await flushPromises()

    await group(wrapper).get('[data-testid="benchmark-row-12"] .tooltip-wrap').trigger('focusin')
    await flushPromises()

    const tip = document.body.querySelector('.benchmarks__bar-tip')!
    expect(tip.textContent).toContain('12')
    expect(tip.textContent).toContain('Stable 0.3.60')
    expect(tip.textContent).toContain('5 runs')
    expect(tip.textContent).toContain('Fastest1.8 s')
    expect(tip.textContent).toContain('Average2.2 s')
    expect(tip.textContent).toContain('Median2.1 s')
    expect(tip.textContent).toContain('Slowest2.9 s')
  })

  it('compares by another metric and sorts by any header', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(
      compareBySelect(wrapper)
        .props('options')
        .map((option) => option.label)
    ).toEqual(['Fastest', 'Average', 'Median', 'Slowest'])
    await compareBy(wrapper, 'fastestJobDurationSeconds')
    expect(rowIds(wrapper)).toEqual(['9', '13', '12'])
    expect(group(wrapper).get('.benchmarks__bar-head').text()).toBe('Fastest and range')
    expect(group(wrapper).get('.benchmarks__summary').text()).toBe(
      'Stable 0.3.55 is the fastest, 38% ahead of Nightly 0.3.62.'
    )

    await group(wrapper).get('.benchmarks__metric-sort').trigger('click')
    expect(rowIds(wrapper)).toEqual(['12', '13', '9'])
    expect(group(wrapper).get('.benchmarks__metric-sort').text()).toBe('Fastest ↓')

    const sessionHeader = group(wrapper)
      .findAll('.benchmarks__sort')
      .find((header) => header.text().startsWith('Session'))!
    await sessionHeader.trigger('click')
    expect(rowIds(wrapper)).toEqual(['9', '13', '12'])
    await sessionHeader.trigger('click')
    expect(rowIds(wrapper)).toEqual(['12', '13', '9'])
  })

  it('reorders rows by dragging and with Alt+arrow keys', async () => {
    const wrapper = mountView()
    await flushPromises()
    const dataTransfer = new DataTransfer()

    await wrapper
      .get('[data-testid="benchmark-row-9"] .benchmarks__grip')
      .trigger('dragstart', { dataTransfer })
    await wrapper.get('[data-testid="benchmark-row-13"]').trigger('dragover', { dataTransfer })
    expect(
      wrapper.get('[data-testid="benchmark-row-13"]').classes('benchmarks__row--drop-target')
    ).toBe(true)
    await wrapper.get('[data-testid="benchmark-row-13"]').trigger('drop', { dataTransfer })

    expect(rowIds(wrapper)).toEqual(['9', '13', '12'])
    expect(compareBySelect(wrapper).props('modelValue')).toBe('manual')
    expect(compareBySelect(wrapper).props('options')[0]!.label).toBe('Manual')
    expect(group(wrapper).get('.benchmarks__metric-sort').text()).toBe('Median')
    expect(vsLabels(wrapper)).toEqual(['1.53× slower', 'Fastest', '1.11× slower'])

    await wrapper
      .get('[data-testid="benchmark-row-12"] .benchmarks__grip')
      .trigger('keydown', { key: 'ArrowLeft', altKey: true })
    expect(rowIds(wrapper)).toEqual(['9', '12', '13'])
    await wrapper
      .get('[data-testid="benchmark-row-9"] .benchmarks__grip')
      .trigger('keydown', { key: 'ArrowRight', altKey: true })
    expect(rowIds(wrapper)).toEqual(['12', '9', '13'])

    await wrapper
      .get('[data-testid="benchmark-row-11"] .benchmarks__grip')
      .trigger('dragstart', { dataTransfer })
    await wrapper.get('[data-testid="benchmark-row-12"]').trigger('drop', { dataTransfer })
    expect(rowIds(wrapper)).toEqual(['12', '9', '13'])

    await compareBy(wrapper, 'medianJobDurationSeconds')
    expect(rowIds(wrapper)).toEqual(['13', '12', '9'])
    expect(compareBySelect(wrapper).props('options')).toHaveLength(4)
  })

  it('collapses a group', async () => {
    const wrapper = mountView()
    await flushPromises()
    const toggle = group(wrapper).get('.benchmarks__group-toggle')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(group(wrapper).find('table').exists()).toBe(false)
    expect(group(wrapper).find('.benchmarks__summary').exists()).toBe(false)
    await toggle.trigger('click')
    expect(group(wrapper).find('table').exists()).toBe(true)
  })

  it('adds picked columns to the table and the export, best value in green', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="benchmark-column-systemInfo.cpu_model"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="benchmark-column-workflowName"]').exists()).toBe(false)
    await setChecked(
      wrapper.get('[data-testid="benchmark-column-averageJobDurationSeconds"]'),
      true
    )
    await setChecked(wrapper.get('[data-testid="benchmark-column-customScore"]'), true)
    await setChecked(wrapper.get('[data-testid="benchmark-column-instance.name"]'), false)

    expect(
      group(wrapper)
        .findAll('thead th')
        .map((header) => header.text())
    ).toEqual([
      '',
      'Session',
      'Median and range',
      'Average',
      'Custom Score',
      'Median ↑',
      'Vs fastest',
      ''
    ])
    expect(
      group(wrapper)
        .findAll('.benchmarks__best')
        .map((cell) => cell.text())
    ).toEqual(['2 s'])
    expect(group(wrapper).get('[data-testid="benchmark-cell-12-customScore"]').text()).toBe('12')

    await openMenu(wrapper, `[data-testid="${PORTRAIT_4090}"] .benchmarks__group-menu`)
    await chooseMenuItem('.benchmarks__export-group')
    const svg = lastExportedSvg()
    expect(svg).toContain('Custom Score')
    expect(svg).toContain('GPU / Hardware')
    expect(svg).toContain('Duration range')
  })

  it('closes the columns menu when clicking outside', async () => {
    const wrapper = mountView()
    await flushPromises()
    const picker = wrapper.get('.benchmarks__columns-picker')
    const details = picker.element as HTMLDetailsElement

    details.open = true
    await picker.get('[role="checkbox"]').trigger('pointerdown')
    expect(details.open).toBe(true)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(details.open).toBe(false)
  })

  it('filters by search and the toolbar selects', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('input[type="text"]').setValue('stable 0.3.55')
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="benchmark-row-9"]').exists()).toBe(true)

    await wrapper.get('input[type="text"]').setValue('nothing here')
    expect(wrapper.get('.benchmarks__no-results').text()).toContain('No runs match these filters')

    await wrapper.get('input[type="text"]').setValue('')
    const hardwareSelect = wrapper
      .findAllComponents(BaseSelect)
      .find((select) => select.props('ariaLabel') === 'All hardware')!
    hardwareSelect.vm.$emit('update:modelValue', 'Apple M3 Max')
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="benchmark-row-10"]').exists()).toBe(true)
  })

  it('labels unmanaged workspaces and unknown hardware', async () => {
    useBenchmarks([
      {
        ...benchmark('31', 'mystery.json', 1, null),
        workspace: { id: null, name: null }
      }
    ])
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.benchmarks__group-meta').text()).toBe(
      'Unknown hardware · 1 session · 5 runs'
    )
    const workspaceSelect = wrapper
      .findAllComponents(BaseSelect)
      .find((select) => select.props('ariaLabel') === 'All workspaces')!
    expect(workspaceSelect.props('options').map((option) => option.label)).toEqual([
      'All workspaces',
      'Unmanaged'
    ])
    workspaceSelect.vm.$emit('update:modelValue', '__unmanaged__')
    await flushPromises()
    expect(wrapper.find('[data-testid="benchmark-row-31"]').exists()).toBe(true)
  })

  it('exports the selected runs from the selection bar', async () => {
    const wrapper = mountView()
    await flushPromises()

    await selectRow(wrapper, '12')
    await selectRow(wrapper, '13')
    expect(wrapper.get('[data-testid="benchmark-row-12"]').classes()).toContain(
      'benchmarks__row--selected'
    )
    expect(wrapper.get('.benchmarks__selected-count').text()).toBe('2 selected')
    const exportButton = wrapper.get('.benchmarks__export-results')
    expect(exportButton.text()).toBe('Export results')
    await exportButton.trigger('click')
    await flushPromises()

    expect(exportResultsImageMock).toHaveBeenCalledTimes(1)
    const [png, imageType, defaultPath] = exportResultsImageMock.mock.calls[0] as unknown as [
      ArrayBuffer,
      string,
      string
    ]
    expect(png).toBeInstanceOf(ArrayBuffer)
    expect(imageType).toBe('benchmark-comparison')
    expect(defaultPath).toBe('C:\\results\\performance-tests')
    const svg = lastExportedSvg()
    expect(svg).toContain('Benchmark Comparison')
    expect(svg).toContain('portrait.json')
    expect(svg).toContain('Duration range')
    expect(svg).toContain('Each line shows the fastest and slowest run, with the average marked.')
    expect(svg.match(/class="table-cell best-cell"/g)).toHaveLength(4)

    await wrapper.get('.benchmarks__clear-selection').trigger('click')
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('exports relative speed once a baseline is chosen', async () => {
    const wrapper = mountView()
    await flushPromises()

    await openRowMenu(wrapper, '12')
    await chooseMenuItem('.benchmarks__set-baseline')
    await openMenu(wrapper, `[data-testid="${PORTRAIT_4090}"] .benchmarks__group-menu`)
    await chooseMenuItem('.benchmarks__select-group')
    expect(wrapper.get('.benchmarks__selected-count').text()).toBe('3 selected')
    await wrapper.get('.benchmarks__export-results').trigger('click')
    await flushPromises()

    const svg = lastExportedSvg()
    expect(svg).toContain('Relative speed')
    expect(svg).toContain('Relative speed factor = baseline duration / run duration.')
    expect(svg).toContain('1.11× Faster')
    expect(svg).toContain('1.00× Baseline')
    expect(svg).not.toContain('>Duration range (min → max)</text>')
  })

  it('shows export errors in the selection bar', async () => {
    exportResultsImageMock.mockResolvedValueOnce({ ok: false, message: 'Disk full' })
    const wrapper = mountView()
    await flushPromises()

    await selectRow(wrapper, '13')
    await wrapper.get('.benchmarks__export-results').trigger('click')
    await flushPromises()

    expect(wrapper.get('.benchmarks__export-error').text()).toBe('Disk full')
    await wrapper.get('.benchmarks__clear-selection').trigger('click')
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('limits exports to twenty runs', async () => {
    useBenchmarks(
      Array.from({ length: 21 }, (_, index) =>
        benchmark(String(index + 1), 'bulk.json', 2 + index / 10, 'GPU', `Build ${index}`)
      )
    )
    const wrapper = mountView()
    await flushPromises()

    await openMenu(wrapper, '.benchmarks__group-menu')
    expect(menuItem('.benchmarks__export-group')?.hasAttribute('data-disabled')).toBe(true)
    await chooseMenuItem('.benchmarks__select-group')

    expect(wrapper.get('.benchmarks__selected-count').text()).toBe('21 selected')
    expect(wrapper.get('.benchmarks__export-results').attributes()).toHaveProperty('disabled')
    await wrapper.get('.benchmarks__selection-bar .tooltip-wrap').trigger('focusin')
    await flushPromises()
    expect(document.body.textContent).toContain('Up to 20 runs')

    await selectRow(wrapper, '21', false)
    expect(wrapper.get('.benchmarks__export-results').attributes()).not.toHaveProperty('disabled')
  })

  it('confirms before deleting all files for a benchmark record', async () => {
    const wrapper = mountView()
    await flushPromises()
    const dialogs = useDialogs()
    await selectRow(wrapper, '13')

    await openRowMenu(wrapper, '13')
    await chooseMenuItem('.benchmarks__delete-record')
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
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('shows an error when the benchmark delete bridge rejects', async () => {
    deletePerformanceTestBenchmarkMock.mockRejectedValueOnce(new Error('Delete IPC unavailable'))
    const wrapper = mountView()
    await flushPromises()
    const dialogs = useDialogs()

    await openRowMenu(wrapper, '13')
    await chooseMenuItem('.benchmarks__delete-record')
    dialogs.confirmPrimary()
    await flushPromises()

    expect(dialogs.state.kind).toBe('alert')
    expect(dialogs.state.alert.title).toBe('Could not delete benchmark')
    expect(dialogs.state.alert.message).toBe('Delete IPC unavailable')
    expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(true)
  })

  it('renames a session inline and keeps its selection, order and baseline', async () => {
    const wrapper = mountView()
    await flushPromises()
    await openRowMenu(wrapper, '12')
    await chooseMenuItem('.benchmarks__set-baseline')
    await selectRow(wrapper, '12')

    await openRowMenu(wrapper, '12')
    await chooseMenuItem('.benchmarks__rename-session')
    const input = wrapper.get<HTMLInputElement>('.benchmarks__session-name-input')
    expect(input.element.value).toBe('12')
    expect(
      wrapper.get('[data-testid="benchmark-row-12"] .benchmarks__row-menu').attributes()
    ).toHaveProperty('disabled')
    await input.setValue('gpu-baseline')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(renamePerformanceTestBenchmarkMock).toHaveBeenCalledWith(
      'C:\\results\\performance-tests',
      '12',
      'gpu-baseline'
    )
    expect(wrapper.find('[data-testid="benchmark-row-12"]').exists()).toBe(false)
    expect(rowIds(wrapper)).toEqual(['13', 'gpu-baseline', '9'])
    expect(vsLabels(wrapper)).toEqual(['1.11× faster', 'Baseline', '1.38× slower'])
    expect(
      wrapper
        .get('[data-testid="benchmark-row-gpu-baseline"] [role="checkbox"]')
        .attributes('aria-checked')
    ).toBe('true')
  })

  it('edits a session name from the name itself and reports rename errors', async () => {
    renamePerformanceTestBenchmarkMock.mockResolvedValueOnce({ ok: false, message: 'Name taken' })
    const wrapper = mountView()
    await flushPromises()
    const dialogs = useDialogs()

    const sessionButton = wrapper.get('[data-testid="benchmark-row-13"] .benchmarks__session-name')
    expect(sessionButton.attributes('aria-label')).toBe('Edit session 13')
    await sessionButton.trigger('click')
    const input = wrapper.get<HTMLInputElement>('.benchmarks__session-name-input')
    await input.setValue('12')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(dialogs.state.kind).toBe('alert')
    expect(dialogs.state.alert.title).toBe('Could not rename session')
    expect(dialogs.state.alert.message).toBe('Name taken')
    dialogs.cancel()
    await flushPromises()

    await input.setValue('  ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(dialogs.state.alert.message).toBe('Enter a session name.')
    dialogs.cancel()
    await flushPromises()

    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.benchmarks__session-name-input').exists()).toBe(false)
    expect(renamePerformanceTestBenchmarkMock).toHaveBeenCalledTimes(1)
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

    expect(wrapper.get('.benchmarks__open-folder').attributes('title')).toBe(
      'C:\\results\\performance-tests'
    )
    await wrapper.get('.benchmarks__open-folder').trigger('click')
    await flushPromises()

    expect(api.browseFolder).toHaveBeenCalledWith('C:\\results\\performance-tests')
    expect(api.listPerformanceTestBenchmarks).toHaveBeenLastCalledWith(customFolder)
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="benchmark-row-10"]').text()).toContain('Stable 0.3.60')
  })

  it('refreshes the currently selected sessions folder', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="benchmarks-refresh"]').trigger('click')
    await flushPromises()

    expect(listMock()).toHaveBeenLastCalledWith('C:\\results\\performance-tests')
  })

  it('shows a skeleton while loading', async () => {
    listMock().mockReturnValue(new Promise(() => {}))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.benchmarks__state--loading').exists()).toBe(true)
    expect(
      wrapper
        .get('[data-testid="benchmarks-refresh"] svg')
        .classes('benchmarks__refresh-icon--busy')
    ).toBe(true)
  })

  it('offers a refresh when loading fails', async () => {
    listMock().mockRejectedValueOnce(new Error('broken'))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.benchmarks__state--error').text()).toContain(
      'Could not load performance test results'
    )
    useBenchmarks(sampleBenchmarks)
    await wrapper.get('.benchmarks__retry').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(5)
  })

  it('points to the Performance Test when there are no results', async () => {
    useBenchmarks([])
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.benchmarks__state--empty').text()).toContain(
      'No performance test results yet'
    )
    await wrapper.get('.benchmarks__open-performance-test').trigger('click')
    expect(navigatePanelMock).toHaveBeenCalledExactlyOnceWith('performance-test')
  })
})
