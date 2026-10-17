import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import type { Component } from 'vue'
import { useCloudTier } from './useCloudTier'
import type { CloudUserTier } from '../types/ipc'

function mountTier(freeRuns: boolean, tier: CloudUserTier) {
  vi.stubGlobal('window', {
    ...window,
    api: {
      getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(freeRuns),
      getCloudUserTier: vi.fn().mockResolvedValue(tier)
    }
  })
  let state!: ReturnType<typeof useCloudTier>
  const Host: Component = {
    setup() {
      state = useCloudTier()
      return () => h('div')
    }
  }
  mount(Host)
  return () => state
}

describe('useCloudTier', () => {
  it('advertises Cloud to users who do not pay yet', async () => {
    const state = mountTier(true, 'free')
    await flushPromises()
    expect(state().showCloudFreeRunsPill.value).toBe(true)
    expect(state().showWhyCloud.value).toBe(true)
  })

  it('hides the pill and Why try Cloud from paying users', async () => {
    const state = mountTier(true, 'paid')
    await flushPromises()
    expect(state().showCloudFreeRunsPill.value).toBe(false)
    expect(state().showWhyCloud.value).toBe(false)
  })
})
