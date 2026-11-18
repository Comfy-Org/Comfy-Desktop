import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => {
  const homeWindow = { id: 'home' }
  const panelView = { webContents: { isDestroyed: () => false } }
  return {
    homeWindow,
    panelView,
    entries: new Map<number, unknown>(),
    openOrFocusHomeHostWindow: vi.fn(() => homeWindow),
    sendToPanelDeferred: vi.fn()
  }
})

vi.mock('./registry', () => ({
  comfyWindows: host.entries,
  isChooserHost: (entry: { installationId: string | null }) => entry.installationId === null,
  openOrFocusHomeHostWindow: host.openOrFocusHomeHostWindow
}))
vi.mock('./panelView', () => ({ sendToPanelDeferred: host.sendToPanelDeferred }))

import { parseHomeProgressRequest, showProgressOnHome } from './showProgressOnHome'

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
      opKind: 'update'
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
      opKind: undefined
    })
  })
})

describe('showProgressOnHome', () => {
  beforeEach(() => {
    host.entries.clear()
    host.openOrFocusHomeHostWindow.mockClear()
    host.sendToPanelDeferred.mockClear()
  })

  it('opens or focuses the Desktop window and runs the task there', () => {
    host.entries.set(1, { window: { id: 'build' }, installationId: 'studio', panelView: {} })
    host.entries.set(2, {
      window: host.homeWindow,
      installationId: null,
      panelView: host.panelView
    })

    expect(
      showProgressOnHome({ installationId: 'studio', actionId: 'git-pull', title: 'Pulling' })
    ).toBe(true)

    expect(host.openOrFocusHomeHostWindow).toHaveBeenCalledOnce()
    expect(host.sendToPanelDeferred).toHaveBeenCalledWith(
      host.panelView,
      'panel-trigger-overlay',
      expect.objectContaining({
        kind: 'picker-show-progress',
        installationId: 'studio',
        actionId: 'git-pull',
        title: 'Pulling'
      })
    )
  })

  it('does nothing for a malformed request', () => {
    expect(showProgressOnHome({ installationId: 'studio' })).toBe(false)
    expect(host.openOrFocusHomeHostWindow).not.toHaveBeenCalled()
    expect(host.sendToPanelDeferred).not.toHaveBeenCalled()
  })
})
