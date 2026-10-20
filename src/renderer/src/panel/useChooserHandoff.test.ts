import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import type { Installation } from '../types/ipc'

const executeAction = vi.hoisted(() =>
  vi.fn(
    async (_inst: unknown, _action: unknown, opts?: { onGuardsPassed?: () => Promise<void> }) => {
      await opts?.onGuardsPassed?.()
    }
  )
)
vi.mock('../composables/useListAction', () => ({
  useListAction: () => ({ executeAction })
}))

import { useChooserHandoff } from './useChooserHandoff'

const api = {
  getListActions: vi.fn(async () => [{ id: 'launch', style: 'primary' }]),
  claimAttachHost: vi.fn(async () => true),
  focusComfyWindow: vi.fn(async () => true),
  transferHostBoundsToInstall: vi.fn(),
  onInstanceStarted: vi.fn(() => () => {}),
  closeHostWindow: vi.fn()
}
Object.defineProperty(window, 'api', { value: api, configurable: true })

const inst = { id: 'a', name: 'Studio' } as Installation

/** The composable registers unmount cleanup, so it runs inside a component. */
function handoff(buildsOpenInOwnWindows: boolean) {
  const switchPanel = vi.fn(async () => {})
  let chooser!: ReturnType<typeof useChooserHandoff>
  mount(
    defineComponent({
      setup() {
        chooser = useChooserHandoff({
          showProgress: vi.fn(async () => {}),
          switchPanel,
          buildsOpenInOwnWindows
        })
        return () => null
      }
    })
  )
  return { ...chooser, switchPanel }
}

describe('useChooserHandoff', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('hands the dashboard window over to the picked build by default', async () => {
    await handoff(false).handleChooserPick(inst)
    expect(executeAction).toHaveBeenCalled()
    expect(api.claimAttachHost).toHaveBeenCalledWith('a')
  })

  it('keeps the dashboard window when builds open in their own windows', async () => {
    await handoff(true).handleChooserPick(inst)
    expect(executeAction).toHaveBeenCalled()
    expect(api.claimAttachHost).not.toHaveBeenCalled()
    expect(api.onInstanceStarted).not.toHaveBeenCalled()
  })

  it('still opens the new-build flow when a build has nothing to launch', async () => {
    api.getListActions.mockResolvedValueOnce([])
    const { handleChooserPick, switchPanel } = handoff(true)
    await handleChooserPick(inst)
    expect(switchPanel).toHaveBeenCalledWith('new-install', 'chooser_pick')
  })
})
