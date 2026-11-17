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

function finishAnimations(element: Element): void {
  element.getAnimations().forEach((animation) => animation.finish())
}

describe('The first open', () => {
  it('starts the wordmark twice its size in the middle of the window, at 82%', async () => {
    await showSetup()

    const wrapper = document.querySelector('[data-testid="setup-wordmark"]')!
    const mark = wrapper.querySelector('svg')!
    finishAnimations(mark)
    const box = wrapper.getBoundingClientRect()
    expect(box.height).toBe(56)
    expect(box.top + box.height / 2 - rectOf('setup-screen').top).toBeCloseTo(
      SMALLEST_WINDOW.height / 2,
      0
    )
    expect(box.left + box.width / 2).toBeCloseTo(SMALLEST_WINDOW.width / 2, 0)
    expect(getComputedStyle(mark).opacity).toBe('0.82')
    expect(getComputedStyle(mark).animationName).toBe('first-use-arrive')
    expect(getComputedStyle(wrapper).transitionDuration).toBe('0.6s')
    expect(getComputedStyle(wrapper).transitionTimingFunction).toBe(
      'cubic-bezier(0.32, 0.72, 0, 1)'
    )

    const glint = getComputedStyle(document.querySelector('[data-testid="setup-wordmark-glint"]')!)
    expect(glint.animationName).toBe('first-use-glint')
    expect(glint.animationDelay).toBe('0.3s')
    expect(glint.animationDuration).toBe('0.8s')
    expect(glint.maskImage).toContain('106deg')
    expect(
      getComputedStyle(document.querySelector('[data-testid="setup-light"]')!).animationName
    ).toBe('first-use-light')
  })

  it('rises Set up block by block after the wordmark leaves, the action bar last', async () => {
    await showSetup()

    const blocks = [...document.querySelector('[data-testid="setup-column"]')!.children]
    expect(blocks.map((block) => getComputedStyle(block).animationName)).toEqual(
      blocks.map(() => 'first-use-rise')
    )
    expect(blocks.map((block) => getComputedStyle(block).animationDelay)).toEqual([
      '1.36s',
      '1.41s',
      '1.47s',
      '1.53s',
      '1.59s',
      '1.66s'
    ])
  })

  it('rises Set up straight away when coming back from Change', async () => {
    await showSetup(BACK_FROM_CHANGE)

    const blocks = [...document.querySelector('[data-testid="setup-column"]')!.children]
    expect(blocks.map((block) => getComputedStyle(block).animationDelay)).toEqual([
      '0s',
      '0.05s',
      '0.11s',
      '0.17s',
      '0.23s',
      '0.3s'
    ])
  })
})

describe('Set up at the smallest window', () => {
  it('centres the Comfy wordmark at the top', async () => {
    await showSetup(BACK_FROM_CHANGE)

    const mark = rectOf('setup-wordmark')
    const screen = rectOf('setup-screen')
    expect(mark.height).toBe(28)
    expect(mark.top - screen.top).toBe(20)
    expect(Math.abs(mark.left + mark.width / 2 - (screen.left + screen.width / 2))).toBeLessThan(1)
  })

  it.each([
    ['where the wordmark lands after the first open', {}],
    ['once Set up has settled', BACK_FROM_CHANGE]
  ])('keeps the wordmark clear of the Set up title %s', async (_state, props) => {
    await showSetup(props)

    const mark = document.querySelector<HTMLElement>('[data-testid="setup-wordmark"]')!
    const heading = document.querySelector<HTMLElement>('[data-testid="setup-column"] h1')
    if (!heading) throw new Error('the Set up title is not on the screen')
    expect(heading.offsetTop).toBeGreaterThanOrEqual(mark.offsetTop + mark.offsetHeight + 24)
  })
})
