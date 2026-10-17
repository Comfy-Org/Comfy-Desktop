import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePickInstall } from './usePickInstall'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

const focusComfyWindow = vi.fn<(id: string) => Promise<boolean>>()
vi.stubGlobal('window', { ...window, api: { focusComfyWindow } })

const inst = { id: 'a', name: 'Alpha' } as Installation

describe('usePickInstall', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    focusComfyWindow.mockReset()
  })

  it('hands a stopped install to the pick handler', async () => {
    const onPick = vi.fn()
    await usePickInstall(onPick).pickInstall(inst)
    expect(focusComfyWindow).not.toHaveBeenCalled()
    expect(onPick).toHaveBeenCalledWith(inst)
  })

  it('focuses the window of a running install instead of launching again', async () => {
    useSessionStore().runningInstances.set('a', { installationId: 'a' } as never)
    focusComfyWindow.mockResolvedValue(true)
    const onPick = vi.fn()
    await usePickInstall(onPick).pickInstall(inst)
    expect(focusComfyWindow).toHaveBeenCalledWith('a')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('launches when a crashed install has no window left to focus', async () => {
    useSessionStore().errorInstances.set('a', { installationId: 'a' } as never)
    focusComfyWindow.mockResolvedValue(false)
    const onPick = vi.fn()
    await usePickInstall(onPick).pickInstall(inst)
    expect(onPick).toHaveBeenCalledWith(inst)
  })
})
