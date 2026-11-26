import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type App } from 'vue'
import { page } from 'vitest/browser'
import { createSystemModalApp } from './createSystemModalApp'
import type { SystemModalBridge, SystemModalSpec } from './systemModalBridge'

const CLOSE_WINDOW_SPEC: SystemModalSpec = {
  id: 'close-window-1',
  title: 'Close window',
  message: 'This stops the running build.',
  confirmLabel: 'Close window',
  cancelLabel: 'Cancel',
  confirmStyle: 'primary',
  theme: { bg: '#000000', text: '#ffffff' }
}

const mounted: App[] = []

function mountModalPage() {
  let showModal: (spec: SystemModalSpec) => void = () => {
    throw new Error('the modal page did not subscribe to modals')
  }
  const bridge = {
    action: vi.fn<SystemModalBridge['action']>(),
    ready: vi.fn<SystemModalBridge['ready']>(),
    notifyRendered: vi.fn<SystemModalBridge['notifyRendered']>(),
    notifyRenderFailed: vi.fn<SystemModalBridge['notifyRenderFailed']>(),
    onModal: (cb: (spec: SystemModalSpec) => void) => {
      showModal = cb
      return () => {}
    }
  }
  Object.assign(window, { __comfySystemModal: bridge })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createSystemModalApp()
  app.config.warnHandler = () => {}
  app.mount(host)
  mounted.push(app)
  return { bridge, show: (spec: SystemModalSpec) => showModal(spec) }
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, '__comfySystemModal')
})

describe('system modal page', () => {
  it('shows the close window confirm, not only the dimmed backdrop', async () => {
    const { bridge, show } = mountModalPage()

    show(CLOSE_WINDOW_SPEC)
    await nextTick()

    await expect.element(page.getByRole('alertdialog', { name: 'Close window' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(bridge.notifyRendered).toHaveBeenCalled()
    expect(bridge.notifyRenderFailed).not.toHaveBeenCalled()
  })

  it('answers cancel when Cancel is pressed and confirm when Close window is pressed', async () => {
    const { bridge, show } = mountModalPage()

    show(CLOSE_WINDOW_SPEC)
    await page.getByRole('button', { name: 'Cancel' }).click()
    show({ ...CLOSE_WINDOW_SPEC, id: 'close-window-2' })
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Close window', exact: true })
      .click()

    expect(bridge.action.mock.calls).toEqual([
      [{ modalId: 'close-window-1', action: 'cancel' }],
      [{ modalId: 'close-window-2', action: 'confirm' }]
    ])
  })
})
