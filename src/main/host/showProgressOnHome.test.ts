import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeContents extends EventEmitter {
  loading = false
  destroyed = false
  sent: Array<{ channel: string; payload: unknown }> = []
  isDestroyed(): boolean {
    return this.destroyed
  }
  isLoadingMainFrame(): boolean {
    return this.loading
  }
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

const host = vi.hoisted(() => ({
  home: null as null | { windowKey: number; panelView: unknown },
  openOrFocusHomeHostWindow: vi.fn(() => ({ id: 'home' })),
  ensurePanelView: vi.fn()
}))

vi.mock('./registry', () => ({
  computeBodyMode: () => 'chooser',
  findEntryByHostWindow: () => host.home,
  openOrFocusHomeHostWindow: host.openOrFocusHomeHostWindow
}))
vi.mock('./panelView', () => ({ ensurePanelView: host.ensurePanelView }))

import { parseHomeProgressRequest, showProgressOnHome } from './showProgressOnHome'

const REQUEST = { installationId: 'studio', actionId: 'git-pull', title: 'Pulling' }

function homeWith(contents: FakeContents | null): FakeContents {
  const made = contents ?? new FakeContents()
  host.home = { windowKey: 2, panelView: contents ? { webContents: contents } : null }
  host.ensurePanelView.mockReturnValue({ webContents: made })
  return made
}

describe('parseHomeProgressRequest', () => {
  it('keeps a well-formed request', () => {
    expect(
      parseHomeProgressRequest({
        installationId: 'studio',
        actionId: 'update-comfyui',
        title: 'Updating - Studio',
        actionData: { channel: 'stable' },
        cancellable: true,
        opKind: 'update'
      })
    ).toEqual({
      installationId: 'studio',
      actionId: 'update-comfyui',
      title: 'Updating - Studio',
      actionData: { channel: 'stable' },
      cancellable: true,
      opKind: 'update',
      relaunch: false
    })
  })

  it('refuses a request without a build, an action or a title', () => {
    expect(parseHomeProgressRequest(null)).toBeNull()
    expect(parseHomeProgressRequest({ actionId: 'copy', title: 'Copy' })).toBeNull()
    expect(parseHomeProgressRequest({ installationId: 'studio', title: 'Copy' })).toBeNull()
    expect(parseHomeProgressRequest({ installationId: 'studio', actionId: 'copy' })).toBeNull()
  })

  it('drops an unknown kind and a non-object payload', () => {
    expect(
      parseHomeProgressRequest({
        installationId: 'studio',
        actionId: 'copy',
        title: 'Copy',
        opKind: 'format-disk',
        actionData: 'name'
      })
    ).toEqual({
      installationId: 'studio',
      actionId: 'copy',
      title: 'Copy',
      actionData: undefined,
      cancellable: false,
      opKind: undefined,
      relaunch: false
    })
  })
})

describe('showProgressOnHome', () => {
  beforeEach(() => {
    host.openOrFocusHomeHostWindow.mockClear()
    host.ensurePanelView.mockClear()
  })

  it('opens or focuses the Desktop window and runs the task there', async () => {
    const contents = homeWith(new FakeContents())

    await expect(showProgressOnHome(REQUEST)).resolves.toBe(true)

    expect(host.openOrFocusHomeHostWindow).toHaveBeenCalledOnce()
    expect(contents.sent).toEqual([
      {
        channel: 'panel-trigger-overlay',
        payload: expect.objectContaining({ kind: 'picker-show-progress', ...REQUEST })
      }
    ])
  })

  it('creates the Desktop panel when the window has none yet', async () => {
    const contents = homeWith(null)

    await expect(showProgressOnHome(REQUEST)).resolves.toBe(true)

    expect(host.ensurePanelView).toHaveBeenCalledOnce()
    expect(contents.sent).toHaveLength(1)
  })

  it('waits for a loading panel and reports delivery once it has loaded', async () => {
    const contents = homeWith(new FakeContents())
    contents.loading = true

    const delivered = showProgressOnHome(REQUEST)
    expect(contents.sent).toEqual([])
    contents.loading = false
    contents.emit('did-finish-load')

    await expect(delivered).resolves.toBe(true)
    expect(contents.sent).toHaveLength(1)
  })

  it('reports a lost hand-off when the panel closes before it loads', async () => {
    const contents = homeWith(new FakeContents())
    contents.loading = true

    const delivered = showProgressOnHome(REQUEST)
    contents.destroyed = true
    contents.emit('destroyed')

    await expect(delivered).resolves.toBe(false)
    expect(contents.sent).toEqual([])
  })

  it('falls back when the panel fails to load', async () => {
    const contents = homeWith(new FakeContents())
    contents.loading = true

    const delivered = showProgressOnHome(REQUEST)
    contents.emit('did-fail-load', {}, -2, 'main frame failed', 'app://panel', true)

    await expect(delivered).resolves.toBe(false)
    expect(contents.sent).toEqual([])
    expect(contents.listenerCount('did-finish-load'), 'no listener is left behind').toBe(0)
    expect(contents.listenerCount('destroyed'), 'no listener is left behind').toBe(0)
  })

  it('still delivers when only a subframe fails to load', async () => {
    const contents = homeWith(new FakeContents())
    contents.loading = true

    const delivered = showProgressOnHome(REQUEST)
    contents.emit('did-fail-load', {}, -2, 'subframe failed', 'about:blank', false)
    contents.emit('did-finish-load')

    await expect(delivered).resolves.toBe(true)
    expect(contents.sent).toHaveLength(1)
  })

  it('does nothing for a malformed request', async () => {
    await expect(showProgressOnHome({ installationId: 'studio' })).resolves.toBe(false)
    expect(host.openOrFocusHomeHostWindow).not.toHaveBeenCalled()
  })
})
