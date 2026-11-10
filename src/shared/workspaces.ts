export const PERSONAL_WORKSPACE_ID = 'personal'

export const DASHBOARD_WORKSPACE_SETTING = 'dashboardWorkspaceId'

export function isPersonalWorkspace(workspace: { name?: string; type?: string }): boolean {
  return (
    workspace.type === 'personal' || workspace.name?.trim().toLowerCase() === 'personal workspace'
  )
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

export function installationWorkspaceId(installation: { workspaceId?: string }): string {
  return installation.workspaceId === undefined ? PERSONAL_WORKSPACE_ID : installation.workspaceId
}

export function isInstallationInWorkspace(
  installation: { workspaceId?: string },
  workspaceId: string
): boolean {
  return installationWorkspaceId(installation) === workspaceId
}
