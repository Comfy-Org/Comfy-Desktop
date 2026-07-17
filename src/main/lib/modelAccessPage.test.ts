import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const mocks = vi.hoisted(() => ({
  createBrowserWindow: vi.fn(),
  findEntryByComfySender: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      return mocks.createBrowserWindow(options)
    }
  }
}))

vi.mock('../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender
}))

import { isModelAccessPageUrl, openModelAccessPageWindow } from './modelAccessPage'

describe('isModelAccessPageUrl', () => {
  it('allows HTTPS Hugging Face pages', () => {
    expect(isModelAccessPageUrl('https://huggingface.co/black-forest-labs/FLUX.1-dev')).toBe(true)
  })

  it.each([
    'http://huggingface.co/black-forest-labs/FLUX.1-dev',
    'https://huggingface.co.evil.com/model',
    'https://huggingface.co@evil.com/model',
    'https://huggingface.co:8443/model',
    'not a url'
  ])('rejects unsafe model access URL %s', (url) => {
    expect(isModelAccessPageUrl(url)).toBe(false)
  })
})

describe('openModelAccessPageWindow', () => {
  const parent = { isDestroyed: vi.fn(() => false) }
  const accessWindow = {
    once: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
    close: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findEntryByComfySender.mockReturnValue({ window: parent })
    mocks.createBrowserWindow.mockReturnValue(accessWindow)
  })

  it('opens the access page with the calling Comfy view session', () => {
    const session = { id: 'comfy-session' }
    const sender = { session }
    const url = 'https://huggingface.co/black-forest-labs/FLUX.1-dev'

    expect(openModelAccessPageWindow(sender as unknown as WebContents, url)).toBe(true)
    expect(mocks.createBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        parent,
        webPreferences: expect.objectContaining({ session })
      })
    )
    expect(accessWindow.loadURL).toHaveBeenCalledWith(url)
  })

  it('keeps the access window open when the initial navigation is superseded', async () => {
    accessWindow.loadURL.mockRejectedValueOnce(new Error('ERR_ABORTED'))

    expect(
      openModelAccessPageWindow(
        { session: {} } as unknown as WebContents,
        'https://huggingface.co/black-forest-labs/FLUX.1-dev'
      )
    ).toBe(true)
    await Promise.resolve()

    expect(accessWindow.close).not.toHaveBeenCalled()
  })

  it('rejects untrusted URLs before creating a window', () => {
    expect(
      openModelAccessPageWindow(
        { session: {} } as unknown as WebContents,
        'https://example.com/model'
      )
    ).toBe(false)
    expect(mocks.findEntryByComfySender).not.toHaveBeenCalled()
    expect(mocks.createBrowserWindow).not.toHaveBeenCalled()
  })
})
