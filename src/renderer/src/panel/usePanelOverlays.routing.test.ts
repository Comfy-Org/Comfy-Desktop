import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { usePanelOverlays } from './usePanelOverlays'
import { useProgressStore } from '../stores/progressStore'

vi.mock('../stores/dashboardScopeStore', () => ({ useDashboardScopeStore: () => ({}) }))

describe('where a task on a build shows its progress', () => {
  const BUILD = 'studio'
  const api = {
    setFirstUseMode: vi.fn(),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    onInstallProgress: vi.fn(() => () => {}),
    onComfyOutput: vi.fn(() => () => {}),
    closeCurrentPanel: vi.fn(),
    getSetting: vi.fn().mockResolvedValue(undefined)
  }

  function overlaysIn(
    windowInstallationId: string,
    forcesTakeover = false
  ): ReturnType<typeof usePanelOverlays> {
    let overlays!: ReturnType<typeof usePanelOverlays>
    mount(
      defineComponent({
        setup() {
          overlays = usePanelOverlays({
            installationId: windowInstallationId,
            progressRef: ref(null),
            newInstallRef: ref(null),
            trackRef: ref(null),
            loadSnapshotRef: ref(null),
            quickInstallRef: ref(null),
            firstUseRef: ref(null),
            firstUseChain: {
              shouldForceTakeover: () => forcesTakeover,
              onShowProgress: () => {},
              onBackgroundInstall: () => {},
              consumeSetupHandoff: () => null
            }
          })
          return () => h('div')
        }
      })
    )
    overlays.currentOverlay.value = null
    return overlays
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { api: typeof api }).api = api
    for (const fn of Object.values(api)) fn.mockClear()
  })

  it.each([
    { opKind: 'update' as const, actionId: 'update-comfyui', title: 'Updating - Studio' },
    { opKind: 'generic' as const, actionId: 'git-pull', title: 'Pulling changes - Studio' }
  ])(
    'a ComfyUI window runs $actionId once itself and shows its progress there',
    async ({ opKind, actionId, title }) => {
      const overlays = overlaysIn(BUILD)
      const apiCall = vi.fn(() => new Promise<never>(() => {}))

      await overlays.handleShowProgress({
        installationId: BUILD,
        title,
        apiCall,
        cancellable: true,
        opKind,
        actionId
      })

      expect(apiCall).toHaveBeenCalledOnce()
      expect(overlays.currentOverlay.value).toMatchObject({ kind: 'takeover', component: 'update' })
      expect(useProgressStore().operations.get(BUILD)?.finished).toBe(false)
    }
  )

  it('a ComfyUI window still shows its own start in place', async () => {
    const overlays = overlaysIn(BUILD)

    await overlays.handleShowProgress({
      installationId: BUILD,
      title: 'Starting - Studio',
      apiCall: () => new Promise(() => {}),
      opKind: 'launch',
      actionId: 'launch'
    })

    expect(overlays.currentOverlay.value?.kind).toBe('takeover')
  })

  it('the Desktop window runs a task on the build, with no full-screen page', async () => {
    const overlays = overlaysIn('')

    await overlays.handleShowProgress({
      installationId: BUILD,
      title: 'Pulling changes - Studio',
      apiCall: () => new Promise(() => {}),
      opKind: 'generic',
      actionId: 'git-pull'
    })

    expect(overlays.currentOverlay.value).toBeNull()
    expect(useProgressStore().operations.get(BUILD)?.finished).toBe(false)
  })

  it('onboarding keeps its full-screen progress for moving an old Desktop install', async () => {
    const overlays = overlaysIn('', true)

    await overlays.handleShowProgress({
      installationId: BUILD,
      title: 'Migrating - Studio',
      apiCall: () => new Promise(() => {}),
      cancellable: true
    })

    expect(overlays.currentOverlay.value).toMatchObject({ kind: 'takeover', component: 'update' })
  })
})
