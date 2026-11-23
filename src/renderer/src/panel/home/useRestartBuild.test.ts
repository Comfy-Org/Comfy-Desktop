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
  modal.alert.mockReset()
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    stopComfyUI: vi.fn().mockResolvedValue(undefined)
  }
})

describe('useRestartBuild', () => {
  it('stops and launches a build once when Restart is confirmed twice before the first finishes', async () => {
    modal.confirm.mockResolvedValue(true)
    let stopped!: () => void
    vi.mocked(window.api.stopComfyUI).mockReturnValueOnce(
      new Promise<void>((resolve) => (stopped = resolve))
    )
    const launch = vi.fn()
    const restart = mountRestart(launch)

    const first = restart(BUILD)
    await flushPromises()
    const second = restart(BUILD)
    await flushPromises()
    stopped()
    await Promise.all([first, second])
    await flushPromises()

    expect(window.api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledWith(BUILD, { isRestart: true })
  })

  it('still restarts a build whose earlier confirm was replaced by another dialog and never answered', async () => {
    modal.confirm.mockReturnValueOnce(new Promise<boolean>(() => {}))
    modal.confirm.mockResolvedValue(true)
    const launch = vi.fn()
    const restart = mountRestart(launch)

    void restart(BUILD)
    await restart(BUILD)

    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('frees the build for another restart after its stop fails', async () => {
    modal.confirm.mockResolvedValue(true)
    vi.mocked(window.api.stopComfyUI).mockRejectedValueOnce(new Error('stop failed'))
    const launch = vi.fn()
    const restart = mountRestart(launch)

    await restart(BUILD)
    await restart(BUILD)

    expect(modal.alert).toHaveBeenCalledWith(expect.objectContaining({ message: 'stop failed' }))
    expect(launch).toHaveBeenCalledTimes(1)
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
