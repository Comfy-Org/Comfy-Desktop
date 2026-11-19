import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import BenchmarksView from '../BenchmarksView.vue'
import type { PerformanceTestBenchmark } from '../../types/ipc'

function run(id: string, average: number): PerformanceTestBenchmark {
  const createdAt = `2026-09-${id.padStart(2, '0')}T10:00:00.000Z`
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
      customScore: Number(id)
    }
  }
}

let wrapper: VueWrapper | null = null

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
