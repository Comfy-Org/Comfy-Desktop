import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { stubWindowApi } from '../lib/stubWindowApi'
import { useProgressStore } from '../stores/progressStore'
import type { ActionResult, ProgressData } from '../types/ipc'
import {
  AGENT_REQUIREMENTS_PHASE,
  FRONTEND_RESTORE_PHASE,
  buildLaunchPhases
} from '../../../main/lib/launchPhases'
import { createLaunchProgressTracker } from '../../../main/lib/launchProgress'

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

async function openDialog(opKind: 'install' | 'launch' = 'install') {
  const wrapper = mount(BuildProgressDialog, { props: { installationId: ID } })
  useProgressStore().startOperation({
    installationId: ID,
    title: 'Installing — ComfyUI',
    opKind,
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

type Dialog = Awaited<ReturnType<typeof openDialog>>

const stepStates = (w: Dialog) =>
  w.findAll('[data-testid="build-progress-step"]').map((li) => li.attributes('data-state'))

const stepNames = (w: Dialog) =>
  w.findAll('[data-testid="build-progress-step-name"]').map((el) => el.text())

const activeStepDetail = (w: Dialog) => w.get('[data-testid="build-progress-step-detail"]').text()

function startLikeMain() {
  const phases = buildLaunchPhases(null, { preLaunchPhases: ['repair', 'torchRepair'] })
  let sentPhases: string[] = []
  const tracker = createLaunchProgressTracker({
    phases,
    sendProgress: (phase, detail) => {
      if (phase === 'steps') {
        sentPhases = (detail.steps as Array<{ phase: string }>).map((step) => step.phase)
      }
      progress({ phase, ...detail } as Partial<ProgressData>)
    }
  })
  tracker.start()
  tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)
  tracker.addLatePhase(FRONTEND_RESTORE_PHASE)
  return { tracker, sentPhases: () => sentPhases }
}

const BOOT_LOG_LINE_PER_ACTIVITY = [
  ['### Loading: ComfyUI-Manager (V3.30)', 'Loading ComfyUI-Manager…'],
  ['FETCH ComfyRegistry Data: 5/90', 'Updating node registry…'],
  ['Set vram state to: NORMAL_VRAM', 'Configuring GPU memory…'],
  ['pytorch version: 2.7.1+cu128', 'Optimizing for your hardware…'],
  ['Checkpoint files will always be loaded safely.', 'Preparing model loading…'],
  ['INFO  [alembic.runtime.migration] Running upgrade 0001 -> 0002', 'Updating database…'],
  ['Loaded node pack from disk', 'Loading custom nodes…']
] as const

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

  it('plays one of the build videos and shows it once its first frame is ready', async () => {
    const w = await openDialog()
    const video = w.get<HTMLVideoElement>('[data-testid="build-progress-video"]')
    expect(video.attributes('src')).toMatch(/^\.\/build-progress\/[a-z_]+\.webm$/)
    expect(video.classes()).toContain('opacity-0')

    await video.trigger('loadeddata')
    expect(video.classes()).toContain('opacity-100')
  })

  it('never pitches Cloud while a build installs or starts', async () => {
    const install = await openDialog()
    expect(install.text()).not.toContain('Try Cloud')
    install.unmount()
    setActivePinia(createPinia())
    const launch = await openDialog('launch')
    expect(launch.text()).not.toContain('Try Cloud')
  })

  it('names every step main sends during a start in words, never by its phase id', async () => {
    const w = await openDialog('launch')
    const main = startLikeMain()
    await flushPromises()

    const nameByPhase = Object.fromEntries(
      main.sentPhases().map((phase, index) => [phase, stepNames(w)[index]])
    )
    expect(nameByPhase).toMatchObject({
      repair: 'Repair the install',
      agentRequirements: 'Install agent requirements',
      frontendRestore: 'Restore the frontend',
      torchRepair: 'Restore GPU PyTorch',
      launchStart: 'Start ComfyUI',
      securityScan: 'Run security scan',
      mountLibraries: 'Load libraries',
      gpu: 'Initialize GPU',
      customNodes: 'Load custom nodes',
      startingServer: 'Start server'
    })
    const shownByPhaseId = Object.entries(nameByPhase).filter(([phase, name]) => name === phase)
    expect(shownByPhaseId).toEqual([])
  })

  it('says what ComfyUI is doing under the active step in words, for every activity main reports', async () => {
    const w = await openDialog('launch')
    const { tracker } = startLikeMain()
    tracker.ingest('Total VRAM 24564 MB, total RAM 65349 MB\n')
    await flushPromises()

    const shown: string[] = []
    for (const [line] of BOOT_LOG_LINE_PER_ACTIVITY) {
      tracker.ingest(`${line}\n`)
      await flushPromises()
      shown.push(activeStepDetail(w))
    }

    expect(shown).toEqual(BOOT_LOG_LINE_PER_ACTIVITY.map(([, words]) => words))
    expect(w.text()).not.toContain('launch.activity')
  })

  it('hides an activity it has no words for instead of printing its key', async () => {
    const w = await openDialog('launch')
    startLikeMain()
    progress({ phase: 'gpu', percent: -1, status: 'launch.activity.somethingNew' })
    await flushPromises()

    expect(w.find('[data-testid="build-progress-step-detail"]').exists()).toBe(false)
    expect(w.text()).not.toContain('launch.activity')
  })

  it('opens on the newest log line, follows new output, and stays put once the reader scrolls up', async () => {
    const logBoxWithRoomForThreeLines = document.createElement('style')
    logBoxWithRoomForThreeLines.textContent =
      '[data-testid="build-progress-logs"] { height: 48px; line-height: 16px; overflow-y: auto; }'
    document.head.append(logBoxWithRoomForThreeLines)
    try {
      const closedBeforeLooking = await openDialog('launch')
      output(Array.from({ length: 40 }, (_, n) => `earlier line ${n}\n`).join(''))
      await flushPromises()
      closedBeforeLooking.unmount()

      const w = mount(BuildProgressDialog, {
        props: { installationId: ID },
        attachTo: document.body
      })
      await flushPromises()
      const logs = w.get<HTMLElement>('[data-testid="build-progress-logs"]').element
      const linesBelowTheFold = () =>
        Math.round((logs.scrollHeight - logs.scrollTop - logs.clientHeight) / 16)

      expect(logs.scrollHeight).toBeGreaterThan(logs.clientHeight)
      expect(linesBelowTheFold()).toBe(0)

      output('newest line\n'.repeat(10))
      await flushPromises()
      expect(linesBelowTheFold()).toBe(0)

      logs.scrollTop = 0
      logs.dispatchEvent(new Event('scroll'))
      output('arrived while reading older lines\n'.repeat(10))
      await flushPromises()
      expect(logs.scrollTop).toBe(0)
    } finally {
      logBoxWithRoomForThreeLines.remove()
    }
  })

  it('cancels a start without asking and offers Try again', async () => {
    const w = await openDialog('launch')
    expect(w.find('[role="dialog"]').attributes('aria-label')).toBe('Starting ComfyUI')

    settle({ ok: false, message: 'ComfyUI exited with code 1' })
    await flushPromises()
    expect(w.find('[role="dialog"]').attributes('aria-label')).toBe("ComfyUI didn't start")
    await w.get('[data-testid="build-progress-retry"]').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('stops a starting build straight away', async () => {
    const w = await openDialog('launch')
    await w.get('[data-testid="build-progress-cancel"]').trigger('click')
    await flushPromises()
    expect(modal.confirm).not.toHaveBeenCalled()
    expect(window.api.cancelOperation).toHaveBeenCalledWith(ID)
    expect(w.emitted('close')).toHaveLength(1)
  })
})
