import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../assets/main.css'
import FirstUseTakeover from './FirstUseTakeover.vue'

const SMALLEST_WINDOW = { width: 800, height: 600 }

const wrappers: VueWrapper[] = []

beforeAll(() => browserPage.viewport(SMALLEST_WINDOW.width, SMALLEST_WINDOW.height))

beforeEach(() => {
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
    getDiskSpace: vi.fn().mockResolvedValue({ free: 412 * 1024 ** 3, total: 1000 * 1024 ** 3 }),
    getSources: vi.fn().mockResolvedValue([]),
    getFieldOptions: vi.fn().mockResolvedValue([]),
    setFirstUseMode: vi.fn()
  } as unknown as typeof window.api
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  document.body.innerHTML = ''
})

const BACK_FROM_CHANGE = {
  consent: {
    acceptedTos: false,
    telemetryEnabled: true,
    betaFeaturesEnabled: true,
    betaTouched: false,
    preservePersistedBetaOptIn: false,
    locale: 'en'
  }
}

async function showSetup(props: Record<string, unknown> = {}): Promise<void> {
  wrappers.push(mount(FirstUseTakeover, { props, attachTo: document.body }))
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

function rectOf(testId: string): DOMRect {
  const element = document.querySelector(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`${testId} is not on the screen`)
  return element.getBoundingClientRect()
}

describe('The first open', () => {
  it('fills the wordmark in over a 16% ghost, then Set up rises block by block', async () => {
    await showSetup()

    const ghostMark = document.querySelector('[data-testid="setup-wordmark-ghost"]')!
    const ghost = getComputedStyle(ghostMark)
    ghostMark.getAnimations().forEach((animation) => animation.finish())
    expect(ghost.opacity).toBe('0.16')
    expect(ghost.animationName).toBe('first-use-ghost')
    const fill = getComputedStyle(
      document.querySelectorAll('[data-testid="setup-wordmark"] svg')[1]
    )
    expect(fill.animationName).toBe('first-use-fill')
    expect(fill.animationDelay).toBe('0.25s')
    expect(fill.animationDuration).toBe('1.05s')
    const blocks = [...document.querySelector('[data-testid="setup-column"]')!.children]
    expect(blocks.map((block) => getComputedStyle(block).animationName)).toEqual(
      blocks.map(() => 'first-use-rise')
    )
    expect(blocks.map((block) => getComputedStyle(block).animationDelay)).toEqual(
      ['1.6s', '1.65s', '1.71s', '1.77s', '1.83s', '1.83s'].slice(0, blocks.length)
    )
  })
})

describe('Set up at the smallest window', () => {
  it('centres the Comfy wordmark at the top', async () => {
    await showSetup()

    const mark = rectOf('setup-wordmark')
    const screen = rectOf('setup-screen')
    expect(mark.height).toBe(28)
    expect(mark.top - screen.top).toBe(20)
    expect(Math.abs(mark.left + mark.width / 2 - (screen.left + screen.width / 2))).toBeLessThan(1)
  })

  it.each([
    ['during the first open', {}],
    ['once Set up has settled', BACK_FROM_CHANGE]
  ])('keeps the wordmark clear of the Set up title %s', async (_state, props) => {
    await showSetup(props)

    const mark = rectOf('setup-wordmark')
    const heading = document.querySelector('[data-testid="setup-column"] h1')
    if (!heading) throw new Error('the Set up title is not on the screen')
    expect(heading.getBoundingClientRect().top).toBeGreaterThanOrEqual(mark.bottom + 24)
  })
})
