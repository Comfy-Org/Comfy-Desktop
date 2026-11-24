import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import BenchmarksView from '../BenchmarksView.vue'
import type { PerformanceTestBenchmark } from '../../types/ipc'

const LONG_SESSION = 'nightly-portrait-sweep-with-a-very-long-session-name-that-keeps-going'

function run(id: string, average: number, day = id): PerformanceTestBenchmark {
  const createdAt = `2026-09-${day.padStart(2, '0')}T10:00:00.000Z`
  const instance = { id: 'instance-1', name: 'Nightly 0.3.62' }
  const workspace = { id: 'workspace-1', name: 'Comfy' }
  const durations = {
    fastestJobDurationSeconds: average - 0.4,
    slowestJobDurationSeconds: average + 0.7,
    averageJobDurationSeconds: average,
    medianJobDurationSeconds: average - 0.1
  }
  return {
    id,
    createdAt,
    instance,
    workspace,
    workflowName: 'portrait.json',
    ...durations,
    measuredJobCount: 5,
    machine: { gpu: 'NVIDIA RTX 4090', cpu: 'Test CPU', memoryGb: 64, platform: 'win32' },
    result: {
      createdAt,
      instance,
      workspace,
      workflowName: 'portrait.json',
      ...durations,
      measuredJobCount: 5,
      hardware: { deviceName: 'NVIDIA RTX 4090' },
      systemInfo: { cpu_model: 'Test CPU' },
      customScore: Number(day)
    }
  }
}

let wrapper: VueWrapper | null = null

async function measureInInterNotTheFallbackFont(): Promise<void> {
  const faces = ['400 13px Inter', '500 13px Inter', '600 13px Inter']
  await Promise.all(faces.map((face) => document.fonts.load(face)))
  await document.fonts.ready
  for (const face of faces) expect(document.fonts.check(face)).toBe(true)
}

beforeAll(async () => {
  await measureInInterNotTheFallbackFont()
})

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark')
  ;(window as unknown as { api: object }).api = {
    browseFolder: vi.fn(),
    navigatePanel: vi.fn(),
    listPerformanceTestBenchmarks: vi.fn(async () => ({
      folderPath: 'C:\\results\\performance-tests',
      benchmarks: [run('11', 1.2), run('12', 2.2), run('13', 18.7)]
    }))
  }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('Benchmarks table sticky columns', () => {
  it.each([960, 1280])(
    'keeps the metric column clear of "Compared to baseline" at %ipx',
    async (width) => {
      await page.viewport(width, 800)
      wrapper = mount(BenchmarksView, { attachTo: document.body })
      await flushPromises()
      await new Promise((resolve) => requestAnimationFrame(resolve))

      const vsHead = document.querySelector<HTMLElement>('.benchmarks__vs-head')!
      const metricHead = vsHead.previousElementSibling as HTMLElement
      const headerRow = vsHead.parentElement as HTMLElement

      expect(vsHead.offsetHeight).toBe(headerRow.offsetHeight)
      expect(vsHead.scrollWidth).toBeLessThanOrEqual(vsHead.clientWidth)

      const stickyRight = (el: HTMLElement): number => parseFloat(getComputedStyle(el).right)
      expect(stickyRight(metricHead)).toBeGreaterThanOrEqual(
        stickyRight(vsHead) + vsHead.offsetWidth
      )
      const metricRight = metricHead.getBoundingClientRect().right
      const vsLeft = vsHead.getBoundingClientRect().left
      expect(Math.abs(metricRight - vsLeft)).toBeLessThanOrEqual(1)

      for (const cell of document.querySelectorAll<HTMLElement>('.benchmarks__value')) {
        const vsCell = cell.nextElementSibling as HTMLElement
        expect(stickyRight(cell)).toBeGreaterThanOrEqual(stickyRight(vsCell) + vsCell.offsetWidth)
        expect(cell.getBoundingClientRect().right).toBeLessThanOrEqual(
          vsCell.getBoundingClientRect().left + 1
        )
        expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth)
      }
    }
  )
})

describe('Benchmarks table card', () => {
  it.each([960, 1280])(
    'is one 14px card with straight dividers and 18px sides at %ipx',
    async (width) => {
      await page.viewport(width, 800)
      wrapper = mount(BenchmarksView, { attachTo: document.body })
      await flushPromises()
      await new Promise((resolve) => requestAnimationFrame(resolve))

      const box = document.querySelector<HTMLElement>('.benchmarks__runs-box')!
      const card = box.getBoundingClientRect()
      expect(getComputedStyle(box).borderRadius).toBe('14px')
      expect(getComputedStyle(box).borderTopWidth).toBe('0px')

      for (const cell of box.querySelectorAll<HTMLElement>('th, td')) {
        expect(getComputedStyle(cell).borderRadius).toBe('0px')
      }

      const row = box.querySelector<HTMLElement>('tbody tr')!
      const cells = row.querySelectorAll<HTMLElement>('td')
      expect(cells[0].getBoundingClientRect().left).toBeCloseTo(card.left, 0)
      expect(cells[cells.length - 1].getBoundingClientRect().right).toBeCloseTo(card.right, 0)

      const rowMenu = row.querySelector('.benchmarks__row-menu svg')!.getBoundingClientRect()
      const title = textBox(document.querySelector('.benchmarks__runs-title')!)
      expect(title.left - card.left).toBeCloseTo(18, 0)
      expect(card.right - rowMenu.right).toBeCloseTo(18, 0)
    }
  )
})

function textBox(element: Element): DOMRect {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getBoundingClientRect()
}

async function mountWith(benchmarks: PerformanceTestBenchmark[], width = 1280): Promise<void> {
  ;(
    window as unknown as { api: { listPerformanceTestBenchmarks: () => Promise<unknown> } }
  ).api.listPerformanceTestBenchmarks = vi.fn(async () => ({
    folderPath: 'C:\\results\\performance-tests',
    benchmarks
  }))
  await page.viewport(width, 800)
  wrapper = mount(BenchmarksView, { attachTo: document.body })
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

function sessionParts(row: HTMLElement) {
  const cell = row.querySelector<HTMLElement>('.benchmarks__session')!
  return {
    cell,
    name: cell.querySelector<HTMLElement>('.benchmarks__session-name-text')!,
    meta: cell.querySelector<HTMLElement>('.benchmarks__session-meta')!,
    grip: cell.querySelector<HTMLElement>('.benchmarks__grip')!,
    controls: cell.querySelector<HTMLElement>('.benchmarks__select')!
  }
}

describe('Benchmarks session cell', () => {
  it.each([960, 1280])(
    'starts each row with the grip and checkbox under the ALL RUNS title, text under Session, at %ipx',
    async (width) => {
      await mountWith([run('11', 1.2), run('12', 2.2), run('13', 18.7)], width)

      const title = textBox(document.querySelector('.benchmarks__runs-title')!)
      const sessionHead = textBox(document.querySelector('thead th .benchmarks__sort')!)
      const row = document.querySelector<HTMLElement>('.benchmarks__runs-box tbody tr')!
      const { cell, name, meta, grip, controls } = sessionParts(row)
      const check = controls.querySelector('[role="checkbox"]')!.getBoundingClientRect()

      const before = { name: textBox(name).left, meta: textBox(meta).left }
      expect(Math.abs(grip.getBoundingClientRect().left - title.left)).toBeLessThanOrEqual(1)
      expect(grip.getBoundingClientRect().right).toBeLessThanOrEqual(check.left)
      expect(before.name - check.right).toBeGreaterThanOrEqual(8)
      expect(Math.abs(before.name - sessionHead.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(before.meta - sessionHead.left)).toBeLessThanOrEqual(1)
      expect(getComputedStyle(grip).opacity).toBe('0')

      await userEvent.hover(cell, { force: true })
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(getComputedStyle(grip).opacity).toBe('1')
      expect(textBox(name).left).toBe(before.name)
      expect(textBox(meta).left).toBe(before.meta)

      const cellBox = cell.getBoundingClientRect()
      expect(Math.max(textBox(name).right, textBox(meta).right)).toBeLessThanOrEqual(cellBox.right)
      expect(meta.scrollWidth).toBeLessThanOrEqual(meta.clientWidth)
      expect(
        cell.querySelector('.benchmarks__session-body')!.getBoundingClientRect().width
      ).toBeLessThanOrEqual(180)
      await userEvent.unhover(cell, { force: true })
    }
  )

  it('truncates a long session name and its date inside the session cell', async () => {
    await mountWith([run(LONG_SESSION, 1.2, '11'), run('12', 2.2)])

    const row = document.querySelector<HTMLElement>(
      `[data-testid="benchmark-row-${LONG_SESSION}"]`
    )!
    const { cell, name, meta, controls } = sessionParts(row)
    await userEvent.hover(cell, { force: true })

    const cellBox = cell.getBoundingClientRect()
    expect(
      cell.querySelector('.benchmarks__session-body')!.getBoundingClientRect().width
    ).toBeLessThanOrEqual(180)
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    expect(textBox(name).left).toBeGreaterThanOrEqual(controls.getBoundingClientRect().right + 8)
    expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(cellBox.right - 8)
    expect(meta.getBoundingClientRect().right).toBeLessThanOrEqual(cellBox.right - 8)
    expect(name.getAttribute('title')).toContain(LONG_SESSION)
    expect(meta.getAttribute('title')).toBe(meta.textContent?.trim())
    await userEvent.unhover(cell, { force: true })
  })
})

describe('Benchmarks bar tooltip', () => {
  it('lists fastest and slowest on the left, average and median on the right', async () => {
    await mountWith([run('11', 1.2), run('12', 2.2)])

    const wrap = document.querySelector<HTMLElement>(
      '[data-testid="benchmark-row-12"] .tooltip-wrap'
    )!
    wrap.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await flushPromises()
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const timings = Array.from(
      document.querySelector('.benchmarks__bar-tip .grid')!.children,
      (timing) => ({
        label: timing.firstElementChild!.textContent!.trim(),
        box: timing.getBoundingClientRect()
      })
    )
    const left = Math.min(...timings.map(({ box }) => box.left))
    const column = (inLeft: boolean) =>
      timings
        .filter(({ box }) => Math.abs(box.left - left) < 1 === inLeft)
        .sort((a, b) => a.box.top - b.box.top)
        .map(({ label }) => label)
    expect(column(true), 'left column').toEqual(['Fastest', 'Slowest'])
    expect(column(false), 'right column').toEqual(['Average', 'Median'])
  })
})
