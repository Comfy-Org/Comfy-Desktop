import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { page } from 'vitest/browser'

import '../assets/main.css'
import AnnouncementModal from './AnnouncementModal.vue'
import WhyTryCloudModal from './WhyTryCloudModal.vue'
import ExtraModelPathsModal from '../views/comfyUISettings/ExtraModelPathsModal.vue'

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
}

describe('modals close with the round button outside the card', () => {
  it('announcement', async () => {
    await track(mount(AnnouncementModal, { attachTo: document.body }))
    expectCloseOutside('[data-testid="announcement-close"]', '.announce-content')
  })

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
})
