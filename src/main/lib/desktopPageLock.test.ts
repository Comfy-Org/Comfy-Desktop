import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { keepOnDesktopPage } from './desktopPageLock'

const PANEL_URL = 'file:///app/out/renderer/panel.html?panel=chooser'

class FakePage extends EventEmitter {
  url = PANEL_URL
  readonly setWindowOpenHandler = vi.fn()
  getURL(): string {
    return this.url
  }
  navigateTo(url: string): { stopped: boolean } {
    const event = { stopped: false, preventDefault: () => void (event.stopped = true) }
    this.emit('will-navigate', event, url)
    return { stopped: event.stopped }
  }
  askForWindow(url: string): unknown {
    const [handler] = this.setWindowOpenHandler.mock.calls[0] as [(details: unknown) => unknown]
    return handler({ url })
  }
}

function lockedPage(): FakePage {
  const page = new FakePage()
  keepOnDesktopPage(page as unknown as WebContents)
  return page
}

describe("one of Desktop's own pages", () => {
  it.each([
    'https://elsewhere.example.test/',
    'file:///etc/hosts',
    'file:///app/out/renderer/comfyTitleBar.html',
    'data:text/html,<p>other</p>'
  ])('cannot be sent to %s', (url) => {
    expect(lockedPage().navigateTo(url)).toEqual({ stopped: true })
  })

  it('can reload itself, as the dev server does after an edit', () => {
    expect(lockedPage().navigateTo(PANEL_URL)).toEqual({ stopped: false })
  })

  it('can move within itself', () => {
    expect(lockedPage().navigateTo(`${PANEL_URL}#section`)).toEqual({ stopped: false })
  })

  it('opens no window of its own', () => {
    expect(lockedPage().askForWindow('https://elsewhere.example.test/')).toEqual({
      action: 'deny'
    })
  })
})
