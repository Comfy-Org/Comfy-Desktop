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
