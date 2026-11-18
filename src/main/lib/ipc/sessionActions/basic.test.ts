import { beforeEach, describe, expect, it, vi } from 'vitest'

const hasNameConflict = vi.fn<(id: string, name: string) => Promise<boolean>>()
const update = vi.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>()
const remove = vi.fn<(id: string) => Promise<void>>()
const stopRunning = vi.fn<(id: string) => Promise<void>>()
const runningSessions = new Map<string, { sourceInstallationId?: string }>()
let keepComfyRunning = true

vi.mock('../shared', () => ({
  installations: {
    get hasNameConflict() {
      return hasNameConflict
    },
    get update() {
      return update
    },
    get remove() {
      return remove
    }
  },
  get stopRunning() {
    return stopRunning
  },
  get _runningSessions() {
    return runningSessions
  },
  keepsComfyRunningWhenWindowCloses: () => keepComfyRunning,
  i18n: {
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key
  },
  fs: {},
  openPath: vi.fn()
}))

import { handleRemove, handleRename } from './basic'
import type { ActionContext } from './types'

function ctx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    event: {} as ActionContext['event'],
    installationId: 'inst-1',
    inst: { id: 'inst-1', name: 'Old Name' } as ActionContext['inst'],
    actionData: { name: 'New Name' },
    ...overrides
  }
}

describe('handleRename', () => {
  beforeEach(() => {
    hasNameConflict.mockReset()
    update.mockReset()
    hasNameConflict.mockResolvedValue(false)
    update.mockResolvedValue(undefined)
  })

  it('renames and navigates back to detail on a fresh name', async () => {
    const result = await handleRename(ctx())
    expect(hasNameConflict).toHaveBeenCalledWith('inst-1', 'New Name')
    expect(update).toHaveBeenCalledWith('inst-1', { name: 'New Name' })
    expect(result).toEqual({ ok: true, navigate: 'detail' })
  })

  it('trims surrounding whitespace before persisting', async () => {
    await handleRename(ctx({ actionData: { name: '  Padded  ' } }))
    expect(update).toHaveBeenCalledWith('inst-1', { name: 'Padded' })
  })

  it('rejects an empty / whitespace-only name without writing', async () => {
    const result = await handleRename(ctx({ actionData: { name: '   ' } }))
    expect(update).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.message).toBe('errors.nameRequired')
  })

  it('rejects a duplicate name without writing', async () => {
    hasNameConflict.mockResolvedValue(true)
    const result = await handleRename(ctx())
    expect(update).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('errors.duplicateName')
  })

  it('treats renaming to the current name as a no-op (no write, no conflict check)', async () => {
    const result = await handleRename(ctx({ actionData: { name: 'Old Name' } }))
    expect(hasNameConflict).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, navigate: 'detail' })
  })
})

describe('handleRemove', () => {
  beforeEach(() => {
    remove.mockReset()
    stopRunning.mockReset()
    remove.mockResolvedValue(undefined)
    stopRunning.mockResolvedValue(undefined)
    runningSessions.clear()
    keepComfyRunning = true
  })

  it('removes a running Build without stopping its ComfyUI when keepComfyRunningWhenWindowCloses is off', async () => {
    keepComfyRunning = false
    runningSessions.set('inst-1', {})

    const result = await handleRemove(ctx())

    expect(remove).toHaveBeenCalledWith('inst-1')
    expect(stopRunning).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, navigate: 'list' })
  })

  it('stops the ComfyUI of a removed Build that is running, with its helper sessions, when it keeps running with its window closed', async () => {
    runningSessions.set('inst-1', {})
    runningSessions.set('performance-test:inst-1', { sourceInstallationId: 'inst-1' })
    runningSessions.set('inst-2', {})

    const result = await handleRemove(ctx())

    expect(remove).toHaveBeenCalledWith('inst-1')
    expect(stopRunning.mock.calls.map(([id]) => id).sort()).toEqual([
      'inst-1',
      'performance-test:inst-1'
    ])
    expect(result).toEqual({ ok: true, navigate: 'list' })
  })

  it('stops no ComfyUI when the removed Build is not running', async () => {
    runningSessions.set('inst-2', {})

    const result = await handleRemove(ctx())

    expect(remove).toHaveBeenCalledWith('inst-1')
    expect(stopRunning).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, navigate: 'list' })
  })
})
