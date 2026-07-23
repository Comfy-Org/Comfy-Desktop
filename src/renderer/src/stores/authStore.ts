import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type { ElectronApi } from '../../../types/ipc'
import type { AuthStatus } from '../../../main/comfybuilder/types'
import type { Distribution, WorkspaceOption } from '../devplatform/types'
import { MOCK_DISTRIBUTIONS, MOCK_WORKSPACES } from '../devplatform/mocks'

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>({ signedIn: false })
  const distributions = ref<Distribution[]>([])
  const loadingDistributions = ref(false)
  const comfybuilderApi = (window as Window & { api: ElectronApi }).api.comfybuilder

  /** Bumped on every authoritative status change (push, sign-in, sign-out) so
   *  a slower in-flight pull can never overwrite a newer status. */
  let revision = 0

  async function fetchStatus(): Promise<AuthStatus> {
    const seen = revision
    const next = await comfybuilderApi.getAuthStatus()
    if (revision === seen && next) status.value = next
    return next
  }

  /** Run the PKCE browser handoff. Rethrows failures so callers own the
   *  feedback; a completed sign-in also lands via `onAuthChanged`. */
  async function signIn(): Promise<AuthStatus> {
    const next = await comfybuilderApi.signIn()
    revision += 1
    status.value = next
    return next
  }

  async function signOut(): Promise<AuthStatus> {
    await comfybuilderApi.signOut()
    revision += 1
    status.value = { signedIn: false }
    distributions.value = []
    pickedWorkspaceId.value = null
    return status.value
  }

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    revision += 1
    status.value = nextStatus
    if (!nextStatus.signedIn) {
      distributions.value = []
      pickedWorkspaceId.value = null
    }
  })

  // Hydrate from the persisted session once at creation — main only pushes
  // CHANGES, so the boot state has to be pulled. The revision guard keeps
  // this pull from overwriting anything newer.
  void fetchStatus().catch(() => {})

  onScopeDispose(() => {
    unsubscribe?.()
  })

  const isSignedIn = computed(() => status.value.signedIn)

  // --- Workspace switcher (TEMP: display-only mock) ---
  //
  // The real switcher needs list-workspaces + token re-scope endpoints; until
  // they exist the chip offers these fixtures and a selection only changes
  // what the UI displays. The design-team fixture stands in as the current
  // workspace so the mock never shows the token's raw workspace id.
  const workspaces = computed<WorkspaceOption[]>(() => (isSignedIn.value ? MOCK_WORKSPACES : []))

  /** TEMP default: the mock presents the design team as the current workspace,
   *  standing in for the token's real (id-only) claim. */
  const MOCK_CURRENT_WORKSPACE_ID = 'ws-design'
  const pickedWorkspaceId = ref<string | null>(null)

  const selectedWorkspace = computed<WorkspaceOption | null>(() => {
    if (!isSignedIn.value) return null
    const id = pickedWorkspaceId.value ?? MOCK_CURRENT_WORKSPACE_ID
    return workspaces.value.find((ws) => ws.id === id) ?? null
  })

  function selectWorkspace(id: string): void {
    pickedWorkspaceId.value = id
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
    distributions,
    loadingDistributions,
    isSignedIn,
    workspaces,
    selectedWorkspace,
    selectWorkspace,
    fetchStatus,
    signIn,
    signOut,
    fetchDistributions,
  }
})
