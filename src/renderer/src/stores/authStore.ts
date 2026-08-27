import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type { AuthStatus, ElectronApi, Workspace } from '../../../types/ipc'
import type { Build } from '../devplatform/types'

/**
 * Dev-platform session store: the renderer's single source of auth + workspace
 * + build state.
 *
 * It only ever holds renderer-safe data (AuthStatus / Workspace / build
 * display rows); tokens live in the main process. Every mutation goes through
 * `window.api.comfybuilder`, and `onAuthChanged` keeps the store in lockstep
 * with a sign-in / switch / sign-out that originated anywhere.
 */
export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>({ signedIn: false })
  const workspaces = ref<Workspace[]>([])
  const builds = ref<Build[]>([])
  const loadingWorkspaces = ref(false)
  const loadingBuilds = ref(false)
  /** Distinguishes a successfully loaded empty catalog from one not fetched yet. */
  const buildsLoaded = ref(false)
  // Load-failure flags so the UI can tell a transient error apart from an empty
  // workspace (both otherwise leave the arrays empty).
  const workspacesError = ref(false)
  const buildsError = ref(false)
  const comfybuilderApi = (window as Window & { api: ElectronApi }).api.comfybuilder

  /** Bumped on every authoritative status change (push, sign-in, switch,
   *  sign-out) so a slower in-flight pull can never overwrite a newer status. */
  let revision = 0

  /** Advance the revision on an authoritative status change. Every in-flight
   *  fetch becomes stale, and a stale fetch's guarded `finally` refuses to
   *  touch the shared flags - so reset them here, otherwise a transition with
   *  no follow-up fetch (e.g. sign-out) would leave loading stuck on. */
  function advanceRevision(): void {
    revision += 1
    loadingWorkspaces.value = false
    loadingBuilds.value = false
    workspacesError.value = false
    buildsError.value = false
  }

  /** The session identity the scoped caches are keyed on. */
  function sameIdentity(a: AuthStatus, b: AuthStatus): boolean {
    return a.signedIn === b.signedIn && a.workspaceId === b.workspaceId
  }

  /** Apply an authoritative status (push, sign-in, switch, sign-out result).
   *  A sign-in/switch lands twice - main pushes `onAuthChanged` AND the invoke
   *  resolves with the same status - so only an identity CHANGE invalidates
   *  in-flight fetches and scoped caches. The duplicate arrival (either order)
   *  must not advance the revision: it would discard the sole fetch the first
   *  arrival triggered, and no watcher re-fires for an unchanged identity,
   *  leaving the UI showing a false empty workspace. */
  function applyAuthoritativeStatus(next: AuthStatus): void {
    if (sameIdentity(status.value, next)) {
      status.value = next
      return
    }
    advanceRevision()
    status.value = next
    if (!next.signedIn) resetScopedState()
    else {
      builds.value = []
      buildsLoaded.value = false
    }
  }

  /** Drop workspace-scoped caches: the list and the builds both belong
   *  to the token's single workspace, so a switch/sign-out invalidates them. */
  function resetScopedState(): void {
    workspaces.value = []
    builds.value = []
    buildsLoaded.value = false
  }

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
    applyAuthoritativeStatus(next)
    return next
  }

  async function signOut(): Promise<AuthStatus> {
    await comfybuilderApi.signOut()
    applyAuthoritativeStatus({ signedIn: false })
    return status.value
  }

  /** The workspaces the signed-in user belongs to (for the switcher). */
  async function fetchWorkspaces(): Promise<Workspace[]> {
    if (!status.value.signedIn) {
      workspaces.value = []
      return workspaces.value
    }
    const seen = revision
    loadingWorkspaces.value = true
    if (revision === seen) workspacesError.value = false
    try {
      const next = await comfybuilderApi.listWorkspaces()
      if (revision === seen) {
        workspaces.value = next
        const current = next.find((workspace) => workspace.id === status.value.workspaceId)
        status.value = { ...status.value, workspaceName: current?.name }
      }
      return workspaces.value
    } catch {
      if (revision === seen) workspacesError.value = true
      return workspaces.value
    } finally {
      if (revision === seen) loadingWorkspaces.value = false
    }
  }

  /** Activate the workspace for remote operations. Main uses cached credentials
   *  when available and opens browser auth only when authorization is needed. */
  async function switchWorkspace(workspaceId: string): Promise<AuthStatus> {
    const next = await comfybuilderApi.switchWorkspace(workspaceId)
    applyAuthoritativeStatus(next)
    return next
  }

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    applyAuthoritativeStatus(nextStatus)
  })

  // Hydrate from the persisted session once at creation: main only pushes
  // CHANGES, so the boot state has to be pulled. The revision guard keeps
  // this pull from overwriting anything newer.
  void fetchStatus().catch(() => {})

  onScopeDispose(() => {
    unsubscribe?.()
  })

  const isSignedIn = computed(() => status.value.signedIn)

  /** The builds published to the signed-in workspace, as display rows. */
  async function fetchBuilds(): Promise<Build[]> {
    if (!isSignedIn.value) {
      builds.value = []
      buildsLoaded.value = false
      return builds.value
    }
    const seen = revision
    loadingBuilds.value = true
    if (revision === seen) buildsError.value = false
    try {
      const next = await comfybuilderApi.listBuilds()
      if (revision === seen) {
        builds.value = next
        buildsLoaded.value = true
      }
      return builds.value
    } catch {
      if (revision === seen) buildsError.value = true
      return builds.value
    } finally {
      if (revision === seen) loadingBuilds.value = false
    }
  }

  return {
    status,
    workspaces,
    builds,
    loadingWorkspaces,
    loadingBuilds,
    buildsLoaded,
    workspacesError,
    buildsError,
    isSignedIn,
    fetchStatus,
    signIn,
    signOut,
    fetchWorkspaces,
    switchWorkspace,
    fetchBuilds
  }
})
