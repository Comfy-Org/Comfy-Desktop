import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type { ElectronApi } from '../../../types/ipc'
import type { AuthStatus } from '../../../main/comfybuilder/types'

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>({ signedIn: false })
  const comfybuilderApi = (window as Window & { api: ElectronApi }).api.comfybuilder

  async function fetchStatus(): Promise<AuthStatus> {
    status.value = await comfybuilderApi.getAuthStatus()
    return status.value
  }

  /** Run the PKCE browser handoff. Rethrows failures so callers own the
   *  feedback; a completed sign-in also lands via `onAuthChanged`. */
  async function signIn(): Promise<AuthStatus> {
    const next = await comfybuilderApi.signIn()
    status.value = next
    return next
  }

  async function signOut(): Promise<AuthStatus> {
    await comfybuilderApi.signOut()
    status.value = { signedIn: false }
    return status.value
  }

  /** True once a pushed status has landed — a slower boot-time pull must
   *  never overwrite it. */
  let pushed = false

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    pushed = true
    status.value = nextStatus
  })

  // Hydrate from the persisted session once at creation — main only pushes
  // CHANGES, so the boot state has to be pulled.
  void Promise.resolve(comfybuilderApi.getAuthStatus())
    .then((next) => {
      if (!pushed && next) status.value = next
    })
    .catch(() => {})

  onScopeDispose(() => {
    unsubscribe?.()
  })

  const isSignedIn = computed(() => status.value.signedIn)

  return {
    status,
    isSignedIn,
    fetchStatus,
    signIn,
    signOut,
  }
})
