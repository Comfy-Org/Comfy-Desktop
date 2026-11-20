import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import TrackModal from '../views/TrackModal.vue'
import InstallWizardModal from '../views/InstallWizardModal.vue'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  emitTelemetryEvent: vi.fn()
}))

const mounted: VueWrapper[] = []

beforeAll(() => page.viewport(1280, 900))

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark'
  Object.assign(window, {
    api: new Proxy(
      {
        getSources: vi.fn().mockResolvedValue([]),
        getInstallations: vi.fn().mockResolvedValue([]),
        getDiskSpace: vi.fn().mockResolvedValue({ free: 1e11, total: 1e12 }),
        validateInstallPath: vi.fn().mockResolvedValue([]),
        getFieldOptions: vi.fn().mockResolvedValue([]),
        comfybuilder: {
          getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
          onAuthChanged: vi.fn(() => vi.fn()),
          listWorkspaces: vi.fn().mockResolvedValue([]),
          listBuilds: vi.fn().mockResolvedValue([])
        }
      } as Record<string, unknown>,
      {
        get: (stubs, method) =>
          String(method) in stubs
            ? stubs[String(method)]
            : String(method).startsWith('on')
              ? vi.fn(() => vi.fn())
              : vi.fn().mockResolvedValue(undefined)
      }
    )
  })
  setActivePinia(createPinia())
})

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

async function settle(): Promise<void> {
  await flushPromises()
  await Promise.all(document.getAnimations().map((animation) => animation.finished))
}

async function openAddExisting(): Promise<void> {
  const track = mount(TrackModal, { attachTo: document.body })
  mounted.push(track)
  ;(track.vm as unknown as { open: () => void }).open()
  await settle()
}

async function openNewBuild(): Promise<void> {
  const wizard = mount(InstallWizardModal, { attachTo: document.body })
  mounted.push(wizard)
  await (wizard.vm as unknown as { open: (opts: object) => Promise<void> }).open({})
  await settle()
}

function group(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector)?.closest<HTMLElement>('.config-input')
  if (!node) throw new Error(`missing field for ${selector}`)
  return node
}

function visibleRingWidth(node: HTMLElement): number {
  const shadow = getComputedStyle(node).boxShadow
  if (shadow === 'none') return 0
  return Math.max(
    0,
    ...shadow.split(/,(?![^(]*\))/).map((layer) => {
      if (/rgba\(0, 0, 0, 0\)/.test(layer)) return 0
      const lengths = layer.match(/-?[\d.]+px/g) ?? []
      return parseFloat(lengths[3] ?? '0')
    })
  )
}

function expectFilledBoxAtRest(name: HTMLElement, reference: HTMLElement): void {
  const style = getComputedStyle(name)
  const ref = getComputedStyle(reference)
  for (const side of ['top', 'right', 'bottom', 'left']) {
    expect(style.getPropertyValue(`border-${side}-width`), `name ${side} border`).toBe('0px')
  }
  expect(style.outlineStyle, 'name outline').toBe('none')
  expect(visibleRingWidth(name), 'name ring at rest').toBe(0)
  expect(style.backgroundColor, 'name fill').toBe(ref.backgroundColor)
  expect(style.borderTopLeftRadius, 'name radius').toBe(ref.borderTopLeftRadius)
  expect(name.getBoundingClientRect().height, 'name height').toBe(
    reference.getBoundingClientRect().height
  )
}

describe('setup Name field', () => {
  it('Add existing build: the Name opens focused as a plain filled box like Install location', async () => {
    await openAddExisting()
    const input = document.querySelector<HTMLInputElement>('#track-name')!
    expect(document.activeElement, 'Name keeps the caret on open').toBe(input)
    expectFilledBoxAtRest(group('#track-name'), group('[data-testid="config-path-input"]'))
  })

  it('Add existing build: typing in the Name shows the outline', async () => {
    await openAddExisting()
    await userEvent.keyboard('My build')
    await settle()
    expect(visibleRingWidth(group('#track-name'))).toBe(1)
  })

  it('Add existing build: clicking into the Name shows the outline', async () => {
    await openAddExisting()
    await userEvent.click(document.querySelector<HTMLInputElement>('#track-name')!)
    await settle()
    expect(visibleRingWidth(group('#track-name'))).toBe(1)
  })

  it('New build: the Name rests as the same filled box and shows the outline when clicked', async () => {
    await openAddExisting()
    const reference = group('[data-testid="config-path-input"]')
    const restFill = getComputedStyle(reference).backgroundColor
    const restHeight = reference.getBoundingClientRect().height
    mounted.splice(0).forEach((w) => w.unmount())
    document.body.innerHTML = ''

    await openNewBuild()
    const name = group('#inst-name-standalone')
    expect(visibleRingWidth(name), 'name ring at rest').toBe(0)
    expect(getComputedStyle(name).borderTopWidth).toBe('0px')
    expect(getComputedStyle(name).backgroundColor).toBe(restFill)
    expect(name.getBoundingClientRect().height).toBe(restHeight)

    await userEvent.click(document.querySelector<HTMLInputElement>('#inst-name-standalone')!)
    await settle()
    expect(visibleRingWidth(name), 'name ring while in the field').toBe(1)
  })
})
