import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn()
}))

import '../assets/main.css'
import FirstUseTakeover from './FirstUseTakeover.vue'

const GB = 1024 ** 3

function installApi(): void {
  window.api = {
    platform: 'darwin',
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(undefined),
    getLocale: vi.fn().mockResolvedValue('en'),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSystemInfo: vi.fn().mockResolvedValue({
      gpu_label: 'Apple M3 Max',
      gpu_model: 'Apple M3 Max',
      cpu_model: 'Apple M3 Max',
      total_memory_gb: 36,
      gpu_tier: 'high'
    }),
    getDefaultInstallDir: vi.fn().mockResolvedValue('/Users/ada/ComfyUI-Installs'),
    getDiskSpace: vi.fn().mockResolvedValue({ free: 412 * GB, total: 1000 * GB }),
    getSources: vi.fn().mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [
          { id: 'release', label: 'Release', type: 'select' },
          { id: 'comfyVersion', label: 'Version', type: 'select' },
          { id: 'variant', label: 'Variant', type: 'select' }
        ]
      }
    ]),
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
            data: { variantId: 'mac-mps', downloadFiles: [{ size: 1.2 * GB }] }
          }
        ]
      }
      return []
    }),
    setFirstUseMode: vi.fn()
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

function leftOf(element: Element | null | undefined): number {
  return element!.getBoundingClientRect().left
}

let wrapper: VueWrapper | undefined

beforeEach(installApi)

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe.each([
  [1100, 860],
  [800, 563]
])('Set up lines up its columns at %i × %i', (width, height) => {
  it('starts the terms checkboxes on the same edge as the summary row icons', async () => {
    await browserPage.viewport(width, height)
    wrapper = mount(FirstUseTakeover, { attachTo: document.body })
    await flushPromises()
    await settle()

    const summaryIcons = [
      ...document.querySelectorAll('[data-testid="setup-summary"] .config-summary-row dt svg')
    ]
    const checkboxes = [
      ...document.querySelectorAll('[data-testid="setup-consents"] [role="checkbox"]')
    ]
    expect(summaryIcons).toHaveLength(3)
    expect(checkboxes.length).toBeGreaterThan(0)

    const edge = leftOf(summaryIcons[0])
    for (const icon of summaryIcons) expect(Math.abs(leftOf(icon) - edge)).toBeLessThanOrEqual(1)
    for (const box of checkboxes) expect(Math.abs(leftOf(box) - edge)).toBeLessThanOrEqual(1)
  })

  it('puts the summary rows in a borderless box, the icons 16px inside it', async () => {
    await browserPage.viewport(width, height)
    wrapper = mount(FirstUseTakeover, { attachTo: document.body })
    await flushPromises()
    await settle()

    const summary = document.querySelector<HTMLElement>('[data-testid="setup-summary"]')!
    const style = getComputedStyle(summary)
    const probe = document.body.appendChild(document.createElement('div'))
    probe.className = 'bg-white/5'
    const nameRowFill = getComputedStyle(probe).backgroundColor
    probe.remove()
    expect(nameRowFill).not.toBe('rgba(0, 0, 0, 0)')
    expect(style.backgroundColor).toBe(nameRowFill)
    expect(style.borderRadius).toBe('14px')
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      expect(style[`border${side}Width`]).toBe('0px')
    }
    const icons = [...summary.querySelectorAll('.config-summary-row dt svg')]
    expect(icons).toHaveLength(3)
    for (const icon of icons) {
      expect(Math.abs(leftOf(icon) - leftOf(summary) - 16)).toBeLessThanOrEqual(0.5)
    }
  })
})
