import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub every handler module and the broadcast helper so the dispatch wrapper
// can be exercised without an Electron runtime or datastore.
const broadcast = vi.fn<(channel: string, data: unknown) => void>()
const delegate = vi.fn<() => Promise<{ ok: boolean }>>()
const launch = vi.fn<() => Promise<{ ok: boolean }>>()

vi.mock('../broadcast', () => ({
  _broadcastToRenderer: (channel: string, data: unknown) => broadcast(channel, data)
}))
vi.mock('./basic', () => ({
  handleRemove: vi.fn(),
  handleOpenFolder: vi.fn(),
  handleRename: vi.fn()
}))
vi.mock('./delete', () => ({ handleDelete: vi.fn() }))
vi.mock('./copy', () => ({
  handleCopy: vi.fn(),
  handleCopyUpdate: vi.fn(),
  handleCopyChangePytorch: vi.fn(),
  handleReleaseUpdate: vi.fn()
}))
vi.mock('./migrate', () => ({ handleMigrateToStandalone: vi.fn() }))
vi.mock('./launch', () => ({ handleLaunch: (...args: unknown[]) => launch(...(args as [])) }))
vi.mock('./delegate', () => ({
  handleDelegateToSource: (...args: unknown[]) => delegate(...(args as []))
}))
vi.mock('./withAbortable', () => ({ withAbortableSessionAction: vi.fn() }))

import { dispatchSessionAction, _getActiveOperations } from './index'
import type { ActionContext } from './types'

function ctx(installationId = 'inst-1'): ActionContext {
  return {
    event: {} as ActionContext['event'],
    installationId,
    inst: { id: installationId } as ActionContext['inst']
  }
}

describe('dispatchSessionAction operation tracking', () => {
  beforeEach(() => {
    broadcast.mockReset()
    delegate.mockReset()
    launch.mockReset()
    delegate.mockResolvedValue({ ok: true })
    launch.mockResolvedValue({ ok: true })
  })

  it('broadcasts operation-changed around a delegated action and exposes it in the snapshot', async () => {
    let resolveAction!: (value: { ok: boolean }) => void
    delegate.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    const pending = dispatchSessionAction(ctx(), 'update-comfyui')

    expect(broadcast).toHaveBeenCalledWith('operation-changed', {
      installationId: 'inst-1',
      actionId: 'update-comfyui',
      active: true
    })
    expect(_getActiveOperations()).toEqual([
      { installationId: 'inst-1', actionId: 'update-comfyui' }
    ])

    resolveAction({ ok: true })
    await pending

    expect(broadcast).toHaveBeenCalledWith('operation-changed', {
      installationId: 'inst-1',
      actionId: 'update-comfyui',
      active: false
    })
    expect(_getActiveOperations()).toEqual([])
  })

  it('broadcasts around session-handled actions too', async () => {
    await dispatchSessionAction(ctx(), 'launch')

    expect(launch).toHaveBeenCalled()
    expect(broadcast).toHaveBeenCalledWith('operation-changed', {
      installationId: 'inst-1',
      actionId: 'launch',
      active: true
    })
    expect(broadcast).toHaveBeenCalledWith('operation-changed', {
      installationId: 'inst-1',
      actionId: 'launch',
      active: false
    })
  })

  it('clears the entry and broadcasts the end even when the handler throws', async () => {
    delegate.mockRejectedValue(new Error('boom'))

    await expect(dispatchSessionAction(ctx(), 'update-comfyui')).rejects.toThrow('boom')

    expect(_getActiveOperations()).toEqual([])
    expect(broadcast).toHaveBeenCalledWith('operation-changed', {
      installationId: 'inst-1',
      actionId: 'update-comfyui',
      active: false
    })
  })

  it('lets a nested dispatch for the same install neither replace nor clear the outer entry', async () => {
    let finishOuter!: (value: { ok: boolean }) => void
    const outerGate = new Promise<{ ok: boolean }>((resolve) => (finishOuter = resolve))
    delegate.mockImplementation(async () => {
      // Simulate a handler that dispatches a nested action mid-flight.
      await dispatchSessionAction(ctx(), 'launch')
      return outerGate
    })

    const pending = dispatchSessionAction(ctx(), 'update-comfyui')
    // Yield so the nested dispatch inside the mock has run and finished.
    await vi.waitFor(() => expect(launch).toHaveBeenCalled())

    // The nested launch must not have announced itself or cleared the outer op.
    expect(_getActiveOperations()).toEqual([
      { installationId: 'inst-1', actionId: 'update-comfyui' }
    ])
    expect(broadcast).not.toHaveBeenCalledWith('operation-changed', {
      installationId: 'inst-1',
      actionId: 'launch',
      active: true
    })

    finishOuter({ ok: true })
    await pending
    expect(_getActiveOperations()).toEqual([])
  })

  it('tracks concurrent actions on different installs independently', async () => {
    let resolveA!: (value: { ok: boolean }) => void
    let resolveB!: (value: { ok: boolean }) => void
    delegate
      .mockReturnValueOnce(new Promise((resolve) => (resolveA = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveB = resolve)))

    const a = dispatchSessionAction(ctx('inst-a'), 'update-comfyui')
    const b = dispatchSessionAction(ctx('inst-b'), 'check-update')

    expect(_getActiveOperations()).toEqual([
      { installationId: 'inst-a', actionId: 'update-comfyui' },
      { installationId: 'inst-b', actionId: 'check-update' }
    ])

    resolveA({ ok: true })
    await a
    expect(_getActiveOperations()).toEqual([{ installationId: 'inst-b', actionId: 'check-update' }])

    resolveB({ ok: true })
    await b
    expect(_getActiveOperations()).toEqual([])
  })
})
