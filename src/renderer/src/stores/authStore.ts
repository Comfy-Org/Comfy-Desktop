import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type { ElectronApi } from '../../../types/ipc'
import type { AuthStatus } from '../../../main/comfybuilder/types'
import type { Distribution } from '../devplatform/types'
import { MOCK_DISTRIBUTIONS } from '../devplatform/mocks'

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
    return status.value
  }

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    revision += 1
    status.value = nextStatus
    if (!nextStatus.signedIn) distributions.value = []
  })

  // Hydrate from the persisted session once at creation — main only pushes
  // CHANGES, so the boot state has to be pulled. The revision guard keeps
  // this pull from overwriting anything newer.
  void fetchStatus().catch(() => {})

  onScopeDispose(() => {
    unsubscribe?.()
  })

  const isSignedIn = computed(() => status.value.signedIn)

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
    fetchStatus,
    signIn,
    signOut,
    fetchDistributions,
  }
})
