export const PERSONAL_WORKSPACE_ID = 'personal'

export const DASHBOARD_WORKSPACE_SETTING = 'dashboardWorkspaceId'

export function isPersonalWorkspace(workspace: { name?: string; type?: string }): boolean {
  return (
    workspace.type === 'personal' || workspace.name?.trim().toLowerCase() === 'personal workspace'
  )
}

export function workspaceScopeId(workspace: { id: string; name?: string; type?: string }): string {
  return isPersonalWorkspace(workspace) ? PERSONAL_WORKSPACE_ID : workspace.id
}

export function workspaceContextId(workspace: {
  workspaceId?: string
  workspaceName?: string
  workspaceType?: string
}): string {
  return isPersonalWorkspace({ name: workspace.workspaceName, type: workspace.workspaceType })
    ? PERSONAL_WORKSPACE_ID
    : workspace.workspaceId || PERSONAL_WORKSPACE_ID
}

interface WorkspaceInstallation {
  workspaceId?: string
  sourceId?: unknown
}

export function installationWorkspaceId(
  installation: WorkspaceInstallation,
  selectedWorkspaceId = PERSONAL_WORKSPACE_ID
): string {
  if (installation.sourceId === 'cloud' && installation.workspaceId === undefined) {
    return selectedWorkspaceId
  }
  return installation.workspaceId === undefined ? PERSONAL_WORKSPACE_ID : installation.workspaceId
}

export function isInstallationInWorkspace(
  installation: WorkspaceInstallation,
  workspaceId: string
): boolean {
  return installationWorkspaceId(installation, workspaceId) === workspaceId
}
