import { describe, expect, it } from 'vitest'
import { installationWorkspaceId, isInstallationInWorkspace } from './workspaces'

describe('installation workspace scope', () => {
  const cloud = { sourceId: 'cloud' }

  it.each(['personal', 'team-a', 'team-b'])(
    'makes the shared Cloud installation available in %s',
    (workspaceId) => {
      expect(isInstallationInWorkspace(cloud, workspaceId)).toBe(true)
      expect(installationWorkspaceId(cloud, workspaceId)).toBe(workspaceId)
    }
  )

  it.each(['standalone', 'comfybuilder', 'remote'])(
    'keeps unassigned %s installations in Personal',
    (sourceId) => {
      expect(isInstallationInWorkspace({ sourceId }, 'personal')).toBe(true)
      expect(isInstallationInWorkspace({ sourceId }, 'team-a')).toBe(false)
    }
  )

  it.each(['standalone', 'comfybuilder', 'remote', 'cloud'])(
    'preserves explicit workspace ownership for %s installations',
    (sourceId) => {
      const installation = { sourceId, workspaceId: 'team-a' }
      expect(isInstallationInWorkspace(installation, 'team-a')).toBe(true)
      expect(isInstallationInWorkspace(installation, 'team-b')).toBe(false)
      expect(isInstallationInWorkspace(installation, 'personal')).toBe(false)
      expect(installationWorkspaceId(installation, 'team-b')).toBe('team-a')
    }
  )
})
