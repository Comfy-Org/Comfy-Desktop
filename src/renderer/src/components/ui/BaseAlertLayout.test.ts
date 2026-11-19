import { afterEach, beforeAll, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import BaseAlert from './BaseAlert.vue'

const wrappers: VueWrapper[] = []

beforeAll(async () => {
  document.documentElement.setAttribute('data-theme', 'dark')
  await page.viewport(1000, 600)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

it('keeps the same space above, below and to the right of the buttons', async () => {
  wrappers.push(
    mount(BaseAlert, {
      attachTo: document.body,
      props: {
        open: true,
        title: 'Uninstall',
        message: 'This permanently removes this ComfyUI installation.',
        showCancel: true,
        tone: 'danger'
      }
    })
  )
  await flushPromises()

  const panel = document.querySelector('.base-alert-panel')!.getBoundingClientRect()
  const footer = document.querySelector('.base-alert-footer')!.getBoundingClientRect()
  const action = document
    .querySelector('[data-testid="base-alert-action"]')!
    .getBoundingClientRect()
  const line = 1

  const above = Math.round(action.top - footer.top - line)
  const below = Math.round(panel.bottom - line - action.bottom)
  const right = Math.round(panel.right - line - action.right)

  expect(above).toBe(16)
  expect([below, right]).toEqual([above, above])
})

const LONG_TITLE =
  'Uninstall this ComfyUI installation and remove every custom node, model and output'

async function mountLongTitle(): Promise<void> {
  wrappers.push(
    mount(BaseAlert, {
      attachTo: document.body,
      props: { open: true, title: LONG_TITLE, message: 'This cannot be undone.' }
    })
  )
  await flushPromises()
}

it('wraps a long title before the close button when the button sits inside the panel', async () => {
  await page.viewport(800, 600)
  try {
    await mountLongTitle()
    const title = document.querySelector('.base-alert-title')!.getBoundingClientRect()
    const close = document
      .querySelector('[data-testid="base-alert-close-icon"]')!
      .getBoundingClientRect()
    const panel = document.querySelector('.base-alert-panel')!.getBoundingClientRect()

    expect(close.right).toBeLessThanOrEqual(panel.right)
    expect(title.height).toBeGreaterThan(30)
    expect(title.right).toBeLessThanOrEqual(close.left)
  } finally {
    await page.viewport(1000, 600)
  }
})

it('gives the title the full width when the close button sits outside the panel', async () => {
  await mountLongTitle()
  const header = document.querySelector('.base-alert-header')!
  const close = document
    .querySelector('[data-testid="base-alert-close-icon"]')!
    .getBoundingClientRect()
  const panel = document.querySelector('.base-alert-panel')!.getBoundingClientRect()

  expect(close.left).toBeGreaterThanOrEqual(panel.right)
  expect(getComputedStyle(header).paddingRight).toBe('0px')
})
