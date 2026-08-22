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

  it('shows managed Builds during an in-place update transaction', () => {
    expect(
      isInstallationVisibleToRenderer(
        installation({
          status: 'installing',
          comfybuilderRollback: { version: '1', artifactId: 'old-artifact' }
        })
      )
    ).toBe(true)
  })

  it('does not treat rollback-shaped data from another source as a managed update', () => {
    expect(
      isInstallationVisibleToRenderer(
        installation({
          sourceId: 'standalone',
          status: 'installing',
          comfybuilderRollback: { version: '1' }
        })
      )
    ).toBe(false)
  })
})
