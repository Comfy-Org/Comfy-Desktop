import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { stubWindowApi } from '../lib/stubWindowApi'
import { useProgressStore } from '../stores/progressStore'
import type { ActionResult, Installation, ProgressData } from '../types/ipc'
import { buildLaunchPhases } from '../../../main/lib/launchPhases'
import { createLaunchProgressTracker } from '../../../main/lib/launchProgress'
import { useBuildProgress } from './useBuildProgress'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toErrorBucket: vi.fn()
}))

const BUILD = { id: 'inst-1', name: 'ComfyUI', sourceId: 'standalone' } as Installation

let progress: (data: Partial<ProgressData>) => void = () => {}

const BuildCardLine = defineComponent({
  setup() {
    const { detail } = useBuildProgress(() => BUILD)
    return () => h('p', detail.value)
  }
})

beforeEach(() => {
  setActivePinia(createPinia())
  stubWindowApi({
    onInstallProgress: vi.fn((cb: (data: ProgressData) => void) => {
      progress = (data) => cb({ installationId: BUILD.id, ...data } as ProgressData)
      return () => {}
    }),
    onComfyOutput: vi.fn(() => () => {}),
    onErrorDetail: vi.fn(() => () => {})
  })
})

describe('useBuildProgress', () => {
  it("names the step a starting build is on in words, from main's own launch steps", async () => {
    const line = mount(BuildCardLine)
    useProgressStore().startOperation({
      installationId: BUILD.id,
      title: 'Starting — ComfyUI',
      opKind: 'launch',
      apiCall: () => new Promise<ActionResult>(() => {})
    })
    const tracker = createLaunchProgressTracker({
      phases: buildLaunchPhases(null),
      sendProgress: (phase, detail) => progress({ phase, ...detail } as Partial<ProgressData>)
    })
    tracker.start()
    await flushPromises()
    expect(line.text()).toBe('Start ComfyUI')

    tracker.ingest('Total VRAM 24564 MB, total RAM 65349 MB\n')
    await flushPromises()
    expect(line.text()).toBe('Initialize GPU')
  })
})
