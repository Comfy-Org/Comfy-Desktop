import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  emitTelemetryAction: vi.fn()
}))

import '../assets/main.css'
import FirstUseTakeover from './FirstUseTakeover.vue'
import InstallWizardModal from './InstallWizardModal.vue'
import { useModal } from '../composables/useModal'

const GB = 1024 ** 3

const STANDALONE = {
  id: 'standalone',
  label: 'Standalone',
  fields: [
    { id: 'release', label: 'Release', type: 'select' },
    { id: 'comfyVersion', label: 'Version', type: 'select' },
    { id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }
  ]
}

function installApi(): void {
  window.api = {
    platform: 'darwin',
    openPath: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(undefined),
    getLocale: vi.fn().mockResolvedValue('en'),
    setFirstUseMode: vi.fn(),
    getSystemInfo: vi.fn().mockResolvedValue({
      gpu_label: 'Apple M3 Max',
      gpu_model: 'Apple M3 Max',
      cpu_model: 'Apple M3 Max',
      total_memory_gb: 36,
      gpu_tier: 'high'
    }),
    detectGPU: vi.fn().mockResolvedValue({ label: 'Apple M3 Max' }),
    getDefaultInstallDir: vi.fn().mockResolvedValue('/Users/ada/ComfyUI-Installs'),
    getSources: vi.fn().mockResolvedValue([STANDALONE]),
    getFieldOptions: vi.fn(async (_source: string, field: string) => {
      if (field === 'release') {
        return [{ value: 'stable', label: 'Stable', recommended: true, data: {} }]
      }
      if (field === 'comfyVersion') {
        return [{ value: 'v0.42.4', label: 'v0.42.4', recommended: true }]
      }
      if (field === 'variant') {
        return [
          {
            value: 'mac-mps',
            label: 'Apple Silicon (MPS)',
            recommended: true,
            description: 'ComfyUI 0.42.4',
            data: { variantId: 'mac-mps', downloadFiles: [{ size: 1.2 * GB }] }
          }
        ]
      }
      return []
    }),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    onSettingsChanged: vi.fn(() => () => {}),
    getInstallationsSummary: vi.fn().mockResolvedValue({ localCount: 0 }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    getDiskSpace: vi.fn().mockResolvedValue({ free: 412 * GB, total: 1000 * GB }),
    validateInstallPath: vi.fn().mockResolvedValue([]),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {}),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      listBuilds: vi.fn().mockResolvedValue([])
    }
  } as unknown as typeof window.api
}

async function settle(): Promise<void> {
  for (let frame = 0; frame < 5; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish()
    }
    await flushPromises()
  }
}

interface SummaryMetrics {
  edges: { top: number; right: number; bottom: number; left: number }
  fill: string
  border: string
  radius: string
  padding: string
  rowHeights: number[]
  rowGaps: number[]
  iconX: number[]
  labelX: number[]
  valueX: number[]
  noteRight: number[]
}

function measure(box: HTMLElement, rows: HTMLElement[]): SummaryMetrics {
  const style = getComputedStyle(box)
  const edge = box.getBoundingClientRect()
  const x = (element: Element | null | undefined): number =>
    Math.round(element!.getBoundingClientRect().left - edge.left)
  return {
    edges: {
      top: Math.round(rows[0].getBoundingClientRect().top - edge.top),
      right: Math.round(edge.right - rows[0].getBoundingClientRect().right),
      bottom: Math.round(edge.bottom - rows[rows.length - 1].getBoundingClientRect().bottom),
      left: Math.round(rows[0].querySelector('svg')!.getBoundingClientRect().left - edge.left)
    },
    fill: style.backgroundColor,
    border: `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth} ${style.borderTopColor}`,
    radius: style.borderRadius,
    padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    rowHeights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
    rowGaps: rows
      .slice(1)
      .map((row, i) =>
        Math.round(row.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom)
      ),
    iconX: rows.map((row) => x(row.querySelector('svg'))),
    labelX: rows.map((row) => x(row.children[0])),
    valueX: rows.map((row) => x(row.children[1])),
    noteRight: rows.map((row) =>
      Math.round(edge.right - row.children[2]!.getBoundingClientRect().right)
    )
  }
}

async function firstRunSummary(): Promise<SummaryMetrics> {
  const wrapper = mount(FirstUseTakeover, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  await settle()
  const box = document.querySelector<HTMLElement>('[data-testid="setup-summary"]')!
  const rows = [...box.querySelectorAll<HTMLElement>('[data-testid^="setup-row-"]')]
  expect(rows).toHaveLength(3)
  const metrics = measure(box, rows)
  const hardware = rows[0]
  const label = document.createRange()
  label.selectNodeContents(hardware.children[0])
  const labelGap =
    hardware.children[1].getBoundingClientRect().left - label.getBoundingClientRect().right
  expect(labelGap).toBeGreaterThanOrEqual(8)
  expect(labelGap).toBeLessThanOrEqual(24)
  expect(Math.max(...metrics.rowGaps)).toBeLessThanOrEqual(20)
  const terms = document.querySelector('[data-testid="setup-consent-telemetry"]')!
  expect(Math.round(terms.getBoundingClientRect().left - box.getBoundingClientRect().left)).toBe(
    metrics.edges.left
  )
  wrapper.unmount()
  return metrics
}

async function newBuildSummary(): Promise<{ metrics: SummaryMetrics; box: HTMLElement }> {
  setActivePinia(createPinia())
  useModal().dismiss()
  const wrapper = mount(InstallWizardModal, { attachTo: document.body })
  mounted.push(wrapper)
  await (wrapper.vm as unknown as { open: (options: object) => Promise<void> }).open({})
  await flushPromises()
  await settle()
  await vi.waitFor(() =>
    expect(document.querySelector('.config-summary-location')?.textContent).toContain('GB free')
  )
  await settle()
  const box = document.querySelector<HTMLElement>('.config-summary-list')!
  const rows = [...box.querySelectorAll<HTMLElement>('.config-summary-row')]
  expect(rows).toHaveLength(3)
  return { metrics: measure(box, rows), box }
}

const mounted: VueWrapper[] = []

beforeEach(installApi)

afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  await browserPage.viewport(1100, 860)
})

it('explains install space when the download info icon is hovered or focused', async () => {
  await browserPage.viewport(800, 563)
  const wrapper = mount(FirstUseTakeover, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  await settle()

  const bubble = () => document.querySelector('.tooltip-bubble')
  const tip = 'Allow about 2.7 GB of disk space to unpack and install the 1.2 GB download.'
  await expect
    .element(browserPage.getByTestId('setup-download-size'))
    .toHaveTextContent('1.2 GB download')
  expect(bubble()).toBeNull()

  await browserPage.getByTestId('setup-download-info').hover()
  await expect.poll(() => bubble()?.textContent).toContain(tip)
  await browserPage.getByTestId('setup-screen').hover({ position: { x: 4, y: 4 } })
  await expect.poll(bubble).toBeNull()

  document
    .querySelector<HTMLElement>('[data-testid="setup-download-info"] [role="button"]')!
    .focus()
  await expect.poll(() => bubble()?.textContent).toContain(tip)
  await userEvent.keyboard('{Escape}')
  await expect.poll(bubble).toBeNull()
  await expect.element(browserPage.getByTestId('setup-install')).toBeVisible()
})

describe.each([
  [1100, 860],
  [800, 563]
])('the New build summary at %i × %i', (width, height) => {
  it('is drawn with the first-run summary box: fill, border, radius, padding, rows, columns', async () => {
    await browserPage.viewport(width, height)
    const firstRun = await firstRunSummary()
    const { metrics: newBuild } = await newBuildSummary()

    expect(firstRun.fill).not.toBe('rgba(0, 0, 0, 0)')
    expect(newBuild.fill).toBe(firstRun.fill)
    expect(newBuild.border).toBe(firstRun.border)
    expect(newBuild.radius).toBe(firstRun.radius)
    expect(newBuild.padding).toBe(firstRun.padding)
    for (const key of [
      'rowHeights',
      'rowGaps',
      'iconX',
      'labelX',
      'valueX',
      'noteRight'
    ] as const) {
      expect(new Set(newBuild[key]), key).toEqual(new Set(firstRun[key]))
    }
  })

  it('keeps the same space between the box edge and its rows on every side', async () => {
    await browserPage.viewport(width, height)
    const firstRun = await firstRunSummary()
    const { metrics: newBuild } = await newBuildSummary()

    for (const { edges } of [firstRun, newBuild]) {
      expect(edges.right).toBe(edges.top)
      expect(edges.bottom).toBe(edges.top)
      expect(edges.left).toBe(edges.top)
    }
    expect(firstRun.noteRight.every((right) => right === firstRun.edges.top)).toBe(true)
  })

  it('draws the summary like the Name box: no border, the same fill, icons and labels on the same x', async () => {
    await browserPage.viewport(width, height)
    const firstRun = await firstRunSummary()
    const { metrics: newBuild, box } = await newBuildSummary()
    const nameCard = document.querySelector<HTMLElement>('.config-name-card')!
    const nameEdge = nameCard.getBoundingClientRect()
    const nameLabel = nameCard.querySelector('label')!
    const nameIcon = nameLabel.querySelector('svg')!.getBoundingClientRect()
    const nameStyle = getComputedStyle(nameCard)
    const rowIcon = box.querySelector('.config-summary-row svg')!.getBoundingClientRect()
    const rowLabel = box.querySelector('.config-summary-row')!.children[0]

    for (const metrics of [firstRun, newBuild]) {
      expect(metrics.border).toMatch(/^0px 0px 0px 0px /)
      expect(metrics.fill).toBe(nameStyle.backgroundColor)
      expect(metrics.radius).toBe(nameStyle.borderRadius)
      expect(new Set(metrics.iconX)).toEqual(new Set([Math.round(nameIcon.left - nameEdge.left)]))
    }
    expect([rowIcon.width, rowIcon.height]).toEqual([nameIcon.width, nameIcon.height])
    expect(Math.round(rowIcon.left - box.getBoundingClientRect().left)).toBe(
      Math.round(nameIcon.left - nameEdge.left)
    )
    expect(Math.round(rowLabel.getBoundingClientRect().left)).toBe(
      Math.round(nameLabel.getBoundingClientRect().left)
    )
    expect(getComputedStyle(rowLabel).color).toBe(getComputedStyle(nameLabel).color)
    expect(new Set(newBuild.valueX)).toEqual(
      new Set([
        Math.round(nameCard.querySelector('input')!.getBoundingClientRect().left - nameEdge.left)
      ])
    )
  })

  it('draws Browse as a filled secondary button, without an outline', async () => {
    await browserPage.viewport(width, height)
    const { box } = await newBuildSummary()
    const browse = getComputedStyle(box.querySelector('[data-testid="config-summary-browse"]')!)
    const change = getComputedStyle(document.querySelector('[data-testid="config-change-setup"]')!)

    expect(browse.backgroundColor).toBe(change.backgroundColor)
    expect(browse.boxShadow).toBe('none')
    expect(browse.borderTopWidth).toBe('0px')
  })

  it('shows the rows, values and notes of the first-run summary, without long descriptions or recommended picks', async () => {
    await browserPage.viewport(width, height)
    const longNote = 'A very long build description '.repeat(12).trim()
    const options = window.api.getFieldOptions as ReturnType<typeof vi.fn>
    const defaultOptions = options.getMockImplementation()!
    options.mockImplementation(async (source: string, field: string) => {
      const list = await defaultOptions(source, field)
      return list.map((option) => ({ ...option, description: longNote, recommended: undefined }))
    })
    const lines = (rows: HTMLElement[]): string[][] =>
      rows.map((row) => [...row.children].map((cell) => cell.textContent!.trim()))
    const firstRun = mount(FirstUseTakeover, { attachTo: document.body })
    mounted.push(firstRun)
    await flushPromises()
    await settle()
    const firstRunLines = lines([
      ...document.querySelectorAll<HTMLElement>('[data-testid^="setup-row-"]')
    ])
    firstRun.unmount()
    const { box } = await newBuildSummary()
    const newBuildLines = lines([...box.querySelectorAll<HTMLElement>('.config-summary-row')])

    expect(newBuildLines.map(([label]) => label)).toEqual(['Hardware', 'Location', 'Version'])
    expect(newBuildLines[0]).toEqual(firstRunLines[0])
    expect(newBuildLines[2]).toEqual(firstRunLines[2])
    expect(newBuildLines[0]).toEqual(['Hardware', 'Apple Silicon (MPS)', 'Detected'])
    expect(newBuildLines[2]).toEqual(['Version', 'ComfyUI v0.42.4', 'Stable'])
    expect(box.textContent).not.toContain(longNote)
  })

  it('puts the Location note and Browse on the Location line, right-aligned', async () => {
    await browserPage.viewport(width, height)
    const { box } = await newBuildSummary()
    const location = box.querySelector<HTMLElement>('.config-summary-location')!
    const note = location.children[2] as HTMLElement
    const browse = location.querySelector<HTMLElement>('[data-testid="config-summary-browse"]')!

    expect(note.textContent).toContain('412 GB free')
    expect(note.contains(browse)).toBe(true)
    const line = location.getBoundingClientRect()
    const button = browse.getBoundingClientRect()
    expect(Math.abs(button.top + button.height / 2 - (line.top + line.height / 2))).toBeLessThan(1)
    expect(Math.round(box.getBoundingClientRect().right - button.right)).toBe(
      parseFloat(getComputedStyle(box).paddingRight)
    )
  })
})
