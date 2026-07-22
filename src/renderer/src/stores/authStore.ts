import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type { ElectronApi } from '../../../types/ipc'
import type { AuthStatus } from '../../../main/comfybuilder/types'
import type { Distribution, SignInPhase, Workspace } from '../devplatform/types'
import {
  MOCK_AUTH_STATUS,
  MOCK_DISTRIBUTIONS,
  MOCK_SESSION_KEY,
  mockSessionEnabled,
} from '../devplatform/mocks'

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>(mockSessionEnabled() ? MOCK_AUTH_STATUS : { signedIn: false })
  const signInPhase = ref<SignInPhase>('idle')
  const activeWorkspaceId = ref<string | undefined>(undefined)
  const distributions = ref<Distribution[]>([])
  const loadingDistributions = ref(false)
  const comfybuilderApi = (window as Window & { api: ElectronApi }).api.comfybuilder

  /** Bumped on cancel so a late settle of an abandoned sign-in can't move the phase. */
  let signInRun = 0

  async function fetchStatus(): Promise<AuthStatus> {
    if (mockSessionEnabled()) return status.value
    status.value = await comfybuilderApi.getAuthStatus()
    return status.value
  }

  /** Run the PKCE browser handoff. Tracks `signInPhase` alongside the returned
   *  status; rethrows failures so existing callers keep their catch semantics. */
  async function signIn(): Promise<AuthStatus> {
    if (mockSessionEnabled()) {
      status.value = MOCK_AUTH_STATUS
      signInPhase.value = 'success'
      return status.value
    }
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
    if (mockSessionEnabled()) {
      try {
        window.localStorage.removeItem(MOCK_SESSION_KEY)
      } catch {
        // Storage unavailable — the in-memory sign-out below still applies.
      }
    } else {
      await comfybuilderApi.signOut()
    }
    status.value = { signedIn: false }
    signInPhase.value = 'idle'
    activeWorkspaceId.value = undefined
    distributions.value = []
    return status.value
  }

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    status.value = nextStatus
    if (!nextStatus.signedIn) distributions.value = []
  })

  onScopeDispose(() => {
    unsubscribe?.()
  })

  const isSignedIn = computed(() => status.value.signedIn)

  /** The token's single workspace, shaped for the picker. The claims carry no
   *  human workspace name (backend gap): team orgs surface their id, personal
   *  ones the account email. */
  const workspaces = computed<Workspace[]>(() => {
    const s = status.value
    if (!s.signedIn || !s.workspaceId) return []
    const isTeam = s.workspaceType === 'team'
    return [
      {
        id: s.workspaceId,
        name: isTeam ? s.workspaceId : (s.email ?? s.workspaceId),
        type: isTeam ? 'team' : 'personal',
        role: s.role === 'member' ? 'member' : 'owner',
      },
    ]
  })

  /** A single workspace is not a choice — the picker only renders for 2+. */
  const needsWorkspaceChoice = computed(() => workspaces.value.length > 1)

  const activeWorkspace = computed<Workspace | undefined>(() =>
    workspaces.value.find((w) => w.id === activeWorkspaceId.value) ?? workspaces.value[0]
  )

  function selectWorkspace(id: string): void {
    activeWorkspaceId.value = id
  }

  /** TEMP: served from fixtures until the builder pipeline list is exposed
   *  over IPC — see `devplatform/mocks.ts`. */
  async function fetchDistributions(): Promise<Distribution[]> {
    if (!isSignedIn.value) {
      distributions.value = []
      return distributions.value
    }
    loadingDistributions.value = true
    try {
      distributions.value = MOCK_DISTRIBUTIONS
      return distributions.value
    } finally {
      loadingDistributions.value = false
    }
  }

  return {
    status,
    signInPhase,
    activeWorkspaceId,
    distributions,
    loadingDistributions,
    isSignedIn,
    workspaces,
    needsWorkspaceChoice,
    activeWorkspace,
    fetchStatus,
    signIn,
    cancelSignIn,
    signOut,
    selectWorkspace,
    fetchDistributions,
  }
})
