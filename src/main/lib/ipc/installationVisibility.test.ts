// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { InstallationRecord } from '../../installations'
import { isInstallationVisibleToRenderer } from './installationVisibility'

function installation(overrides: Partial<InstallationRecord>): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'Test',
    sourceId: 'comfybuilder',
    installPath: '/installs/test',
    status: 'installed',
    ...overrides
  } as InstallationRecord
}

describe('isInstallationVisibleToRenderer', () => {
  it('shows ready installations', () => {
    expect(isInstallationVisibleToRenderer(installation({}))).toBe(true)
  })

  it('hides fresh incomplete installations', () => {
    expect(isInstallationVisibleToRenderer(installation({ status: 'installing' }))).toBe(false)
  })

  it('shows installs during an in-place update transaction', () => {
    expect(isInstallationVisibleToRenderer(installation({ status: 'updating' }))).toBe(true)
  })

  it('shows failed installations so the user can act on them', () => {
    expect(isInstallationVisibleToRenderer(installation({ status: 'failed' }))).toBe(true)
  })
})
