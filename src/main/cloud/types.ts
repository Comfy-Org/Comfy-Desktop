export interface AuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

export interface AuthStatus {
  signedIn: boolean
  email?: string
  workspaceId?: string
  workspaceName?: string
  workspaceType?: string
  role?: string
}

export type WorkspaceSwitchFailure = 'unavailable' | 'retryable'

export type WorkspaceSwitchIntent = 'chosen' | 'restored'

export interface WorkspaceSwitchStatus extends AuthStatus {
  workspaceSwitchFailure?: WorkspaceSwitchFailure
}

export interface Workspace {
  id: string
  name: string
  type: string
  role: string
  subscriptionTier?: string
  createdAt?: string
  joinedAt?: string
}

export interface WorkspaceMember {
  id: string
  name?: string
  email?: string
  role?: string
  joinedAt?: string
  isOriginalOwner?: boolean
}
