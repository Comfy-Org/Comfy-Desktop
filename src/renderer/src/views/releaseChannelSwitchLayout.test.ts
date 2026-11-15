import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import InstallWizardModal from './InstallWizardModal.vue'
import LoadSnapshotModal from './LoadSnapshotModal.vue'
import BaseSelect from '../components/ui/BaseSelect.vue'
import { useModal } from '../composables/useModal'

interface Selections {
  release?: { value: string }
  comfyVersion?: { value: string }
}

interface Box {
  what: string
  top: number
  height: number
}

const RELEASES = [
  { value: 'stable', label: 'Stable', recommended: true },
  { value: 'latest', label: 'Latest on GitHub' }
]

const HARDWARE = [
  { id: 'win-nvidia-cu128', label: 'NVIDIA (CU128)', megabytes: 2531, recommended: true },
  { id: 'win-amd', label: 'AMD', megabytes: 1874, recommended: false },
  { id: 'win-cpu', label: 'CPU', megabytes: 412, recommended: false }
]

const STANDALONE = {
  id: 'standalone',
  label: 'Standalone',
  fields: [
    { id: 'release', label: 'Release', type: 'select' },
    { id: 'comfyVersion', label: 'ComfyUI version', type: 'select' },
    { id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' },
    { id: 'bundledTemplate', label: 'Starter workflow', type: 'select', renderAs: 'cards' }
  ]
}

function createLoadGate() {
  let holding = false
  const waiting: Array<() => void> = []
  return {
    hold: () => {
      holding = true
    },
    pending: () => waiting.length,
    finishNext: () => waiting.shift()?.(),
    pass: () =>
      holding ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve()
  }
}

type LoadGate = ReturnType<typeof createLoadGate>

function hardwareOptions(selections: Selections) {
  const version = (selections.comfyVersion?.value ?? 'v0.4.2').replace(/^v/, '')
  const shown = selections.release?.value === 'latest' ? `${version} (nightly)` : version
  return HARDWARE.map((hardware) => ({
    value: hardware.id,
    label: hardware.label,
    description: `ComfyUI ${shown}  ·  Python 3.12.9  ·  ${hardware.megabytes} MB`,
    recommended: hardware.recommended,
    data: { variantId: hardware.id }
  }))
}

function installStandaloneApi(gate: LoadGate) {
  const getFieldOptions = vi.fn(
    async (_source: string, fieldId: string, selections: Selections) => {
      if (fieldId === 'release') return RELEASES
      await gate.pass()
      if (fieldId === 'comfyVersion') {
        if (selections.release?.value !== 'stable') return []
        return [
          { value: 'v0.4.2', label: 'v0.4.2', recommended: true },
          { value: 'v0.4.1', label: 'v0.4.1' }
        ]
      }
      if (fieldId === 'variant') return hardwareOptions(selections)
      return [
        { value: 'none', label: 'No starter workflow' },
        { value: 'flux', label: 'Flux Schnell', data: { sizeBytes: 12_000_000_000 } }
      ]
    }
  )
  window.api = {
    platform: 'win32',
    openPath: vi.fn().mockResolvedValue(undefined),
    detectGPU: vi.fn().mockResolvedValue({ label: 'NVIDIA GeForce RTX 4090' }),
    getDefaultInstallDir: vi.fn().mockResolvedValue('C:\\Users\\alex\\ComfyUI'),
    getSources: vi.fn().mockResolvedValue([STANDALONE]),
    getFieldOptions,
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSetting: vi.fn().mockResolvedValue(false),
    onSettingsChanged: vi.fn(() => () => {}),
    getInstallationsSummary: vi.fn().mockResolvedValue({ localCount: 0 }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    getDiskSpace: vi.fn().mockResolvedValue({ free: 412_000_000_000, total: 1_000_000_000_000 }),
    validateInstallPath: vi.fn().mockResolvedValue([]),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {}),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      listBuilds: vi.fn().mockResolvedValue([])
    }
  } as unknown as typeof window.api
  return getFieldOptions
}

function onScreen(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => element.getClientRects().length > 0
  )
}

function only(selector: string): HTMLElement {
  const [element] = onScreen(selector)
  if (!element) throw new Error(`nothing on screen matches ${selector}`)
  return element
}

function boxOf(what: string, element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  return {
    what,
    top: Math.round(rect.top * 100) / 100,
    height: Math.round(rect.height * 100) / 100
  }
}

function formLayout(): Box[] {
  return [
    boxOf('dialog', only('.setup-modal-panel')),
    ...onScreen('.setup-form-row').map((row) =>
      boxOf(row.querySelector('.config-label')?.textContent?.trim() ?? '', row)
    ),
    boxOf('footer', only('.setup-modal-foot'))
  ]
}

const QUIET_FRAMES_BEFORE_MEASURING = 3

function runningEntranceAnimations(): Animation[] {
  return document
    .getAnimations()
    .filter(
      (animation) =>
        animation.playState === 'running' &&
        Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))
    )
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function finishEntranceAnimations(): Promise<void> {
  let quietFrames = 0
  while (quietFrames < QUIET_FRAMES_BEFORE_MEASURING) {
    await nextFrame()
    const running = runningEntranceAnimations()
    if (running.length === 0) {
      quietFrames += 1
      continue
    }
    quietFrames = 0
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)))
  }
}

async function layoutsWhileLoading(gate: LoadGate): Promise<Box[][]> {
  const seen: Box[][] = []
  for (;;) {
    await flushPromises()
    seen.push(formLayout())
    if (gate.pending() === 0) return seen
    gate.finishNext()
  }
}

function releaseButton(label: string): HTMLElement {
  const button = onScreen('[data-testid="config-release"] [role="group"] button').find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!button) throw new Error(`no release choice named ${label}`)
  return button
}

function hardwareGroup(): HTMLElement {
  return only('#source-fields [role="radiogroup"]')
}

function hardwareDescriptions(): string[] {
  return onScreen('#source-fields .setup-option__meta').map(
    (meta) => meta.textContent?.trim() ?? ''
  )
}

async function openChangeSetup(props: { hideBackToDashboard?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(InstallWizardModal, {
    props,
    attachTo: document.body,
    global: { plugins: [pinia] }
  })
  await wrapper.vm.open(props.hideBackToDashboard ? { cameFromSetup: true } : {})
  await flushPromises()
  if (!props.hideBackToDashboard) {
    only('[data-testid="config-change-setup"]').click()
    await flushPromises()
  }
  await finishEntranceAnimations()
  return wrapper
}

beforeAll(() => browserPage.viewport(1100, 860))

beforeEach(() => {
  useModal().dismiss()
})

afterEach(() => browserPage.viewport(1100, 860))

describe('switching where Change setup gets ComfyUI', () => {
  function installSetupChoices() {
    installStandaloneApi(createLoadGate())
    window.api.getSources = vi.fn().mockResolvedValue([
      STANDALONE,
      {
        id: 'remote',
        label: 'Connect to server',
        skipInstall: true,
        fields: [
          { id: 'url', label: 'Server URL', type: 'text', defaultValue: 'http://localhost:8188' }
        ]
      }
    ])
    window.api.validateHardware = vi.fn().mockResolvedValue({
      supported: true,
      warning: 'This hardware may need an extra driver before it can run ComfyUI.'
    })
    window.api.previewSnapshotFile = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        filePath: 'C:\\Users\\alex\\studio.json',
        installationName: 'Studio',
        snapshotCount: 1,
        snapshots: [],
        newestSnapshot: {
          comfyuiVersion: 'v0.4.2',
          pythonVersion: '3.12',
          createdAt: '2026-01-01T00:00:00Z',
          updateChannel: 'stable',
          comfyui: { variant: 'win-nvidia-cu128', releaseTag: '' },
          customNodes: [],
          pipPackages: {},
          pipPackageCount: 0
        }
      }
    })
  }

  function navigationLayout(): Box[] {
    return [
      boxOf('dialog', only('.setup-modal-panel')),
      boxOf('title', only('.setup-modal-title')),
      boxOf('Start from', only('[data-testid="config-start-from"]')),
      boxOf('footer', only('.setup-modal-foot'))
    ]
  }

  async function pick(testId: string): Promise<void> {
    only(`[data-testid="${testId}"]`).click()
    await flushPromises()
    await nextFrame()
  }

  it.each([
    [1100, 860],
    [800, 563]
  ])(
    'keeps the title, Start from and footer still across all choices at %i × %i',
    async (width, height) => {
      await browserPage.viewport(width, height)
      installSetupChoices()
      const wrapper = await openChangeSetup()
      const settled = navigationLayout()
      const dialog = only('.setup-modal-panel').getBoundingClientRect()
      expect(dialog.top).toBeGreaterThanOrEqual(0)
      expect(dialog.bottom).toBeLessThanOrEqual(height)

      await pick('config-start-from-existing')
      expect(navigationLayout()).toEqual(settled)
      expect(onScreen('[data-testid="existing-comfy-folder-form"]')).toHaveLength(1)

      await pick('existing-comfy-snapshot')
      expect(navigationLayout()).toEqual(settled)
      only('.load-snapshot-tertiary').click()
      await flushPromises()
      await nextFrame()
      expect(navigationLayout()).toEqual(settled)

      const body = only('.setup-modal-body')
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
      const footer = boxOf('footer', only('.setup-modal-foot'))
      body.scrollTop = body.scrollHeight
      await nextFrame()
      expect(body.scrollTop).toBeGreaterThan(0)
      expect(boxOf('footer', only('.setup-modal-foot'))).toEqual(footer)
      body.scrollTop = 0

      await pick('install-source-remote')
      expect(navigationLayout()).toEqual(settled)
      expect(onScreen('#sf-url')).toHaveLength(1)

      await pick('config-start-from-new')
      expect(navigationLayout()).toEqual(settled)
      expect(onScreen('[data-testid="wizard-hardware-warning"]')).toHaveLength(1)

      await pick('config-discard-changes')
      expect(only('.setup-modal-panel').getBoundingClientRect().height).toBeLessThanOrEqual(
        dialog.height
      )
      wrapper.unmount()
    }
  )

  it('keeps the first-use sheet still when switching between a new install and a server', async () => {
    await browserPage.viewport(800, 563)
    installSetupChoices()
    await openChangeSetup({ hideBackToDashboard: true })
    const settled = navigationLayout()
    const footer = only('.setup-modal-foot').getBoundingClientRect()
    expect(footer.bottom).toBeLessThanOrEqual(window.innerHeight)

    await pick('config-start-from-existing')
    expect(navigationLayout()).toEqual(settled)
    expect(onScreen('#sf-url')).toHaveLength(1)

    await pick('config-start-from-new')
    expect(navigationLayout()).toEqual(settled)
  })
})

describe('switching the release channel in Change setup', () => {
  it('keeps the dialog and every row in place from the click until the other channel has loaded', async () => {
    const gate = createLoadGate()
    installStandaloneApi(gate)
    await openChangeSetup()
    const settled = formLayout()
    expect(settled.map((box) => box.what)).toEqual([
      'dialog',
      'Start from',
      'Get ComfyUI from',
      'Release',
      'Location',
      'Hardware',
      'footer'
    ])
    gate.hold()

    releaseButton('Latest on GitHub').click()
    await flushPromises()
    expect(gate.pending()).toBe(1)
    expect(hardwareGroup().getAttribute('aria-busy')).toBe('true')
    expect(hardwareGroup().inert).toBe(true)
    expect(onScreen('#source-fields [role="radio"]')).toHaveLength(HARDWARE.length)
    expect(onScreen('.config-loading')).toEqual([])

    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
    expect(onScreen('.config-release-version')).toEqual([])
    expect(hardwareGroup().hasAttribute('aria-busy')).toBe(false)
    expect(hardwareGroup().inert).toBe(false)
    expect(hardwareDescriptions().every((text) => text.includes('0.4.2 (nightly)'))).toBe(true)

    releaseButton('Stable').click()
    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
    expect(only('.config-release-version .ui-select-label').textContent?.trim()).toBe('v0.4.2')
    expect(hardwareDescriptions().some((text) => text.includes('nightly'))).toBe(false)
  })

  it('never shows the starter workflow row in first-run setup while the other channel loads', async () => {
    const gate = createLoadGate()
    installStandaloneApi(gate)
    await openChangeSetup({ hideBackToDashboard: true })
    const settled = formLayout()
    expect(settled.map((box) => box.what)).not.toContain('Starter workflow')
    gate.hold()

    releaseButton('Latest on GitHub').click()
    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)

    releaseButton('Stable').click()
    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
  })

  it('applies only the last choice when the channel is switched back before the first switch loaded', async () => {
    const gate = createLoadGate()
    const getFieldOptions = installStandaloneApi(gate)
    await openChangeSetup()
    const settled = formLayout()
    gate.hold()

    releaseButton('Latest on GitHub').click()
    await flushPromises()
    releaseButton('Stable').click()

    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
    expect(only('.config-release-version .ui-select-label').textContent?.trim()).toBe('v0.4.2')
    expect(hardwareDescriptions().some((text) => text.includes('nightly'))).toBe(false)
    const hardwareLoadsForLatest = getFieldOptions.mock.calls.filter(
      ([, fieldId, selections]) => fieldId === 'variant' && selections.release?.value === 'latest'
    )
    expect(hardwareLoadsForLatest).toEqual([])
  })
})

describe('switching the release in Load snapshot', () => {
  const preview = {
    filePath: 'C:\\Users\\alex\\studio.json',
    installationName: 'Studio',
    snapshotCount: 1,
    snapshots: [],
    newestSnapshot: {
      comfyuiVersion: 'v0.4.2',
      pythonVersion: '3.12',
      createdAt: '2026-01-01T00:00:00Z',
      updateChannel: 'stable',
      comfyui: { variant: 'win-nvidia-cu128', releaseTag: '' },
      customNodes: [],
      pipPackages: {},
      pipPackageCount: 0
    }
  }

  it('keeps the device cards and the rows under them in place while the other release loads', async () => {
    const gate = createLoadGate()
    window.api = {
      previewSnapshotFile: vi.fn().mockResolvedValue({ ok: true, preview }),
      detectGPU: vi.fn().mockResolvedValue(null),
      getFieldOptions: vi.fn(async (_source: string, fieldId: string, selections: Selections) => {
        if (fieldId === 'release') return RELEASES
        await gate.pass()
        return hardwareOptions(selections)
      })
    } as unknown as typeof window.api
    const wrapper = mount(LoadSnapshotModal, { attachTo: document.body })
    wrapper.vm.open()
    await flushPromises()
    only('.load-snapshot-tertiary').click()
    await flushPromises()
    await finishEntranceAnimations()
    const settled = formLayout()
    expect(settled.map((box) => box.what)).toContain('Device')
    const createBuild = only('.load-snapshot-create') as HTMLButtonElement
    expect(createBuild.disabled).toBe(false)
    gate.hold()

    wrapper.findComponent(BaseSelect).vm.$emit('update:modelValue', 'latest')
    await flushPromises()
    expect(gate.pending()).toBe(1)
    expect(only('[role="radiogroup"]').getAttribute('aria-busy')).toBe('true')
    expect(onScreen('[role="radio"]')).toHaveLength(HARDWARE.length)
    expect(onScreen('.load-snapshot-loading')).toEqual([])
    expect(createBuild.disabled).toBe(true)

    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
    expect(only('[role="radiogroup"]').hasAttribute('aria-busy')).toBe(false)
    expect(createBuild.disabled).toBe(false)
    expect(
      onScreen('.setup-option__meta').every((meta) => meta.textContent?.includes('(nightly)'))
    ).toBe(true)
  })
})
