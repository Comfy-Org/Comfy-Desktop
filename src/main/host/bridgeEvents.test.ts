import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  comfyHost: null as { installationId: string | null; comfyUrl: string } | null
}))

vi.mock('./registry', () => ({ findEntryByComfySender: () => mocks.comfyHost }))

import { sendBridgeEvent } from './bridgeEvents'

const INSTALL_URL = 'http://127.0.0.1:8188'

function pageAt(
  url: string,
  destroyed = false
): { contents: WebContents; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const contents = { send, getURL: () => url, isDestroyed: () => destroyed }
  return { contents: contents as unknown as WebContents, send }
}

beforeEach(() => {
  mocks.comfyHost = null
})

describe('events Desktop pushes to a page', () => {
  it("reach a ComfyUI view that shows its install's site", () => {
    mocks.comfyHost = { installationId: 'inst-1', comfyUrl: INSTALL_URL }
    const page = pageAt(`${INSTALL_URL}/`)

    sendBridgeEvent(page.contents, 'logs-output', { text: 'ready' })

    expect(page.send).toHaveBeenCalledExactlyOnceWith('logs-output', { text: 'ready' })
  })

  it('are held back from a ComfyUI view that shows another site', () => {
    mocks.comfyHost = { installationId: 'inst-1', comfyUrl: INSTALL_URL }
    const page = pageAt('https://elsewhere.example.test/')

    sendBridgeEvent(page.contents, 'logs-output', { text: 'secret path' })

    expect(page.send).not.toHaveBeenCalled()
  })

  it("reach Desktop's own windows, which are not ComfyUI views", () => {
    const page = pageAt('data:text/html;charset=utf-8,logs')

    sendBridgeEvent(page.contents, 'logs-output', { text: 'ready' })

    expect(page.send).toHaveBeenCalledTimes(1)
  })

  it('skip a page that has been closed', () => {
    const page = pageAt(`${INSTALL_URL}/`, true)

    sendBridgeEvent(page.contents, 'logs-output', { text: 'ready' })

    expect(page.send).not.toHaveBeenCalled()
  })
})
