export interface AuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

export interface AuthStatus {
  signedIn: boolean
  email?: string
  workspaceId?: string
  workspaceType?: string
  role?: string
}
