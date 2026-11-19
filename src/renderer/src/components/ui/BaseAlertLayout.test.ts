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
