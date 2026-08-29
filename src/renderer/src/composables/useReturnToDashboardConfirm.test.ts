import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const mockConfirm = vi.fn()
vi.mock('./useModal', () => ({
  useModal: () => ({
    confirm: mockConfirm
  })
}))

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
  })

  it('prompts confirmation for local installs', async () => {
    mockConfirm.mockResolvedValue(true)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    const result = await confirmReturnToDashboard(makeInstallation(), 'running')

    expect(mockConfirm).toHaveBeenCalledWith({
      title: 'dashboard.confirmStopLocal.title',
      message: 'dashboard.confirmStopLocal.message',
      confirmLabel: 'dashboard.confirmStopLocal.confirmLabel',
      confirmStyle: 'danger'
    })
    expect(result).toBe(true)
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
      title: 'overlay.cancelCurrentTitle',
      message: 'overlay.cancelMessage',
      confirmLabel: 'overlay.cancelConfirm',
      confirmStyle: 'danger'
    })
    expect(result).toBe(true)
  })

  it('prompts for in-flight ops even when the installation record is unavailable or non-local', async () => {
    mockConfirm.mockResolvedValue(false)
    const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

    // An install in progress has status 'installing' and is hidden from the
    // renderer list, so the record lookup resolves to null.
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
