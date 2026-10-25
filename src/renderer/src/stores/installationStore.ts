import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Installation } from '../types/ipc'

export const useInstallationStore = defineStore('installation', () => {
  const installations = ref<Installation[]>([])
  const loading = ref(true)

  async function loadInstallations(): Promise<Installation[]> {
    loading.value = true
    try {
      installations.value = await window.api.getInstallations()
      return installations.value
    } finally {
      loading.value = false
    }
  }

  // At most one request in flight plus one queued behind it: a burst of
  // `installations-changed` events collapses into a single follow-up fetch,
  // which still starts after every caller asked, so each caller gets data at
  // least as fresh as its request.
  let inFlight: Promise<Installation[]> | null = null
  let queued: Promise<Installation[]> | null = null

  function fetchInstallations(): Promise<Installation[]> {
    if (!inFlight) {
      inFlight = loadInstallations().finally(() => {
        inFlight = null
      })
      return inFlight
    }
    queued ??= inFlight
      .catch(() => undefined)
      .then(() => {
        queued = null
        return fetchInstallations()
      })
    return queued
  }

  window.api.onInstallationsChanged(() => {
    fetchInstallations()
  })

  window.api.onInstallationsVersionsUpdated((updates) => {
    for (const { id, version } of updates) {
      const inst = installations.value.find((i) => i.id === id)
      if (inst) inst.version = version
    }
  })

  function getById(id: string): Installation | undefined {
    return installations.value.find((i) => i.id === id)
  }

  return {
    installations,
    loading,
    fetchInstallations,
    getById
  }
})
