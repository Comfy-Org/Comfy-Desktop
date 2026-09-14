/** Stable local identity for the workspace that exists without an account. */
export const PERSONAL_WORKSPACE_ID = 'personal'

/** Persisted dashboard scope used by every New Instance entry point. */
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
