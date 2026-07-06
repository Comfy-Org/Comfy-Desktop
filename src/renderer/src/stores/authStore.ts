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

  async function signIn(): Promise<AuthStatus> {
    return comfybuilderApi.signIn()
  }

  async function signOut(): Promise<AuthStatus> {
    return comfybuilderApi.signOut()
  }

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    status.value = nextStatus
  })

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
