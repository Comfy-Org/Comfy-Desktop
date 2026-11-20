import { createTestingPinia } from '@pinia/testing'
import { stubWindowApi } from '../lib/stubWindowApi'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', async (importOriginal) =>
  (await import('../lib/vueI18nWithAppMessages')).vueI18nWithAppMessages(importOriginal)
)

const mockConfirm = vi.fn()
vi.mock('./useModal', () => ({
  useModal: () => ({
    confirm: mockConfirm
  })
}))

const getSetting = vi.fn()
stubWindowApi({ getSetting })

import { useReturnToDashboardConfirm } from './useReturnToDashboardConfirm'
import type { Installation } from '../types/ipc'

function makeInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-1',
    name: 'Test Install',
    sourceLabel: 'standalone',
    sourceCategory: 'local',
    ...overrides
  }
}

describe('useReturnToDashboardConfirm', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    vi.clearAllMocks()
    getSetting.mockResolvedValue(undefined)
  })

  it('prompts confirmation for local installs when the setting is off', async () => {
    getSetting.mockResolvedValue(false)
    mockConfirm.mockResolvedValue(true)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(makeInstallation(), 'running')

    expect(mockConfirm).toHaveBeenCalledWith({
      title: 'Back to Home?',
      message: 'This will stop the current ComfyUI.',
      confirmLabel: 'Back to Home',
      confirmStyle: 'danger'
    })
    expect(result).toBe(true)
    expect(getSetting).toHaveBeenCalledWith('keepComfyRunningWhenWindowCloses')
  })

  it('does not ask for a running local install when the setting is absent', async () => {
    mockConfirm.mockResolvedValue(false)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(makeInstallation(), 'running')

    expect(getSetting).toHaveBeenCalledWith('keepComfyRunningWhenWindowCloses')
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('does not ask for a running local install when the setting cannot be read', async () => {
    getSetting.mockRejectedValue(new Error('settings unavailable'))
    mockConfirm.mockResolvedValue(false)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(makeInstallation(), 'running')

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('does not ask for a running local install when the setting is on', async () => {
    getSetting.mockResolvedValue(true)
    mockConfirm.mockResolvedValue(false)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(makeInstallation(), 'running')

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('still asks before cancelling an in-flight op when ComfyUI keeps running with the window closed', async () => {
    mockConfirm.mockResolvedValue(false)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    expect(await confirmReturnToDashboard(makeInstallation(), 'in_flight')).toBe(false)
    expect(mockConfirm).toHaveBeenCalledTimes(1)
  })

  it('returns false when the user cancels for local installs', async () => {
    mockConfirm.mockResolvedValue(false)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(makeInstallation(), 'in_flight')

    expect(result).toBe(false)
  })

  it('prompts the cancel-operation confirm for in-flight ops', async () => {
    mockConfirm.mockResolvedValue(true)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(makeInstallation(), 'in_flight')

    expect(mockConfirm).toHaveBeenCalledWith({
      title: 'Cancel current operation?',
      message:
        'The operation will stop where it is. Anything not yet completed will be rolled back where possible.',
      confirmLabel: 'Cancel operation',
      confirmStyle: 'danger'
    })
    expect(result).toBe(true)
  })

  it('prompts for in-flight ops even when the installation record is unavailable or non-local', async () => {
    mockConfirm.mockResolvedValue(false)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    expect(await confirmReturnToDashboard(null, 'in_flight')).toBe(false)
    expect(
      await confirmReturnToDashboard(makeInstallation({ sourceCategory: 'cloud' }), 'in_flight')
    ).toBe(false)
    expect(mockConfirm).toHaveBeenCalledTimes(2)
  })

  it('skips confirmation for cloud installs', async () => {
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(
      makeInstallation({ sourceCategory: 'cloud' }),
      'running'
    )

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('skips confirmation for remote installs', async () => {
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(
      makeInstallation({ sourceCategory: 'remote' }),
      'crashed'
    )

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('skips confirmation for local installs in stopped / crashed states (nothing to stop)', async () => {
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    expect(await confirmReturnToDashboard(makeInstallation(), 'stopped')).toBe(true)
    expect(await confirmReturnToDashboard(makeInstallation(), 'crashed')).toBe(true)
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('skips confirmation for null/undefined installation (defensive)', async () => {
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    expect(await confirmReturnToDashboard(null, 'stopped')).toBe(true)
    expect(await confirmReturnToDashboard(undefined, 'stopped')).toBe(true)
    expect(mockConfirm).not.toHaveBeenCalled()
  })
})
