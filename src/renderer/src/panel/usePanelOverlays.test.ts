import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { firstUseModeForOverlaySwap, usePanelOverlays } from './usePanelOverlays'
import type { Overlay } from '../composables/useOverlay'
import { useInstallationStore } from '../stores/installationStore'
import { useProgressStore, type Operation } from '../stores/progressStore'
import type { Installation } from '../types/ipc'

const modal = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }))

vi.mock('../composables/useModal', () => ({
  useModal: () => ({ alert: vi.fn(), confirm: modal.confirm, close: vi.fn() })
}))
vi.mock('../stores/dashboardScopeStore', () => ({ useDashboardScopeStore: () => ({}) }))

const progressTakeover: Overlay = { kind: 'takeover', component: 'update' }
const firstUseTakeover: Overlay = { kind: 'takeover', component: 'first-use' }
const newInstallTakeover: Overlay = { kind: 'takeover', component: 'new-install' }
const progressOverlay: Overlay = { kind: 'progress', installationId: 'inst-1' }

function mountOverlays(installationId: string): ReturnType<typeof usePanelOverlays> {
  let overlays!: ReturnType<typeof usePanelOverlays>
  mount(
    defineComponent({
      setup() {
        overlays = usePanelOverlays({
          installationId,
          progressRef: ref(null),
          newInstallRef: ref(null),
          trackRef: ref(null),
          loadSnapshotRef: ref(null),
          quickInstallRef: ref(null),
          firstUseRef: ref(null)
        })
        return () => h('div')
      }
    })
  )
  return overlays
}

describe('firstUseModeForOverlaySwap', () => {
  it('pushes loading-lockdown when the ProgressModal takeover mounts', () => {
    expect(firstUseModeForOverlaySwap(progressTakeover, null, false)).toBe('loading-lockdown')
  })

  it('stays silent while the ProgressModal takeover remains up', () => {
    expect(firstUseModeForOverlaySwap(progressTakeover, progressTakeover, false)).toBeNull()
  })

  it('stays silent while a first-use takeover is on screen (it owns its own pushes)', () => {
    expect(firstUseModeForOverlaySwap(firstUseTakeover, null, false)).toBeNull()
    expect(firstUseModeForOverlaySwap(firstUseTakeover, newInstallTakeover, true)).toBeNull()
  })

  it('suppresses the none push on the first-use -> takeover chain handoff', () => {
    expect(firstUseModeForOverlaySwap(newInstallTakeover, firstUseTakeover, true)).toBeNull()
  })

  it('pushes none on a first-use -> takeover swap when the chain is NOT active', () => {
    expect(firstUseModeForOverlaySwap(newInstallTakeover, firstUseTakeover, false)).toBe('none')
  })

  it('pushes none on an ordinary first-use close even with a stale chain flag', () => {
    expect(firstUseModeForOverlaySwap(null, firstUseTakeover, true)).toBe('none')
  })

  it('pushes none on a first-use -> progress (non-takeover) transition despite an active chain', () => {
    expect(firstUseModeForOverlaySwap(progressOverlay, firstUseTakeover, true)).toBe('none')
  })

  it('pushes none when the ProgressModal takeover closes', () => {
    expect(firstUseModeForOverlaySwap(null, progressTakeover, false)).toBe('none')
  })

  it('pushes none on the immediate mount fire with no overlay (clears stale lockdown drift)', () => {
    expect(firstUseModeForOverlaySwap(null, undefined, false)).toBe('none')
  })
})

describe('leaving a window while its build is starting', () => {
  const BUILD = 'studio'
  const api = {
    setFirstUseMode: vi.fn(),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    cancelOperation: vi.fn(),
    stopComfyUI: vi.fn(),
    closeCurrentPanel: vi.fn(),
    getSetting: vi.fn().mockResolvedValue(undefined)
  }

  async function showInWindow(
    opKind: Operation['opKind']
  ): Promise<ReturnType<typeof usePanelOverlays>> {
    const overlays = mountOverlays(BUILD)
    overlays.currentOverlay.value = null
    useInstallationStore().installations = [
      { id: BUILD, name: 'Studio', sourceCategory: 'local' } as Installation
    ]
    useProgressStore().operations.set(BUILD, {
      title: 'Studio',
      opKind,
      finished: false,
      cancelRequested: false
    } as Operation)
    await overlays.handleShowProgress({
      installationId: BUILD,
      title: 'Studio',
      apiCall: async () => ({ ok: true }),
      opKind
    })
    expect(overlays.currentOverlay.value?.kind).toBe('takeover')
    return overlays
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { api: typeof api }).api = api
    for (const fn of Object.values(api)) fn.mockClear()
    modal.confirm.mockClear()
  })

  it('returning to Home leaves the start running, without asking', async () => {
    const overlays = await showInWindow('launch')

    await expect(overlays.closeOverlay()).resolves.toBe(true)

    expect(modal.confirm).not.toHaveBeenCalled()
    expect(api.cancelOperation).not.toHaveBeenCalled()
    expect(overlays.currentOverlay.value).toBeNull()
  })

  it('returning to Home asks, then cancels the start when keepComfyRunningWhenWindowCloses is off', async () => {
    const overlays = await showInWindow('launch')
    api.getSetting.mockResolvedValueOnce(false)

    await expect(overlays.closeOverlay()).resolves.toBe(true)

    expect(modal.confirm).toHaveBeenCalledOnce()
    expect(api.cancelOperation).toHaveBeenCalledWith(BUILD)
  })

  it('returning to Home still asks, then cancels an install', async () => {
    const overlays = await showInWindow('install')

    await expect(overlays.closeOverlay()).resolves.toBe(true)

    expect(modal.confirm).toHaveBeenCalledOnce()
    expect(api.cancelOperation).toHaveBeenCalledWith(BUILD)
  })

  it('leaves the close of a window whose build starts to Desktop, which asks if the close quits', async () => {
    const overlays = await showInWindow('launch')

    await expect(overlays.answerCloseRequest()).resolves.toEqual({ defer: true })

    expect(modal.confirm).not.toHaveBeenCalled()
    expect(api.cancelOperation).not.toHaveBeenCalled()
  })

  it('asks itself, then cancels the start, when its window closes with keepComfyRunningWhenWindowCloses off', async () => {
    const overlays = await showInWindow('launch')
    api.getSetting.mockResolvedValueOnce(false)

    await expect(overlays.answerCloseRequest()).resolves.toEqual({ cleared: true })

    expect(modal.confirm).toHaveBeenCalledOnce()
    expect(api.cancelOperation).toHaveBeenCalledWith(BUILD)
  })

  it('asks itself, then cancels an install, when its window closes', async () => {
    const overlays = await showInWindow('install')

    await expect(overlays.answerCloseRequest()).resolves.toEqual({ cleared: true })

    expect(modal.confirm).toHaveBeenCalledOnce()
    expect(api.cancelOperation).toHaveBeenCalledWith(BUILD)
  })

  function replaceTakeoverWhileReadingTheSetting(
    overlays: ReturnType<typeof usePanelOverlays>
  ): Overlay {
    const setupFlow: Overlay = {
      kind: 'takeover',
      component: 'new-install',
      cancelCopyKey: 'discard-setup'
    }
    api.getSetting.mockImplementationOnce(async () => {
      await overlays.openOverlay(setupFlow)
      return undefined
    })
    return setupFlow
  }

  it('returning to Home asks before closing a takeover that replaced the start while the setting was read', async () => {
    const overlays = await showInWindow('launch')
    const setupFlow = replaceTakeoverWhileReadingTheSetting(overlays)
    modal.confirm.mockResolvedValueOnce(false)

    await expect(overlays.closeOverlay()).resolves.toBe(false)

    expect(modal.confirm).toHaveBeenCalledOnce()
    expect(overlays.currentOverlay.value).toEqual(setupFlow)
  })

  it('asks before clearing a takeover that replaced the start while the setting was read, when its window closes', async () => {
    const overlays = await showInWindow('launch')
    replaceTakeoverWhileReadingTheSetting(overlays)

    await expect(overlays.answerCloseRequest()).resolves.toEqual({ cleared: true })

    expect(modal.confirm).toHaveBeenCalledOnce()
    expect(overlays.currentOverlay.value).toBeNull()
  })
})

describe('closing the Desktop window with a dialog open while a build updates', () => {
  const BUILD = 'studio'
  const api = {
    setFirstUseMode: vi.fn(),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    cancelOperation: vi.fn(),
    stopComfyUI: vi.fn(),
    closeCurrentPanel: vi.fn(),
    getSetting: vi.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { api: typeof api }).api = api
    for (const fn of Object.values(api)) fn.mockClear()
    modal.confirm.mockClear()
  })

  it('closes the dialog, then still asks before it stops the update', async () => {
    const overlays = mountOverlays('')
    useInstallationStore().installations = [{ id: BUILD, name: 'Studio' } as Installation]
    useProgressStore().operations.set(BUILD, {
      title: 'Updating ComfyUI - Studio',
      opKind: 'update',
      cancellable: true,
      finished: false,
      cancelRequested: false
    } as Operation)
    overlays.currentOverlay.value = { ...newInstallTakeover, cancelCopyKey: 'discard-setup' }
    modal.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(overlays.answerCloseRequest()).resolves.toEqual({ cleared: false })

    expect(modal.confirm, 'one ask for the dialog, one for the update').toHaveBeenCalledTimes(2)
    expect(api.cancelOperation).not.toHaveBeenCalled()
  })
})
