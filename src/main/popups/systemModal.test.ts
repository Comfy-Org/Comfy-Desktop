import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

type IpcListener = (event: { sender: { id: number } }, payload?: unknown) => void

const { ipcListeners, showMessageBox, views } = vi.hoisted(() => ({
  ipcListeners: new Map<string, IpcListener>(),
  showMessageBox: vi.fn(),
  views: [] as unknown[]
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: IpcListener) => ipcListeners.set(channel, listener)
  },
  dialog: { showMessageBox }
}))

vi.mock('../lib/titleBarOverlay', () => ({ TITLEBAR_HEIGHT: 36 }))

vi.mock('./embeddedPopupView', () => {
  let nextWebContentsId = 1
  class FakeEmbeddedPopupView {
    readonly parentWindow: BrowserWindow
    readonly parentWindowId: number
    readonly popupWebContentsId = nextWebContentsId++
    rendererReady = false
    isOpen = false
    crashed = false
    showTimer: (() => void) | null = null
    readonly sent: Array<{ channel: string; payload: unknown }> = []
    readonly webContentsListeners = new Map<string, () => void>()
    readonly popup = {
      setBounds: () => {},
      webContents: {
        id: this.popupWebContentsId,
        isDestroyed: () => false,
        isCrashed: () => this.crashed,
        send: (channel: string, payload: unknown) => this.sent.push({ channel, payload }),
        on: (event: string, listener: () => void) => this.webContentsListeners.set(event, listener)
      }
    }
    constructor(opts: { parent: BrowserWindow }) {
      this.parentWindow = opts.parent
      this.parentWindowId = opts.parent.id
      views.push(this)
    }
    isDestroyed(): boolean {
      return false
    }
    showOnTop(): void {
      this.showTimer = null
      this.isOpen = true
    }
    hide(): void {
      this.showTimer = null
      this.isOpen = false
    }
    scheduleShowFallback(_ms: number, callback: () => void): void {
      this.showTimer = callback
    }
    cancelPendingShow(): void {
      this.showTimer = null
    }
  }
  return { EmbeddedPopupView: FakeEmbeddedPopupView }
})

import { openSystemModalAsync, registerSystemModalIpc } from './systemModal'

interface FakeView {
  popupWebContentsId: number
  isOpen: boolean
  crashed: boolean
  showTimer: (() => void) | null
  webContentsListeners: Map<string, () => void>
}

let nextWindowId = 1

function makeParent(): BrowserWindow {
  return {
    id: nextWindowId++,
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    on: () => {},
    removeListener: () => {}
  } as unknown as BrowserWindow
}

function sendFromModalPage(view: FakeView, channel: string): void {
  const listener = ipcListeners.get(channel)
  if (!listener) throw new Error(`no listener for ${channel}`)
  listener({ sender: { id: view.popupWebContentsId } })
}

function askToCloseWindow(parent: BrowserWindow): Promise<boolean> {
  return openSystemModalAsync({
    parent,
    spec: {
      title: 'Close window',
      message: 'This stops the running build.',
      confirmLabel: 'Close window',
      cancelLabel: 'Cancel',
      confirmStyle: 'primary',
      theme: { bg: '#000000', text: '#ffffff' }
    }
  })
}

function latestView(): FakeView {
  return views[views.length - 1] as FakeView
}

beforeEach(() => {
  showMessageBox.mockReset()
  registerSystemModalIpc()
})

describe('system modal when its page cannot show the dialog', () => {
  it('asks with a native dialog, closes on Close window, and leaves the window undimmed', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const parent = makeParent()
    const answer = askToCloseWindow(parent)
    const view = latestView()
    sendFromModalPage(view, 'comfy-systemmodal:ready')

    sendFromModalPage(view, 'comfy-systemmodal:render-failed')
    sendFromModalPage(view, 'comfy-systemmodal:rendered')

    await expect(answer).resolves.toBe(true)
    expect(showMessageBox).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({
        message: 'Close window',
        detail: 'This stops the running build.',
        buttons: ['Close window', 'Cancel'],
        cancelId: 1
      })
    )
    expect(view.isOpen).toBe(false)
    expect(view.showTimer).toBeNull()
  })

  it('keeps the window open when Cancel is chosen in the native dialog', async () => {
    showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    const answer = askToCloseWindow(makeParent())
    const view = latestView()
    sendFromModalPage(view, 'comfy-systemmodal:ready')

    sendFromModalPage(view, 'comfy-systemmodal:render-failed')

    await expect(answer).resolves.toBe(false)
    expect(view.isOpen).toBe(false)
  })

  it('asks with a native dialog when the modal page has crashed', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const parent = makeParent()
    const first = askToCloseWindow(parent)
    const view = latestView()
    sendFromModalPage(view, 'comfy-systemmodal:ready')
    view.crashed = true
    view.webContentsListeners.get('render-process-gone')?.()
    await expect(first).resolves.toBe(true)

    await expect(askToCloseWindow(parent)).resolves.toBe(true)
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    expect(view.isOpen).toBe(false)
  })

  it('shows the in-app dialog without a native one when the page renders it', async () => {
    const parent = makeParent()
    void askToCloseWindow(parent)
    const view = latestView()
    sendFromModalPage(view, 'comfy-systemmodal:ready')

    sendFromModalPage(view, 'comfy-systemmodal:rendered')

    expect(view.isOpen).toBe(true)
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('cancels a native dialog request that a newer modal replaces and ignores its late answer', async () => {
    let answerFirstDialog: (value: { response: number }) => void = () => {}
    showMessageBox.mockImplementationOnce(
      () => new Promise((resolve) => (answerFirstDialog = resolve))
    )
    const parent = makeParent()
    const superseded = vi.fn()
    void openSystemModalAsync({
      parent,
      spec: {
        title: 'Close window',
        message: '',
        confirmLabel: 'Close window',
        cancelLabel: 'Cancel',
        theme: { bg: '#000000', text: '#ffffff' }
      },
      callback: superseded
    })
    const view = latestView()
    sendFromModalPage(view, 'comfy-systemmodal:ready')
    sendFromModalPage(view, 'comfy-systemmodal:render-failed')

    void askToCloseWindow(parent)
    answerFirstDialog({ response: 0 })
    await vi.waitFor(() => expect(superseded).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(superseded.mock.calls).toEqual([['cancel']])
  })

  it('asks with a native dialog for every request after the page crashes before it is ready', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const parent = makeParent()
    const first = askToCloseWindow(parent)
    const view = latestView()
    view.crashed = true
    view.webContentsListeners.get('render-process-gone')?.()
    await expect(first).resolves.toBe(true)

    await expect(askToCloseWindow(parent)).resolves.toBe(true)
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })
})
