import { describe, expect, it, vi } from 'vitest'
import { useInstanceActions, type InstanceActionsBridge } from './useInstanceActions'
import type { NavDecision } from '../../../shared/navigation/navDecision'
import type { Installation } from '../types/ipc'

function makeBridge() {
  return {
    pickInstall: vi.fn(),
    restartInstall: vi.fn(),
    openNewInstall: vi.fn()
  } satisfies InstanceActionsBridge
}

function installation(over: Partial<Installation> = {}): Installation {
  return { id: 'a', name: 'Alpha', sourceCategory: 'local', ...over } as Installation
}

function decision(over: Partial<NavDecision>): NavDecision {
  return {
    verb: 'start',
    primaryLabel: 'instancePicker.open',
    ...over
  }
}

function makeDeps(
  bridge: InstanceActionsBridge,
  over: Partial<Parameters<typeof useInstanceActions>[0]> = {}
) {
  return {
    bridge,
    confirmLocalKill: vi.fn().mockResolvedValue(true),
    ...over
  }
}

describe('useInstanceActions.dispatch', () => {
  it('start → pickInstall, with no confirm because nothing is replaced', async () => {
    const bridge = makeBridge()
    const deps = makeDeps(bridge)
    await useInstanceActions(deps).dispatch(decision({ verb: 'start' }), installation())
    expect(bridge.pickInstall).toHaveBeenCalledExactlyOnceWith('a')
    expect(deps.confirmLocalKill).not.toHaveBeenCalled()
  })

  it('routes restart → restartInstall(confirmed:true) after a confirm', async () => {
    const bridge = makeBridge()
    const deps = makeDeps(bridge)
    await useInstanceActions(deps).dispatch(decision({ verb: 'restart' }), installation())
    expect(deps.confirmLocalKill).toHaveBeenCalled()
    expect(bridge.restartInstall).toHaveBeenCalledWith('a', { confirmed: true })
  })

  it('aborts restart when the local kill confirm is declined', async () => {
    const bridge = makeBridge()
    const deps = makeDeps(bridge, { confirmLocalKill: vi.fn().mockResolvedValue(false) })
    await useInstanceActions(deps).dispatch(decision({ verb: 'restart' }), installation())
    expect(bridge.restartInstall).not.toHaveBeenCalled()
  })

  it('routes open-new → pickInstall, the one channel main routes every build pick through', async () => {
    const bridge = makeBridge()
    await useInstanceActions(makeDeps(bridge)).dispatch(
      decision({ verb: 'open-new' }),
      installation()
    )
    expect(bridge.pickInstall).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('routes focus → pickInstall (main short-circuits to focus when already up)', async () => {
    const bridge = makeBridge()
    await useInstanceActions(makeDeps(bridge)).dispatch(decision({ verb: 'focus' }), installation())
    expect(bridge.pickInstall).toHaveBeenCalledWith('a')
  })

  it('routes install-wizard → openNewInstall', async () => {
    const bridge = makeBridge()
    await useInstanceActions(makeDeps(bridge)).dispatch(
      decision({ verb: 'install-wizard' }),
      installation()
    )
    expect(bridge.openNewInstall).toHaveBeenCalled()
  })

  it('no-op verb fires nothing', async () => {
    const bridge = makeBridge()
    await useInstanceActions(makeDeps(bridge)).dispatch(decision({ verb: 'no-op' }), installation())
    expect(bridge.pickInstall).not.toHaveBeenCalled()
    expect(bridge.restartInstall).not.toHaveBeenCalled()
  })

  it('no-ops when the bridge is undefined', async () => {
    const deps = { ...makeDeps(makeBridge()), bridge: undefined }
    await expect(
      useInstanceActions(deps).dispatch(decision({ verb: 'start' }), installation())
    ).resolves.toBeUndefined()
  })

  it('aborts (does not throw to the caller) when a confirm dialog rejects', async () => {
    const bridge = makeBridge()
    const deps = makeDeps(bridge, {
      confirmLocalKill: vi.fn().mockRejectedValue(new Error('dialog torn down'))
    })
    await expect(
      useInstanceActions(deps).dispatch(decision({ verb: 'restart' }), installation())
    ).resolves.toBeUndefined()
    expect(bridge.restartInstall).not.toHaveBeenCalled()
  })
})
