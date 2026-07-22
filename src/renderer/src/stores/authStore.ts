import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type { ElectronApi } from '../../../types/ipc'
import type { AuthStatus } from '../../../main/comfybuilder/types'

/** Phases of the system-browser sign-in handoff. */
export type SignInPhase = 'idle' | 'waiting-for-browser' | 'success' | 'timeout' | 'error'

/** A workspace, derived from the access-token claims. One token carries one workspace. */
export interface Workspace {
  id: string
  name: string
  type: 'personal' | 'team'
  role: 'owner' | 'member'
}

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>({ signedIn: false })
  const signInPhase = ref<SignInPhase>('idle')
  const activeWorkspaceId = ref<string | undefined>(undefined)
  const comfybuilderApi = (window as Window & { api: ElectronApi }).api.comfybuilder

  /** Bumped on cancel so a late settle of an abandoned sign-in can't move the phase. */
  let signInRun = 0

  async function fetchStatus(): Promise<AuthStatus> {
    status.value = await comfybuilderApi.getAuthStatus()
    return status.value
  }

  /** Run the PKCE browser handoff. Tracks `signInPhase` alongside the returned
   *  status; rethrows failures so existing callers keep their catch semantics. */
  async function signIn(): Promise<AuthStatus> {
    const run = ++signInRun
    signInPhase.value = 'waiting-for-browser'
    try {
      const next = await comfybuilderApi.signIn()
      if (run === signInRun) {
        status.value = next
        signInPhase.value = next.signedIn ? 'success' : 'error'
      }
      return next
    } catch (e) {
      if (run === signInRun) {
        // The loopback listener rejects with "…timed out" when the browser never calls back.
        const message = e instanceof Error ? e.message : String(e)
        signInPhase.value = /timed out/i.test(message) ? 'timeout' : 'error'
      }
      throw e
    }
  }

  /** UI-side cancel. The main-process wait can't be aborted, so its eventual
   *  settle is ignored via the run counter; a completed sign-in still lands
   *  through the `onAuthChanged` broadcast. */
  function cancelSignIn(): void {
    signInRun++
    signInPhase.value = 'idle'
  }

  async function signOut(): Promise<AuthStatus> {
    const next = await comfybuilderApi.signOut()
    status.value = next
    signInPhase.value = 'idle'
    activeWorkspaceId.value = undefined
    return next
  }

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    status.value = nextStatus
  })

  onScopeDispose(() => {
    unsubscribe?.()
  })

  const isSignedIn = computed(() => status.value.signedIn)

  /** The token's single workspace, shaped for the picker. The claims carry no
   *  human workspace name (backend gap), so the account email stands in. */
  const workspaces = computed<Workspace[]>(() => {
    const s = status.value
    if (!s.signedIn || !s.workspaceId) return []
    return [
      {
        id: s.workspaceId,
        name: s.email ?? s.workspaceId,
        type: s.workspaceType === 'team' ? 'team' : 'personal',
        role: s.role === 'member' ? 'member' : 'owner',
      },
    ]
  })

  /** A single workspace is not a choice — the picker only renders for 2+. */
  const needsWorkspaceChoice = computed(() => workspaces.value.length > 1)

  function selectWorkspace(id: string): void {
    activeWorkspaceId.value = id
  }

  return {
    status,
    signInPhase,
    activeWorkspaceId,
    isSignedIn,
    workspaces,
    needsWorkspaceChoice,
    fetchStatus,
    signIn,
    cancelSignIn,
    signOut,
    selectWorkspace,
  }
})
