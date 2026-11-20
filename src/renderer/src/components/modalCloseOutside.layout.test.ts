import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { page, userEvent } from 'vitest/browser'

import '../assets/main.css'
import WhyTryCloudModal from './WhyTryCloudModal.vue'
import ExtraModelPathsModal from '../views/comfyUISettings/ExtraModelPathsModal.vue'
import BaseModal from './ui/BaseModal.vue'
import BaseAlert from './ui/BaseAlert.vue'
import SetupModal from './SetupModal.vue'

vi.mock('../lib/telemetry', () => ({ emitTelemetryAction: vi.fn() }))

const mounted: VueWrapper[] = []

beforeEach(async () => {
  await page.viewport(1280, 800)
})

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

async function track(wrapper: VueWrapper): Promise<void> {
  mounted.push(wrapper)
  await flushPromises()
}

function rect(selector: string): DOMRect {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el.getBoundingClientRect()
}

function expectCloseOutside(closeSelector: string, cardSelector: string): void {
  const close = rect(closeSelector)
  const card = rect(cardSelector)
  expect(close.width).toBeGreaterThan(0)
  expect(close.left).toBeGreaterThanOrEqual(card.right)
  expect(close.top).toBeLessThanOrEqual(card.top + 1)
  expect(card.left).toBeGreaterThanOrEqual(0)
  expect(close.right).toBeLessThanOrEqual(window.innerWidth)
  expect(close.top).toBeGreaterThanOrEqual(0)
}

function straightRgbaBytes(css: string): number[] {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  return [...ctx.getImageData(0, 0, 1, 1).data]
}

function expectCardFill(
  closeSelector: string,
  cardSelector: string,
  alpha: number,
  crossOpacity = 0.8
): void {
  const close = document.querySelector<HTMLElement>(closeSelector)!
  const card = document.querySelector<HTMLElement>(cardSelector)!
  const style = getComputedStyle(close)
  const fill = straightRgbaBytes(style.backgroundColor)
  const cardFill = straightRgbaBytes(getComputedStyle(card).backgroundColor)
  expect(cardFill[3], `${cardSelector} is opaque`).toBe(255)
  fill.slice(0, 3).forEach((channel, i) => {
    expect(Math.abs(channel - cardFill[i]!), `${closeSelector} channel ${i}`).toBeLessThanOrEqual(3)
  })
  expect(Math.abs(fill[3]! / 255 - alpha), `${closeSelector} alpha`).toBeLessThanOrEqual(0.01)
  expect(style.borderTopWidth).toBe('0px')
  expect(style.boxShadow).toBe('none')
  expect(style.backdropFilter).toBe('none')
  const cross = close.querySelector('svg')!
  expect(straightRgbaBytes(getComputedStyle(cross).color).slice(0, 3)).toEqual([255, 255, 255])
  expect(Number(getComputedStyle(cross).opacity), `${closeSelector} cross`).toBeCloseTo(
    crossOpacity,
    2
  )
}

const NARROW_VIEWPORTS = [
  [640, 480],
  [860, 700],
  [900, 700],
  [1100, 800]
] as const

describe('modals close with the round button outside the card', () => {
  it('why try cloud, with Try Cloud as the only footer action', async () => {
    await track(mount(WhyTryCloudModal, { attachTo: document.body }))
    expectCloseOutside('[data-testid="why-cloud-close"]', '.why-cloud-content')
    const footerButtons = document.querySelectorAll('.why-cloud-footer button')
    expect(footerButtons).toHaveLength(1)
    expect(footerButtons[0]!.getAttribute('data-testid')).toBe('why-cloud-try')
  })

  it('extra model paths', async () => {
    await track(
      mount(ExtraModelPathsModal, {
        attachTo: document.body,
        props: { open: true, sections: [], yamlPath: '/comfy/extra_model_paths.yaml' }
      })
    )
    expectCloseOutside('[data-testid="base-modal-close"]', '.base-modal-panel')
  })

  describe.each(NARROW_VIEWPORTS)('in a %ix%i window, fully inside the window', (w, h) => {
    beforeEach(async () => {
      await page.viewport(w, h)
    })

    it('why try cloud', async () => {
      await track(mount(WhyTryCloudModal, { attachTo: document.body }))
      expectCloseOutside('[data-testid="why-cloud-close"]', '.why-cloud-content')
    })

    it.each(['md', 'xl'] as const)('a %s modal', async (size) => {
      await track(
        mount(BaseModal, {
          attachTo: document.body,
          props: { open: true, size, closeOutside: true, ariaLabel: 'Modal' },
          slots: { default: '<p>Body</p>' }
        })
      )
      expectCloseOutside('[data-testid="base-modal-close"]', '.base-modal-panel')
    })
  })

  it('fills the round button with its card colour at 50% and a white cross at 80%, 70% and full on hover', async () => {
    document.documentElement.dataset.theme = 'dark'
    await track(
      mount(BaseModal, {
        attachTo: document.body,
        props: { open: true, closeOutside: true, ariaLabel: 'Modal' },
        slots: { default: '<p>Body</p>' }
      })
    )
    expectCardFill('[data-testid="base-modal-close"]', '.base-modal-panel', 0.5)
    await userEvent.hover(document.querySelector<HTMLElement>('[data-testid="base-modal-close"]')!)
    await vi.waitFor(() =>
      expectCardFill('[data-testid="base-modal-close"]', '.base-modal-panel', 0.7, 1)
    )
    await userEvent.unhover(
      document.querySelector<HTMLElement>('[data-testid="base-modal-close"]')!
    )
    mounted.splice(0).forEach((w) => w.unmount())

    await track(
      mount(BaseAlert, {
        attachTo: document.body,
        props: {
          open: true,
          title: "Couldn't add this build",
          message: 'Directory does not exist.'
        }
      })
    )
    expectCardFill('[data-testid="base-alert-close-icon"]', '.base-alert-panel', 0.5)
    mounted.splice(0).forEach((w) => w.unmount())

    await track(
      mount(SetupModal, {
        attachTo: document.body,
        props: { dialogLabel: 'Set up', title: 'New build' },
        slots: { default: 'Body' }
      })
    )
    expectCardFill('.setup-modal-close', '.setup-modal-panel', 0.5)
    mounted.splice(0).forEach((w) => w.unmount())

    await track(mount(WhyTryCloudModal, { attachTo: document.body }))
    expectCardFill('[data-testid="why-cloud-close"]', '.why-cloud-content', 0.5)
  })
})
