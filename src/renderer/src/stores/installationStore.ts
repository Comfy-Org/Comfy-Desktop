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
