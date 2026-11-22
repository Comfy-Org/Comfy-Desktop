import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import type { Installation } from '../../types/ipc'

const modal = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  alert: vi.fn()
}))

vi.mock('../../composables/useModal', () => ({ useModal: () => modal }))

const { provideBuildMenuHost, useRestartBuild } = await import('./useBuildMenu')

const BUILD = { id: 'inst-1', name: 'ComfyUI' } as Installation

function mountRestart(launch: (build: Installation) => void) {
  let restart!: (inst: Installation) => Promise<void>
  const UsesRestart = () => {
    restart = useRestartBuild()
    return null
  }
  mount(
    defineComponent({
      setup() {
        provideBuildMenuHost({ launch, openDetails: vi.fn(), showProgress: vi.fn() })
        return () => h(UsesRestart)
      }
    })
  )
  return restart
}

beforeEach(() => {
  setActivePinia(createPinia())
  modal.confirm.mockReset()
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    stopComfyUI: vi.fn().mockResolvedValue(undefined)
  }
})

describe('useRestartBuild', () => {
  it('runs one restart per build when Restart is pressed again before the first finishes', async () => {
    let answer!: (confirmed: boolean) => void
    modal.confirm.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const launch = vi.fn()
    const restart = mountRestart(launch)

    const first = restart(BUILD)
    const second = restart(BUILD)
    answer(true)
    await Promise.all([first, second])
    await flushPromises()

    expect(modal.confirm, 'asked once').toHaveBeenCalledTimes(1)
    expect(window.api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledWith(BUILD, { isRestart: true })
  })

  it('restarts the same build again once the earlier restart has finished', async () => {
    modal.confirm.mockResolvedValue(true)
    const launch = vi.fn()
    const restart = mountRestart(launch)

    await restart(BUILD)
    await restart(BUILD)

    expect(launch).toHaveBeenCalledTimes(2)
  })
})
