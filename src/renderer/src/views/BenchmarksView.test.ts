import { defineComponent, h, KeepAlive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { PerformanceTestBenchmark } from '../types/ipc'
import type * as PerformanceTestResultsSvg from '../lib/performanceTestResultsSvg'
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

const DEFAULT_FOLDER = 'C:\\results\\performance-tests'

interface RunOptions {
  gpu?: string | null
  cpu?: string
  build?: string
  fastest?: number
}

function run(
  id: string,
  workflowName: string,
  average: number,
  { gpu = 'NVIDIA RTX 4090', cpu = 'Test CPU', build = 'Nightly 0.3.62', fastest }: RunOptions = {}
): PerformanceTestBenchmark {
  const createdAt = `2026-09-${id.padStart(2, '0')}T10:00:00.000Z`
  const instance = { id: `instance-${build}`, name: build }
  const workspace = { id: 'workspace-1', name: 'Comfy' }
  const durations = {
    fastestJobDurationSeconds: fastest ?? average - 0.4,
    slowestJobDurationSeconds: average + 0.7,
    averageJobDurationSeconds: average,
    medianJobDurationSeconds: average - 0.1
  }
  return {
    id,
    createdAt,
    instance,
    workspace,
    workflowName,
    ...durations,
    measuredJobCount: 5,
    machine: { gpu, cpu, memoryGb: 64, platform: 'win32' },
    result: {
      createdAt,
      instance,
      workspace,
      workflowName,
      ...durations,
      measuredJobCount: 5,
      hardware: { deviceName: gpu },
      systemInfo: { cpu_model: cpu },
      customScore: Number(id)
    }
  }
}

function unmeasuredRun(id: string): PerformanceTestBenchmark {
  return {
    ...run(id, 'portrait.json', 1, { build: 'Broken build' }),
    fastestJobDurationSeconds: null,
    slowestJobDurationSeconds: null,
    averageJobDurationSeconds: null,
    medianJobDurationSeconds: null,
    measuredJobCount: 0
  }
}

const sampleBenchmarks = [
  run('13', 'portrait.json', 2),
  run('12', 'portrait.json', 2.2, { build: 'Stable 0.3.60' }),
  run('11', 'portrait.json', 1.2, { gpu: 'NVIDIA RTX 5090' }),
  run('10', 'landscape.json', 8.7, { gpu: 'Apple M3 Max', build: 'Stable 0.3.60' }),
  run('9', 'portrait.json', 3, { build: 'Stable 0.3.55', fastest: 1 })
]
const PORTRAIT_4090 = 'benchmark-group-NVIDIA RTX 4090'
const PORTRAIT_5090 = 'benchmark-group-NVIDIA RTX 5090'

function listMock(): ReturnType<typeof vi.fn> {
  return window.api.listPerformanceTestBenchmarks as unknown as ReturnType<typeof vi.fn>
}

function useBenchmarks(list: PerformanceTestBenchmark[], folderPath = DEFAULT_FOLDER): void {
  listMock().mockResolvedValue({ folderPath, benchmarks: list })
}

function mountView() {
  return mount(BenchmarksView, { attachTo: document.body })
}

async function mountGrouped(groupBy: string) {
  const wrapper = mountView()
  await flushPromises()
  await chooseOption(wrapper, 'group-by', groupBy)
  return wrapper
}

function group(wrapper: VueWrapper, testId = PORTRAIT_4090) {
  return wrapper.get(`[data-testid="${testId}"]`)
}

function row(wrapper: VueWrapper, id: string) {
  return wrapper.get(`[data-testid="benchmark-row-${id}"]`)
}

function rowIds(wrapper: VueWrapper, testId = PORTRAIT_4090): Array<string | undefined> {
  return group(wrapper, testId)
    .findAll('[data-testid^="benchmark-row-"]')
    .map((element) => element.attributes('data-testid')?.replace('benchmark-row-', ''))
}

function texts(wrapper: VueWrapper, selector: string, testId = PORTRAIT_4090): string[] {
  return group(wrapper, testId)
    .findAll(selector)
    .map((element) => element.text())
}

function vsLabels(wrapper: VueWrapper, testId = PORTRAIT_4090): string[] {
  return texts(wrapper, '.benchmarks__vs', testId)
}

async function openMenu(wrapper: VueWrapper, selector: string): Promise<void> {
  await wrapper.get(selector).trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
}

function openMenuElement(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="menu"]')
}

async function closeMenu(): Promise<void> {
  openMenuElement()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await vi.waitFor(() => expect(openMenuElement()).toBeNull())
}

function menuItem(selector: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[role="menu"] ${selector}`)
}

async function chooseMenuItem(selector: string): Promise<void> {
  menuItem(selector)!.click()
  await vi.waitFor(() => expect(openMenuElement()).toBeNull())
  await flushPromises()
}

async function menuOptions(wrapper: VueWrapper, key: string): Promise<string[]> {
  await openMenu(wrapper, `[data-testid="benchmarks-filter-${key}"]`)
  const labels = Array.from(
    document.body.querySelectorAll('[role="menu"] [role="menuitemradio"]'),
    (item) => item.textContent!.trim()
  )
  await closeMenu()
  return labels
}

async function chooseOption(wrapper: VueWrapper, key: string, label: string): Promise<void> {
  await openMenu(wrapper, `[data-testid="benchmarks-filter-${key}"]`)
  const option = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')
  ).find((item) => item.textContent!.trim() === label)
  expect(option, `option ${label}`).toBeDefined()
  option!.click()
  await vi.waitFor(() => expect(openMenuElement()).toBeNull())
  await flushPromises()
}

async function rowAction(wrapper: VueWrapper, id: string, action: string): Promise<void> {
  await openMenu(wrapper, `[data-testid="benchmark-row-${id}"] .benchmarks__row-menu`)
  await chooseMenuItem(action)
}

async function groupAction(wrapper: VueWrapper, action: string, testId = PORTRAIT_4090) {
  await openMenu(wrapper, `[data-testid="${testId}"] .benchmarks__group-menu`)
  await chooseMenuItem(action)
}

async function selectRow(wrapper: VueWrapper, id: string, checked = true): Promise<void> {
  await setChecked(row(wrapper, id).get('[role="checkbox"]'), checked)
}

async function search(wrapper: VueWrapper, query: string): Promise<void> {
  await wrapper.get<HTMLInputElement>('.benchmarks__search input').setValue(query)
}

async function drag(wrapper: VueWrapper, id: string, targetId: string): Promise<void> {
  const dataTransfer = new DataTransfer()
  await row(wrapper, id).get('.benchmarks__grip').trigger('dragstart', { dataTransfer })
  await row(wrapper, targetId).trigger('dragover', { dataTransfer })
  await row(wrapper, targetId).trigger('drop', { dataTransfer })
  await row(wrapper, id).get('.benchmarks__grip').trigger('dragend', { dataTransfer })
}

async function pressOnGrip(wrapper: VueWrapper, id: string, key: string): Promise<void> {
  const grip = row(wrapper, id).get<HTMLElement>('.benchmarks__grip')
  grip.element.focus()
  await grip.trigger('keydown', { key, altKey: true })
  await flushPromises()
}

async function exportSelection(wrapper: VueWrapper): Promise<string> {
  await wrapper.get('.benchmarks__export-results').trigger('click')
  await flushPromises()
  return createResultsPngMock.mock.calls.at(-1)![0]
}

function sessionField(wrapper: VueWrapper, id: string): HTMLElement {
  return row(wrapper, id).get<HTMLElement>('.benchmarks__session-name-text').element
}

async function typeSessionName(field: HTMLElement, name: string): Promise<void> {
  field.focus()
  field.textContent = name
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
}

function mountKeptAlive() {
  const Page = defineComponent({
    props: { visible: { type: Boolean, required: true } },
    setup: (props) => () =>
      h(KeepAlive, null, { default: () => (props.visible ? h(BenchmarksView) : h('div')) })
  })
  return mount(Page, { props: { visible: true } })
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
        folderPath: DEFAULT_FOLDER,
        benchmarks: sampleBenchmarks
      }))
    }
  })

  describe('returning to the page', () => {
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
      vi.mocked(window.api.browseFolder).mockResolvedValue('D:\\other')
      listMock().mockImplementation(async (folderPath?: string) => ({
        folderPath: folderPath ?? DEFAULT_FOLDER,
        benchmarks: sampleBenchmarks
      }))
      const wrapper = mountKeptAlive()
      await flushPromises()
      await wrapper.get('.benchmarks__open-folder').trigger('click')
      await flushPromises()
      await selectRow(wrapper, '10')
      await wrapper.get<HTMLInputElement>('.benchmarks__search input').setValue('json')

      await leaveAndReturn(wrapper)

      expect(listMock()).toHaveBeenLastCalledWith('D:\\other')
      expect(wrapper.get<HTMLInputElement>('.benchmarks__search input').element.value).toBe('json')
      expect(row(wrapper, '13').get('[role="checkbox"]').attributes('aria-checked')).toBe('false')
      expect(row(wrapper, '10').get('[role="checkbox"]').attributes('aria-checked')).toBe('true')
    })

    it('shows runs that finished meanwhile and drops picks that are gone', async () => {
      const wrapper = mountKeptAlive()
      await flushPromises()
      await selectRow(wrapper, '13')
      await selectRow(wrapper, '12')
      useBenchmarks([run('14', 'new.json', 1), ...sampleBenchmarks.slice(1)])

      await leaveAndReturn(wrapper)

      expect(wrapper.find('[data-testid="benchmark-row-14"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(false)
      expect(row(wrapper, '14').get('[role="checkbox"]').attributes('aria-checked')).toBe('false')
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

  it('keeps the data filters apart from the view options', async () => {
    const wrapper = mountView()
    await flushPromises()
    const keysIn = (selector: string) =>
      wrapper
        .get(selector)
        .findAll('[data-testid^="benchmarks-filter-"]')
        .map((button) => button.attributes('data-testid'))

    expect(keysIn('.benchmarks__filters')).toEqual([
      'benchmarks-filter-workspace',
      'benchmarks-filter-build',
      'benchmarks-filter-hardware',
      'benchmarks-filter-workflow'
    ])
    expect(keysIn('.benchmarks__view-options')).toEqual([
      'benchmarks-filter-group-by',
      'benchmarks-filter-compare-by'
    ])
  })

  it('compares the builds that ran on each machine when grouped by hardware', async () => {
    const wrapper = await mountGrouped('Hardware')

    const cards = wrapper.findAll('.benchmarks__group')
    expect(cards.map((card) => card.get('.benchmarks__group-toggle').text())).toEqual([
      'NVIDIA RTX 4090',
      'NVIDIA RTX 5090',
      'Apple M3 Max'
    ])
    expect(cards.map((card) => card.get('.benchmarks__group-meta').text())).toEqual([
      '3 sessions · 15 runs',
      '1 session · 5 runs',
      '1 session · 5 runs'
    ])
    expect(texts(wrapper, 'thead th')).toEqual([
      '',
      'Session',
      'Workflow',
      'Build',
      'Median and range',
      'Median ↑',
      'Vs baseline',
      ''
    ])
    expect(rowIds(wrapper)).toEqual(['13', '12', '9'])
    expect(texts(wrapper, '.benchmarks__build')).toEqual([
      'Nightly 0.3.62',
      'Stable 0.3.60',
      'Stable 0.3.55'
    ])
    expect(texts(wrapper, '.benchmarks__value')).toEqual(['1.9 s', '2.1 s', '2.9 s'])
    expect(vsLabels(wrapper)).toEqual(['Fastest', '1.11× slower', '1.53× slower'])
    expect(
      group(wrapper)
        .findAll('.benchmarks__bar-fill--best')
        .map((fill) => fill.element.closest('tr')?.getAttribute('data-testid'))
    ).toEqual(['benchmark-row-13'])
    expect(
      Number.parseFloat(
        (row(wrapper, '13').get('.benchmarks__bar-fill').element as HTMLElement).style.width
      )
    ).toBeCloseTo((1.9 / 3.7) * 100, 3)
    expect(wrapper.find('.benchmarks__single-note').exists()).toBe(false)
    expect(vsLabels(wrapper, PORTRAIT_5090)).toEqual([''])
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('keeps different computers with the same GPU in separate comparisons', async () => {
    useBenchmarks([
      run('21', 'a.json', 2, { cpu: 'AMD Ryzen 9 7950X' }),
      run('22', 'a.json', 3, { cpu: 'Intel Core i9-14900K' }),
      run('23', 'a.json', 2.5, { cpu: 'AMD Ryzen 9 7950X', build: 'Stable' })
    ])
    const wrapper = await mountGrouped('Hardware')

    expect(texts(wrapper, '.benchmarks__group-toggle', 'benchmarks')).toEqual([
      'NVIDIA RTX 4090 · AMD Ryzen 9 7950X',
      'NVIDIA RTX 4090 · Intel Core i9-14900K'
    ])
    expect(texts(wrapper, '.benchmarks__group-meta', 'benchmarks')).toEqual([
      '2 sessions · 10 runs',
      '1 session · 5 runs'
    ])
    expect(await menuOptions(wrapper, 'hardware')).toEqual([
      'All',
      'NVIDIA RTX 4090 · AMD Ryzen 9 7950X',
      'NVIDIA RTX 4090 · Intel Core i9-14900K'
    ])
    await chooseOption(wrapper, 'hardware', 'NVIDIA RTX 4090 · Intel Core i9-14900K')
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="benchmark-row-22"]').exists()).toBe(true)
  })

  it('compares filtered runs with the fastest run of the whole group', async () => {
    const wrapper = await mountGrouped('Hardware')

    await search(wrapper, 'stable 0.3.55')
    expect(rowIds(wrapper)).toEqual(['9'])
    expect(vsLabels(wrapper)).toEqual(['1.53× slower'])
    expect(group(wrapper).get('.benchmarks__vs-head').text()).toBe('Vs baseline')
    expect(group(wrapper).get('.benchmarks__reference-hidden').text()).toBe(
      'Compared with session 13, which the filters hide.'
    )

    await search(wrapper, '')
    await chooseOption(wrapper, 'build', 'Stable 0.3.60')
    expect(rowIds(wrapper)).toEqual(['12'])
    expect(vsLabels(wrapper)).toEqual(['1.11× slower'])

    await chooseOption(wrapper, 'group-by', 'Workflow')
    expect(rowIds(wrapper, 'benchmark-group-portrait.json')).toEqual(['12'])
    expect(
      group(wrapper, 'benchmark-group-portrait.json').find('.benchmarks__single-note').exists()
    ).toBe(false)
    expect(
      group(wrapper, 'benchmark-group-landscape.json').get('.benchmarks__single-note').text()
    ).toBe('Only one build ran this workflow here. Run it on another build to compare.')
  })

  it('keeps a chosen baseline while filters hide it, and resets it', async () => {
    const wrapper = await mountGrouped('Hardware')

    await rowAction(wrapper, '12', '.benchmarks__set-baseline')
    expect(vsLabels(wrapper)).toEqual(['1.11× faster', 'Baseline', '1.38× slower'])
    expect(group(wrapper).get('.benchmarks__vs-head').text()).toBe('Vs baseline')
    expect(group(wrapper).get('.benchmarks__group-foot').text()).toContain(
      'Speed = baseline time ÷ run time'
    )
    expect(group(wrapper, PORTRAIT_5090).find('.benchmarks__group-foot').exists()).toBe(false)

    await search(wrapper, 'stable 0.3.55')
    expect(vsLabels(wrapper)).toEqual(['1.38× slower'])
    expect(group(wrapper).get('.benchmarks__vs-head').text()).toBe('Vs baseline')
    expect(group(wrapper).get('.benchmarks__reference-hidden').text()).toBe(
      'Compared with session 12, which the filters hide.'
    )
    expect(group(wrapper).find('.benchmarks__reset-baseline').exists()).toBe(true)

    await search(wrapper, '')
    await chooseOption(wrapper, 'compare-by', 'Fastest')
    expect(rowIds(wrapper)).toEqual(['9', '13', '12'])
    expect(vsLabels(wrapper)).toEqual(['1.80× faster', '1.13× faster', 'Baseline'])

    await group(wrapper).get('.benchmarks__reset-baseline').trigger('click')
    expect(vsLabels(wrapper)).toEqual(['Fastest', '1.60× slower', '1.80× slower'])
    expect(group(wrapper).get('.benchmarks__vs-head').text()).toBe('Vs baseline')
  })

  it('calls equally fast runs the same speed', async () => {
    useBenchmarks([
      run('21', 'a.json', 2, { gpu: 'GPU', build: 'Build A' }),
      run('22', 'a.json', 2, { gpu: 'GPU', build: 'Build B' })
    ])
    const wrapper = await mountGrouped('Hardware')

    expect(vsLabels(wrapper, 'benchmark-group-GPU')).toEqual(['Fastest', 'Same speed'])
  })

  it('shows runs without measurements as unavailable', async () => {
    useBenchmarks([...sampleBenchmarks, unmeasuredRun('8')])
    const wrapper = await mountGrouped('Hardware')

    expect(rowIds(wrapper)).toEqual(['13', '12', '9', '8'])
    expect(row(wrapper, '8').get('.benchmarks__no-data').text()).toBe('No measured runs')
    expect(row(wrapper, '8').find('.benchmarks__bar').exists()).toBe(false)
    expect(row(wrapper, '8').get('.benchmarks__value').text()).toBe('—')
    expect(row(wrapper, '8').get('.benchmarks__vs').text()).toBe('Unavailable')
    await openMenu(wrapper, '[data-testid="benchmark-row-8"] .benchmarks__row-menu')
    expect(menuItem('.benchmarks__set-baseline')?.hasAttribute('data-disabled')).toBe(true)
  })

  it('shows every time of a run from its bar, by pointer or keyboard', async () => {
    const wrapper = mountView()
    await flushPromises()
    const bar = row(wrapper, '12').get('.benchmarks__bar')

    expect(bar.attributes('tabindex')).toBe('0')
    expect(bar.attributes('aria-label')).toBe(
      'Fastest 1.8 s, Average 2.2 s, Median 2.1 s, Slowest 2.9 s'
    )
    await row(wrapper, '12').get('.tooltip-wrap').trigger('focusin')
    await flushPromises()

    const tip = document.body.querySelector('.benchmarks__bar-tip')!
    expect(tip.textContent).toContain('Stable 0.3.60')
    expect(tip.textContent).toContain('5 runs')
    expect(tip.textContent).toContain('Fastest1.8 s')
    expect(tip.textContent).toContain('Slowest2.9 s')
  })

  it('compares by another metric and sorts by any header', async () => {
    const wrapper = await mountGrouped('Hardware')

    expect(await menuOptions(wrapper, 'compare-by')).toEqual([
      'Fastest',
      'Average',
      'Median',
      'Slowest'
    ])
    await chooseOption(wrapper, 'compare-by', 'Fastest')
    expect(wrapper.get('[data-testid="benchmarks-filter-compare-by"]').text()).toBe(
      'Compare byFastest'
    )
    expect(rowIds(wrapper)).toEqual(['9', '13', '12'])
    expect(group(wrapper).get('.benchmarks__bar-head').text()).toBe('Fastest and range')

    await group(wrapper).get('.benchmarks__metric-sort').trigger('click')
    expect(rowIds(wrapper)).toEqual(['12', '13', '9'])
    expect(group(wrapper).get('.benchmarks__metric-sort').text()).toBe('Fastest ↓')

    const sessionHeader = group(wrapper)
      .findAll('.benchmarks__sort')
      .find((header) => header.text().startsWith('Session'))!
    await sessionHeader.trigger('click')
    expect(rowIds(wrapper)).toEqual(['13', '12', '9'])
    await sessionHeader.trigger('click')
    expect(rowIds(wrapper)).toEqual(['9', '12', '13'])
  })

  it('moves rows up and down by dragging and with Alt+arrow keys', async () => {
    const wrapper = await mountGrouped('Hardware')

    await drag(wrapper, '13', '12')
    expect(rowIds(wrapper)).toEqual(['12', '13', '9'])
    await drag(wrapper, '12', '9')
    expect(rowIds(wrapper)).toEqual(['13', '9', '12'])
    await drag(wrapper, '12', '13')
    expect(rowIds(wrapper)).toEqual(['12', '13', '9'])
    expect(group(wrapper).get('.benchmarks__metric-sort').text()).toBe('Median')
    expect(vsLabels(wrapper)).toEqual(['1.11× slower', 'Fastest', '1.53× slower'])

    await pressOnGrip(wrapper, '9', 'ArrowUp')
    expect(rowIds(wrapper)).toEqual(['12', '9', '13'])
    expect(document.activeElement).toBe(row(wrapper, '9').get('.benchmarks__grip').element)
    await pressOnGrip(wrapper, '12', 'ArrowDown')
    expect(rowIds(wrapper)).toEqual(['9', '12', '13'])

    await drag(wrapper, '11', '12')
    expect(rowIds(wrapper)).toEqual(['9', '12', '13'])
    expect(rowIds(wrapper, PORTRAIT_5090)).toEqual(['11'])
  })

  it('clears the drop highlight when a drag leaves the table', async () => {
    const wrapper = await mountGrouped('Hardware')
    const dataTransfer = new DataTransfer()

    await row(wrapper, '9').get('.benchmarks__grip').trigger('dragstart', { dataTransfer })
    await row(wrapper, '13').trigger('dragover', { dataTransfer })
    expect(row(wrapper, '13').classes()).toContain('benchmarks__row--drop-target')

    group(wrapper)
      .get('tbody')
      .element.dispatchEvent(
        new DragEvent('dragleave', {
          bubbles: true,
          dataTransfer,
          relatedTarget: row(wrapper, '11').element
        })
      )
    await flushPromises()
    expect(row(wrapper, '13').classes()).not.toContain('benchmarks__row--drop-target')
  })

  it('keeps every row movable after filters change, runs arrive or another folder loads', async () => {
    const wrapper = await mountGrouped('Hardware')

    await search(wrapper, 'stable')
    await drag(wrapper, '9', '12')
    await search(wrapper, '')
    expect(rowIds(wrapper)).toEqual(['13', '9', '12'])
    await pressOnGrip(wrapper, '13', 'ArrowDown')
    expect(rowIds(wrapper)).toEqual(['9', '13', '12'])

    useBenchmarks([...sampleBenchmarks, run('14', 'portrait.json', 5, { build: 'Old' })])
    await wrapper.get('[data-testid="benchmarks-refresh"]').trigger('click')
    await flushPromises()
    expect(rowIds(wrapper)).toEqual(['9', '13', '12', '14'])
    await pressOnGrip(wrapper, '14', 'ArrowUp')
    expect(rowIds(wrapper)).toEqual(['9', '13', '14', '12'])

    vi.mocked(window.api.browseFolder).mockResolvedValue('D:\\shared')
    useBenchmarks(sampleBenchmarks, 'D:\\shared')
    await wrapper.get('.benchmarks__open-folder').trigger('click')
    await flushPromises()
    expect(rowIds(wrapper)).toEqual(['13', '12', '9'])
    expect(group(wrapper).get('.benchmarks__metric-sort').text()).toBe('Median ↑')
    await pressOnGrip(wrapper, '9', 'ArrowUp')
    expect(rowIds(wrapper)).toEqual(['13', '9', '12'])
  })

  it('sorts again by any header after a manual order', async () => {
    const wrapper = await mountGrouped('Hardware')

    await drag(wrapper, '9', '13')
    expect(rowIds(wrapper)).toEqual(['9', '13', '12'])
    await group(wrapper).get('.benchmarks__metric-sort').trigger('click')

    expect(rowIds(wrapper)).toEqual(['13', '12', '9'])
    expect(group(wrapper).get('.benchmarks__metric-sort').text()).toBe('Median ↑')
  })

  it('collapses a group', async () => {
    const wrapper = await mountGrouped('Hardware')
    const toggle = group(wrapper).get('.benchmarks__group-toggle')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(group(wrapper).find('table').exists()).toBe(false)
    await toggle.trigger('click')
    expect(group(wrapper).find('table').exists()).toBe(true)
  })

  it('checks every column the table shows and hides the ones you uncheck', async () => {
    const wrapper = await mountGrouped('Hardware')
    const checked = (key: string) =>
      menuItem(`[data-testid="benchmark-column-${key}"]`)!.getAttribute('aria-checked')
    const locked = (key: string) =>
      menuItem(`[data-testid="benchmark-column-${key}"]`)!.hasAttribute('data-disabled')

    await openMenu(wrapper, '[data-testid="benchmarks-columns"]')
    const title = document.querySelector('.benchmarks__columns-title')!
    expect(title.textContent?.trim()).toBe('Columns to display')
    expect(title.classList).toContain('uppercase')
    for (const key of [
      'id',
      'workflowName',
      'instance.name',
      'range',
      'medianJobDurationSeconds',
      'vsBaseline'
    ]) {
      expect(checked(key), key).toBe('true')
    }
    expect(checked('averageJobDurationSeconds')).toBe('false')
    expect(['id', 'medianJobDurationSeconds', 'vsBaseline'].every(locked)).toBe(true)
    expect(['workflowName', 'instance.name', 'range'].some(locked)).toBe(false)

    menuItem('[data-testid="benchmark-column-range"]')!.click()
    menuItem('[data-testid="benchmark-column-workflowName"]')!.click()
    await flushPromises()
    await closeMenu()

    expect(texts(wrapper, 'thead th')).toEqual([
      '',
      'Session',
      'Build',
      'Median ↑',
      'Vs baseline',
      ''
    ])
    expect(wrapper.find('.benchmarks__bar-cell').exists()).toBe(false)
  })

  it('adds picked columns to the table and the export, best value in green', async () => {
    const wrapper = await mountGrouped('Hardware')

    await openMenu(wrapper, '[data-testid="benchmarks-columns"]')
    expect(menuItem('[data-testid="benchmark-column-systemInfo.cpu_model"]')).not.toBeNull()
    menuItem('[data-testid="benchmark-column-averageJobDurationSeconds"]')!.click()
    await flushPromises()
    expect(openMenuElement()).not.toBeNull()
    menuItem('[data-testid="benchmark-column-customScore"]')!.click()
    menuItem('[data-testid="benchmark-column-instance.name"]')!.click()
    await flushPromises()
    expect(
      menuItem('[data-testid="benchmark-column-customScore"]')!.getAttribute('aria-checked')
    ).toBe('true')
    await closeMenu()

    expect(texts(wrapper, 'thead th')).toEqual([
      '',
      'Session',
      'Workflow',
      'Median and range',
      'Average',
      'Custom Score',
      'Median ↑',
      'Vs baseline',
      ''
    ])
    expect(texts(wrapper, '.benchmarks__best')).toEqual(['2 s'])
    expect(row(wrapper, '12').get('[data-testid="benchmark-cell-12-customScore"]').text()).toBe(
      '12'
    )

    await groupAction(wrapper, '.benchmarks__export-group')
    const svg = createResultsPngMock.mock.calls.at(-1)![0]
    expect(svg).toContain('Custom Score: 13')
    expect(svg).toContain('GPU / Hardware: NVIDIA RTX 4090')
    expect(svg).toContain('Duration range')
  })

  it('compares every run in one table by default and groups on demand', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('.benchmarks__group')).toHaveLength(1)
    expect(group(wrapper, 'benchmark-group-all').get('.benchmarks__group-toggle').text()).toBe(
      'All runs'
    )
    expect(rowIds(wrapper, 'benchmark-group-all')).toHaveLength(5)
    expect(texts(wrapper, '.benchmarks__workflow', 'benchmark-group-all')).toContain(
      'landscape.json'
    )
    expect(wrapper.find('.benchmarks__single-note').exists()).toBe(false)
    expect(await menuOptions(wrapper, 'group-by')).toEqual(['None', 'Workflow', 'Hardware'])

    await chooseOption(wrapper, 'group-by', 'Workflow')
    expect(wrapper.findAll('.benchmarks__group-toggle').map((toggle) => toggle.text())).toEqual([
      'portrait.json',
      'landscape.json'
    ])
    expect(wrapper.find('.benchmarks__workflow').exists()).toBe(false)
    expect(texts(wrapper, 'thead th', 'benchmark-group-portrait.json')).toContain('Vs baseline')

    await chooseOption(wrapper, 'group-by', 'None')
    expect(wrapper.findAll('.benchmarks__group')).toHaveLength(1)
  })

  it('truncates long workflow names and keeps the full name in a tooltip', async () => {
    const longName = 'my_client_project_final_v3_portrait_upscale_with_face_detailer_2x.json'
    useBenchmarks([run('5', longName, 2), run('6', longName, 3, { build: 'Stable 0.3.60' })])
    const wrapper = mountView()
    await flushPromises()

    const cell = row(wrapper, '5').get('.benchmarks__workflow')
    expect(cell.classes()).toContain('truncate')
    expect(cell.attributes('title')).toBe(longName)

    await chooseOption(wrapper, 'group-by', 'Workflow')
    const toggle = group(wrapper, `benchmark-group-${longName}`).get('.benchmarks__group-toggle')
    expect(toggle.attributes('title')).toBe(longName)
    expect(toggle.get('.benchmarks__group-label').classes()).toContain('truncate')
  })

  it('sets and resets the baseline from the flag on a row', async () => {
    const wrapper = await mountGrouped('Hardware')

    expect(row(wrapper, '13').find('[data-testid="benchmark-baseline-13"]').exists()).toBe(false)
    const flag = row(wrapper, '12').get('[data-testid="benchmark-baseline-12"]')
    expect(flag.attributes('aria-pressed')).toBe('false')
    expect(flag.attributes('aria-label')).toBe('Set as baseline')

    await flag.trigger('click')
    const chosen = row(wrapper, '12').get('[data-testid="benchmark-baseline-12"]')
    expect(chosen.attributes('aria-pressed')).toBe('true')
    expect(chosen.attributes('aria-label')).toBe('Reset baseline')
    expect(group(wrapper).find('.benchmarks__reset-baseline').exists()).toBe(true)
    expect(row(wrapper, '13').find('[data-testid="benchmark-baseline-13"]').exists()).toBe(true)

    await chosen.trigger('click')
    expect(vsLabels(wrapper)).toEqual(['Fastest', '1.11× slower', '1.53× slower'])
    expect(group(wrapper).find('.benchmarks__reset-baseline').exists()).toBe(false)
  })

  it('reorders picked columns by dragging headers and with Alt+arrow keys', async () => {
    const wrapper = mountView()
    await flushPromises()
    await openMenu(wrapper, '[data-testid="benchmarks-columns"]')
    menuItem('[data-testid="benchmark-column-averageJobDurationSeconds"]')!.click()
    menuItem('[data-testid="benchmark-column-customScore"]')!.click()
    await flushPromises()
    await closeMenu()
    const heads = () =>
      wrapper
        .findAll('[data-testid^="benchmark-column-head-"]')
        .map((head) => head.attributes('data-testid')!.replace('benchmark-column-head-', ''))
    const head = (key: string) => wrapper.get(`[data-testid="benchmark-column-head-${key}"]`)
    expect(heads()).toEqual(['averageJobDurationSeconds', 'customScore'])

    const dataTransfer = new DataTransfer()
    await head('customScore').trigger('dragstart', { dataTransfer })
    await head('averageJobDurationSeconds').trigger('dragover', { dataTransfer })
    expect(head('averageJobDurationSeconds').classes()).toContain(
      'benchmarks__column-head--drop-target'
    )
    await head('averageJobDurationSeconds').trigger('drop', { dataTransfer })
    await head('customScore').trigger('dragend', { dataTransfer })
    expect(heads()).toEqual(['customScore', 'averageJobDurationSeconds'])
    expect(wrapper.find('.benchmarks__column-head--drop-target').exists()).toBe(false)

    await head('customScore').get('button').trigger('keydown', { key: 'ArrowRight', altKey: true })
    expect(heads()).toEqual(['averageJobDurationSeconds', 'customScore'])
    await head('averageJobDurationSeconds')
      .get('button')
      .trigger('keydown', { key: 'ArrowLeft', altKey: true })
    expect(heads()).toEqual(['averageJobDurationSeconds', 'customScore'])
  })

  it('filters by search and the toolbar menus', async () => {
    const wrapper = mountView()
    await flushPromises()

    await search(wrapper, 'stable 0.3.55')
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="benchmark-row-9"]').exists()).toBe(true)

    await search(wrapper, 'nothing here')
    expect(wrapper.get('.benchmarks__no-results').text()).toContain('No runs match these filters')

    await search(wrapper, '')
    await chooseOption(wrapper, 'hardware', 'Apple M3 Max')
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="benchmark-row-10"]').exists()).toBe(true)
    await chooseOption(wrapper, 'hardware', 'All')
    await chooseOption(wrapper, 'workflow', 'landscape.json')
    expect(wrapper.findAll('.benchmarks__group')).toHaveLength(1)
  })

  it('labels unmanaged workspaces and unknown hardware', async () => {
    useBenchmarks([
      { ...run('31', 'mystery.json', 1, { gpu: null }), workspace: { id: null, name: null } }
    ])
    const wrapper = await mountGrouped('Hardware')

    expect(wrapper.get('.benchmarks__group-toggle').text()).toBe('Unknown hardware')
    expect(wrapper.get('.benchmarks__group-meta').text()).toBe('1 session · 5 runs')
    expect(await menuOptions(wrapper, 'workspace')).toEqual(['All', 'Unmanaged'])
    await chooseOption(wrapper, 'workspace', 'Unmanaged')
    expect(wrapper.find('[data-testid="benchmark-row-31"]').exists()).toBe(true)
  })

  it('exports the selected runs that are on screen', async () => {
    const wrapper = mountView()
    await flushPromises()

    await selectRow(wrapper, '12')
    await selectRow(wrapper, '13')
    expect(row(wrapper, '12').classes()).toContain('benchmarks__row--selected')
    expect(wrapper.get('.benchmarks__selected-count').text()).toBe('2 selected')
    let svg = await exportSelection(wrapper)
    const [png, imageType, defaultPath] = exportResultsImageMock.mock.calls[0] as unknown as [
      ArrayBuffer,
      string,
      string
    ]
    expect(png).toBeInstanceOf(ArrayBuffer)
    expect(imageType).toBe('benchmark-comparison')
    expect(defaultPath).toBe(DEFAULT_FOLDER)
    expect(svg).toContain('Session: 13')
    expect(svg).toContain('Session: 12')
    expect(svg.indexOf('Session: 13')).toBeLessThan(svg.indexOf('Session: 12'))
    expect(svg).toContain('Each line shows the fastest and slowest run, with the average marked.')
    expect(svg.match(/fill="#e8e8ee"/g)?.length).toBeGreaterThan(0)
    expect(svg.match(/fill="#7aa2f7"/g)?.length).toBeGreaterThan(0)

    await search(wrapper, 'nightly')
    expect(wrapper.get('.benchmarks__selected-count').text()).toBe('1 selected')
    svg = await exportSelection(wrapper)
    expect(svg).toContain('Session: 13')
    expect(svg).not.toContain('Session: 12')

    await search(wrapper, '')
    expect(wrapper.get('.benchmarks__selected-count').text()).toBe('2 selected')
    await wrapper.get('.benchmarks__clear-selection').trigger('click')
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('exports relative speed only for one group with a chosen baseline', async () => {
    const wrapper = await mountGrouped('Hardware')

    await rowAction(wrapper, '12', '.benchmarks__set-baseline')
    await groupAction(wrapper, '.benchmarks__select-group')
    expect(wrapper.get('.benchmarks__selected-count').text()).toBe('3 selected')
    let svg = await exportSelection(wrapper)
    expect(svg).toContain('Relative speed factor = baseline duration / run duration.')
    expect(svg).toContain('1.11× Faster')
    expect(svg).toContain('1.00× Baseline')

    await selectRow(wrapper, '11')
    svg = await exportSelection(wrapper)
    expect(svg).not.toContain('Relative speed')
    expect(svg).toContain('Duration range (min → max)')
  })

  it('shows export errors in the selection bar until the list reloads', async () => {
    exportResultsImageMock.mockResolvedValueOnce({ ok: false, message: 'Disk full' })
    const wrapper = await mountGrouped('Hardware')

    await groupAction(wrapper, '.benchmarks__export-group')
    expect(wrapper.get('.benchmarks__export-error').text()).toBe('Disk full')
    expect(wrapper.find('.benchmarks__selected-count').exists()).toBe(false)

    await wrapper.get('[data-testid="benchmarks-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('limits exports to twenty runs', async () => {
    useBenchmarks(
      Array.from({ length: 21 }, (_, index) =>
        run(String(index + 1), 'bulk.json', 2 + index / 10, { gpu: 'GPU', build: `Build ${index}` })
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

  it('renames a session in place and keeps its selection, order and baseline', async () => {
    const wrapper = await mountGrouped('Hardware')
    await rowAction(wrapper, '12', '.benchmarks__set-baseline')
    await selectRow(wrapper, '12')
    await drag(wrapper, '9', '13')

    await rowAction(wrapper, '12', '.benchmarks__rename-session')
    await vi.waitFor(() => expect(document.activeElement).toBe(sessionField(wrapper, '12')))
    await typeSessionName(sessionField(wrapper, '12'), 'gpu-baseline')

    expect(renamePerformanceTestBenchmarkMock).toHaveBeenCalledWith(
      DEFAULT_FOLDER,
      '12',
      'gpu-baseline'
    )
    expect(rowIds(wrapper)).toEqual(['9', '13', 'gpu-baseline'])
    expect(vsLabels(wrapper)).toEqual(['1.38× slower', '1.11× faster', 'Baseline'])
    expect(row(wrapper, 'gpu-baseline').get('[role="checkbox"]').attributes('aria-checked')).toBe(
      'true'
    )
  })

  it('puts the old name back when a rename is refused', async () => {
    renamePerformanceTestBenchmarkMock.mockResolvedValueOnce({ ok: false, message: 'Name taken' })
    const wrapper = await mountGrouped('Hardware')
    const dialogs = useDialogs()

    expect(sessionField(wrapper, '13').getAttribute('aria-label')).toBe('Edit session 13')
    await typeSessionName(sessionField(wrapper, '13'), '12')

    expect(dialogs.state.kind).toBe('alert')
    expect(dialogs.state.alert.title).toBe('Could not rename session')
    expect(dialogs.state.alert.message).toBe('Name taken')
    dialogs.cancel()
    await flushPromises()
    expect(sessionField(wrapper, '13').textContent).toBe('13')
    expect(rowIds(wrapper)).toEqual(['13', '12', '9'])
  })

  it('confirms before deleting all files for a session', async () => {
    const wrapper = await mountGrouped('Hardware')
    const dialogs = useDialogs()
    await selectRow(wrapper, '13')

    await rowAction(wrapper, '13', '.benchmarks__delete-record')
    expect(dialogs.state.kind).toBe('confirm')
    expect(dialogs.state.confirm.title).toBe('Delete portrait.json?')
    expect(dialogs.state.confirm.message).toContain('permanently delete all files for session 13')
    expect(deletePerformanceTestBenchmarkMock).not.toHaveBeenCalled()

    dialogs.confirmPrimary()
    await flushPromises()

    expect(deletePerformanceTestBenchmarkMock).toHaveBeenCalledWith(DEFAULT_FOLDER, '13')
    expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(false)
    expect(vsLabels(wrapper)).toEqual(['Fastest', '1.38× slower'])
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('shows an error when deleting a session fails', async () => {
    deletePerformanceTestBenchmarkMock.mockRejectedValueOnce(new Error('Delete IPC unavailable'))
    const wrapper = mountView()
    await flushPromises()
    const dialogs = useDialogs()

    await rowAction(wrapper, '13', '.benchmarks__delete-record')
    dialogs.confirmPrimary()
    await flushPromises()

    expect(dialogs.state.kind).toBe('alert')
    expect(dialogs.state.alert.title).toBe('Could not delete benchmark')
    expect(dialogs.state.alert.message).toBe('Delete IPC unavailable')
    expect(wrapper.find('[data-testid="benchmark-row-13"]').exists()).toBe(true)
  })

  it('opens the current results folder in the picker and loads a selected folder', async () => {
    const customFolder = 'D:\\shared-benchmarks'
    vi.mocked(window.api.browseFolder).mockResolvedValue(customFolder)
    listMock()
      .mockReset()
      .mockResolvedValueOnce({ folderPath: DEFAULT_FOLDER, benchmarks: sampleBenchmarks })
      .mockResolvedValueOnce({ folderPath: customFolder, benchmarks: [sampleBenchmarks[3]!] })
    const wrapper = mountView()
    await flushPromises()
    await selectRow(wrapper, '10')

    expect(wrapper.get('.benchmarks__open-folder').attributes('title')).toBe(DEFAULT_FOLDER)
    await wrapper.get('.benchmarks__open-folder').trigger('click')
    await flushPromises()

    expect(window.api.browseFolder).toHaveBeenCalledWith(DEFAULT_FOLDER)
    expect(listMock()).toHaveBeenLastCalledWith(customFolder)
    expect(wrapper.findAll('[data-testid^="benchmark-row-"]')).toHaveLength(1)
    expect(row(wrapper, '10').text()).toContain('Stable 0.3.60')
    expect(wrapper.find('.benchmarks__selection-bar').exists()).toBe(false)
  })

  it('shows a skeleton while loading', async () => {
    listMock().mockReturnValue(new Promise(() => {}))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.benchmarks__state--loading').exists()).toBe(true)
    expect(wrapper.get('[data-testid="benchmarks-refresh"]').attributes()).toHaveProperty(
      'disabled'
    )
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
