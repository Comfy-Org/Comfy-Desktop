import { EventEmitter } from 'node:events'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  WebContentsView: class {
    readonly webContents = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/out/renderer/panel.html',
      setWindowOpenHandler: vi.fn()
    })
    constructor(readonly options?: unknown) {}
  }
}))

import { createDesktopPageView, createWebContentsView } from './webContentsViewLifetime'

setFlagsFromString('--expose-gc')
const collectGarbage = runInNewContext('gc') as () => void

const GARBAGE_COLLECTION_ROUNDS = 10

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function createViewNobodyElseReferences(options?: Electron.WebContentsViewConstructorOptions): {
  view: WeakRef<Electron.WebContentsView>
  webContents: WeakRef<EventEmitter>
} {
  const view = createWebContentsView(options)
  return {
    view: new WeakRef(view),
    webContents: new WeakRef(view.webContents as unknown as EventEmitter)
  }
}

async function survivesGarbageCollection(ref: WeakRef<object>): Promise<boolean> {
  for (let round = 0; round < GARBAGE_COLLECTION_ROUNDS; round++) {
    await nextMacrotask()
    collectGarbage()
    if (ref.deref() === undefined) return false
  }
  return true
}

function navigationIsStopped(view: Electron.WebContentsView, url: string): boolean {
  const event = { preventDefault: vi.fn() }
  ;(view.webContents as unknown as EventEmitter).emit('will-navigate', event, url)
  return event.preventDefault.mock.calls.length > 0
}

describe('createDesktopPageView', () => {
  it("makes a view that stays on Desktop's page", () => {
    const options = { webPreferences: { sandbox: true } }

    const view = createDesktopPageView(options)

    expect((view as unknown as { options: unknown }).options).toBe(options)
    expect(navigationIsStopped(view, 'https://elsewhere.example.test/')).toBe(true)
    expect(view.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
  })
})

describe('createWebContentsView', () => {
  it('passes the options to the view it creates', () => {
    const options = { webPreferences: { sandbox: true } }

    const view = createWebContentsView(options)

    expect((view as unknown as { options: unknown }).options).toBe(options)
  })

  it('leaves navigation to the caller, for views that show websites', () => {
    const view = createWebContentsView()

    expect(navigationIsStopped(view, 'https://elsewhere.example.test/')).toBe(false)
    expect(view.webContents.setWindowOpenHandler).not.toHaveBeenCalled()
  })

  it('keeps a view nobody else references alive while its webContents is alive', async () => {
    const { view } = createViewNobodyElseReferences()

    expect(await survivesGarbageCollection(view)).toBe(true)
  })

  it('lets the view be collected after its webContents is destroyed', async () => {
    const { view, webContents } = createViewNobodyElseReferences()
    await nextMacrotask()

    webContents.deref()?.emit('destroyed')

    expect(await survivesGarbageCollection(view)).toBe(false)
  })

  it('holds the view until the turn that destroyed its webContents has finished', async () => {
    const { view, webContents } = createViewNobodyElseReferences()
    await nextMacrotask()

    webContents.deref()?.emit('destroyed')
    collectGarbage()

    expect(view.deref()).toBeDefined()
  })
})
