import { EventEmitter } from 'node:events'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  WebContentsView: class {
    readonly webContents = new EventEmitter()
    constructor(readonly options?: unknown) {}
  }
}))

import { createWebContentsView } from './webContentsViewLifetime'

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

describe('createWebContentsView', () => {
  it('passes the options to the view it creates', () => {
    const options = { webPreferences: { sandbox: true } }

    const view = createWebContentsView(options)

    expect((view as unknown as { options: unknown }).options).toBe(options)
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
