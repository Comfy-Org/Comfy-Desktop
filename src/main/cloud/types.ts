/**
 * Cloud (ingest) auth + workspace library - domain types.
 *
 * The auth spine here is a clean, UI-agnostic adaptation of the PKCE flow proven
 * in the desktop-builder auth work; this library owns it as functionality (no
 * IPC/Vue) and adds the workspace half. It pairs with the comfy-builder client:
 * `CloudSession` exposes a `TokenProvider` that client consumes.
 */

/** OAuth tokens held in the (main-process only) token store. */
export interface AuthTokens {
  accessToken: string
  refreshToken?: string
  /** Epoch ms when the access token expires. */
  expiresAt: number
}

/** Renderer-safe signed-in status (never carries a token). */
export interface AuthStatus {
  signedIn: boolean
  email?: string
  workspaceId?: string
  workspaceType?: string
  role?: string
}

/** One workspace the signed-in user belongs to (GET /api/workspaces). */
export interface Workspace {
  id: string
  name: string
  type: string
  role: string
  subscriptionTier?: string
  createdAt?: string
  joinedAt?: string
}

/** One member of the active workspace (GET /api/workspace/members). */
export interface WorkspaceMember {
  id: string
  name?: string
  email?: string
  role?: string
  joinedAt?: string
  isOriginalOwner?: boolean
}
