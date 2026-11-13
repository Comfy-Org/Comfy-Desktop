import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { stubWindowApi } from '../lib/stubWindowApi'
import { useProgressStore } from '../stores/progressStore'
import type { ActionResult, ProgressData } from '../types/ipc'

const modal = vi.hoisted(() => ({ confirm: vi.fn(), alert: vi.fn() }))
vi.mock('../composables/useModal', () => ({ useModal: () => modal }))
vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toErrorBucket: vi.fn()
}))
vi.mock('../components/ui/DesktopDialogSurface.vue', () => ({
  default: {
    props: ['ariaLabel'],
    emits: ['close'],
    template: '<div role="dialog" :aria-label="ariaLabel"><slot /></div>'
  }
}))

import BuildProgressDialog from './BuildProgressDialog.vue'

const ID = 'inst-new'
const STEPS = [
  { phase: 'download', label: 'Download' },
  { phase: 'extract', label: 'Extract' },
  { phase: 'setup', label: 'Set up environment' }
]

let progress: (data: Partial<ProgressData>) => void = () => {}
let output: (text: string) => void = () => {}
let settle: (result: ActionResult) => void = () => {}

beforeEach(() => {
  setActivePinia(createPinia())
  modal.confirm.mockReset()
  stubWindowApi({
    onInstallProgress: vi.fn((cb: (data: ProgressData) => void) => {
      progress = (data) => cb({ installationId: ID, ...data } as ProgressData)
      return () => {}
    }),
    onComfyOutput: vi.fn((cb: (data: { installationId: string; text: string }) => void) => {
      output = (text) => cb({ installationId: ID, text })
      return () => {}
    }),
    onErrorDetail: vi.fn(() => () => {}),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    cancelOperation: vi.fn(async () => {}),
    stopComfyUI: vi.fn(async () => {}),
    getCloudFreeRunsEnabled: vi.fn(async () => true),
    getCloudUserTier: vi.fn(async () => 'free'),
    getInstallations: vi.fn(async () => [{ id: 'cloud', sourceId: 'cloud', name: 'Comfy Cloud' }])
  })
})

async function openDialog() {
  const wrapper = mount(BuildProgressDialog, { props: { installationId: ID } })
  useProgressStore().startOperation({
    installationId: ID,
    title: 'Installing — ComfyUI',
    opKind: 'install',
    apiCall: () =>
      new Promise<ActionResult>((resolve) => {
        settle = resolve
      })
  })
  progress({ phase: 'steps', steps: STEPS })
  progress({ phase: 'download', percent: 63, status: '760 of 1200 MB · about 24s left' })
  output('[setup] Downloading torch-2.7.1 (74 MB)\n')
  await flushPromises()
  return wrapper
}

const stepStates = (w: Awaited<ReturnType<typeof openDialog>>) =>
  w.findAll('[data-testid="build-progress-step"]').map((li) => li.attributes('data-state'))

describe('BuildProgressDialog', () => {
  it('shows the install step by step, with what main last said and the logs', async () => {
    const w = await openDialog()

    expect(w.find('[role="dialog"]').attributes('aria-label')).toBe('Installing ComfyUI')
    expect(stepStates(w)).toEqual(['active', 'pending', 'pending'])
    const active = w.findAll('[data-testid="build-progress-step"]')[0]!
    expect(active.text()).toContain('Download')
    expect(active.text()).toContain('63%')
    expect(active.text()).toContain('760 of 1200 MB · about 24s left')
    expect(w.get('[data-testid="build-progress-logs"]').text()).toContain('Downloading torch')
    expect(w.find('[data-testid="build-progress-try-cloud"]').exists()).toBe(true)

    progress({ phase: 'setup', percent: 10, status: 'Installing requirements…' })
    await flushPromises()
    expect(stepStates(w)).toEqual(['done', 'done', 'active'])
  })

  it('names the failed step and its error, and offers Close instead of Cancel', async () => {
    const w = await openDialog()
    progress({ phase: 'extract', percent: 0 })
    settle({ ok: false, message: 'Extraction failed: disk full' })
    await flushPromises()

    expect(w.find('[role="dialog"]').attributes('aria-label')).toBe("ComfyUI didn't install")
    expect(stepStates(w)).toEqual(['done', 'failed', 'pending'])
    expect(w.get('[data-testid="build-progress-step-detail"]').text()).toBe(
      'Extraction failed: disk full'
    )
    expect(w.find('[data-testid="build-progress-cancel"]').exists()).toBe(false)
    await w.get('[data-testid="build-progress-close-failed"]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('closes on its own when the install finishes', async () => {
    const w = await openDialog()
    settle({ ok: true })
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('cancels the install only after the user confirms', async () => {
    const w = await openDialog()
    modal.confirm.mockResolvedValueOnce(false)
    await w.get('[data-testid="build-progress-cancel"]').trigger('click')
    await flushPromises()
    expect(window.api.cancelOperation).not.toHaveBeenCalled()

    modal.confirm.mockResolvedValueOnce(true)
    await w.get('[data-testid="build-progress-cancel"]').trigger('click')
    await flushPromises()
    expect(window.api.cancelOperation).toHaveBeenCalledWith(ID)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('collapses and reopens the logs', async () => {
    const w = await openDialog()
    const toggle = w.get('[data-testid="build-progress-logs-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    const logs = () => w.get<HTMLElement>('[data-testid="build-progress-logs"]').element.style
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(logs().display).toBe('none')
    await toggle.trigger('click')
    expect(logs().display).toBe('')
  })

  it('plays one of the build videos, filling the slot when tall and spanning it when wide', async () => {
    const w = await openDialog()
    const video = w.get<HTMLVideoElement>('[data-testid="build-progress-video"]')
    expect(video.attributes('src')).toMatch(/^\.\/build-progress\/[a-z_]+\.webm$/)

    const loadAs = async (width: number, height: number): Promise<void> => {
      Object.defineProperty(video.element, 'videoWidth', { configurable: true, value: width })
      Object.defineProperty(video.element, 'videoHeight', { configurable: true, value: height })
      await video.trigger('loadedmetadata')
    }
    await loadAs(480, 640)
    expect(video.attributes('data-shape')).toBe('tall')
    expect(video.classes()).toContain('h-[340px]')

    await loadAs(942, 530)
    expect(video.attributes('data-shape')).toBe('wide')
    expect(video.classes()).toContain('h-auto')

    await loadAs(708, 708)
    expect(video.attributes('data-shape')).toBe('wide')
  })
})
