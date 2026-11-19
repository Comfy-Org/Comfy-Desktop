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
    { id: 'comfyVersion', label: 'Version', type: 'select' },
    { id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }
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
      return []
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

function hardwareTrigger(): HTMLElement {
  return only('[data-testid="config-select-variant"]')
}

type Mounted = Awaited<ReturnType<typeof openChangeSetup>>

function hardwareDescriptions(wrapper: Mounted): string[] {
  const select = wrapper
    .findAllComponents(BaseSelect)
    .find((candidate) => candidate.props('ariaLabel') === 'Hardware')
  if (!select) throw new Error('the Hardware dropdown is missing')
  return (select.props('options') as { description?: string }[]).map(
    (option) => option.description ?? ''
  )
}

async function openChangeSetup(
  props: { hideBackToDashboard?: boolean } = {},
  options: { needsConsent?: boolean } = {}
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(InstallWizardModal, {
    props,
    attachTo: document.body,
    global: { plugins: [pinia] }
  })
  await wrapper.vm.open(
    props.hideBackToDashboard ? { cameFromSetup: true, needsConsent: options.needsConsent } : {}
  )
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

describe('opening Change setup from the New build summary', () => {
  function dialogTop(): number {
    return Math.round(only('.setup-modal-panel').getBoundingClientRect().top * 100) / 100
  }

  it.each([
    [1100, 860],
    [800, 563]
  ])(
    'keeps the dialog pinned at the top on Change and on Discard at %i × %i',
    async (width, height) => {
      await browserPage.viewport(width, height)
      installStandaloneApi(createLoadGate())
      const pinia = createPinia()
      setActivePinia(pinia)
      const wrapper = mount(InstallWizardModal, {
        attachTo: document.body,
        global: { plugins: [pinia] }
      })
      await wrapper.vm.open({})
      await flushPromises()
      await finishEntranceAnimations()
      expect(onScreen('[data-testid="config-summary"]')).toHaveLength(1)
      const summaryTop = dialogTop()

      only('[data-testid="config-change-setup"]').click()
      await flushPromises()
      await finishEntranceAnimations()
      expect(onScreen('[data-testid="config-change-form"]')).toHaveLength(1)
      expect(dialogTop()).toBe(summaryTop)

      only('[data-testid="config-discard-changes"]').click()
      await flushPromises()
      await finishEntranceAnimations()
      expect(onScreen('[data-testid="config-summary"]')).toHaveLength(1)
      expect(dialogTop()).toBe(summaryTop)
      wrapper.unmount()
    }
  )
})

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
      { ...boxOf('dialog top', only('.setup-modal-panel')), height: 0 },
      boxOf('title', only('.setup-modal-title')),
      boxOf('Start from', only('[data-testid="config-start-from"]'))
    ]
  }

  function expectFooterInWindow(height: number): void {
    const footer = only('.setup-modal-foot').getBoundingClientRect()
    expect(footer.bottom).toBeLessThanOrEqual(height)
  }

  async function pick(testId: string): Promise<void> {
    only(`[data-testid="${testId}"]`).click()
    await flushPromises()
    await nextFrame()
  }

  async function pickWhereItIs(testId: string): Promise<void> {
    only('[data-testid="existing-comfy-tabs"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    )
    await flushPromises()
    await nextFrame()
    only(`[data-testid="${testId}"]`).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await flushPromises()
    await nextFrame()
  }

  it.each([
    [1100, 860],
    [800, 563]
  ])(
    'keeps the title and Start from still across all choices at %i × %i, and only the footer moves',
    async (width, height) => {
      await browserPage.viewport(width, height)
      installSetupChoices()
      await openChangeSetup()
      const settled = navigationLayout()
      const dialog = only('.setup-modal-panel').getBoundingClientRect()
      expect(dialog.top).toBeGreaterThanOrEqual(0)
      expect(dialog.bottom).toBeLessThanOrEqual(height)
      const body = only('.setup-modal-body')
      expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight)

      await pick('config-start-from-existing')
      expect(navigationLayout()).toEqual(settled)
      expectFooterInWindow(height)
      expect(onScreen('[data-testid="existing-comfy-folder-form"]')).toHaveLength(1)

      await pickWhereItIs('existing-comfy-snapshot')
      expect(navigationLayout()).toEqual(settled)
      only('.load-snapshot-tertiary').click()
      await flushPromises()
      await nextFrame()
      expect(navigationLayout()).toEqual(settled)
      expectFooterInWindow(height)

      await pickWhereItIs('install-source-remote')
      expect(navigationLayout()).toEqual(settled)
      expectFooterInWindow(height)
      expect(onScreen('#sf-url')).toHaveLength(1)

      await pick('config-start-from-new')
      expect(navigationLayout()).toEqual(settled)
      expectFooterInWindow(height)
      expect(onScreen('[data-testid="wizard-hardware-warning"]')).toHaveLength(1)
    }
  )

  it('keeps the first-use sheet still when switching between a new install and a server', async () => {
    await browserPage.viewport(800, 563)
    installSetupChoices()
    await openChangeSetup({ hideBackToDashboard: true })
    const settled = navigationLayout()
    expectFooterInWindow(window.innerHeight)

    await pick('config-start-from-existing')
    expect(navigationLayout()).toEqual(settled)
    expectFooterInWindow(window.innerHeight)
    expect(onScreen('#sf-url')).toHaveLength(1)

    await pick('config-start-from-new')
    expect(navigationLayout()).toEqual(settled)
    expectFooterInWindow(window.innerHeight)
  })

  it.each([
    ['first-use', { hideBackToDashboard: true }],
    ['New build', {}]
  ])('fits the %s Change setup in the smallest window without scrolling', async (_flow, props) => {
    await browserPage.viewport(800, 563)
    installStandaloneApi(createLoadGate())
    await openChangeSetup(props)
    const body = only('.setup-modal-body')
    expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight)
    expectFooterInWindow(563)
  })

  it('fits the first-use Change setup that asks for the EULA in the smallest window, on both choices', async () => {
    await browserPage.viewport(800, 563)
    installSetupChoices()
    await openChangeSetup({ hideBackToDashboard: true }, { needsConsent: true })
    expectFooterInWindow(563)

    await pick('config-start-from-existing')
    expect(onScreen('[data-testid="config-consent-tos"]')).toHaveLength(1)
    const body = only('.setup-modal-body')
    expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight)
    expectFooterInWindow(563)
  })
})

describe('switching the release channel in Change setup', () => {
  it('keeps the dialog and every row in place from the click until the other channel has loaded', async () => {
    const gate = createLoadGate()
    installStandaloneApi(gate)
    const wrapper = await openChangeSetup()
    const settled = formLayout()
    expect(settled.map((box) => box.what)).toEqual([
      'dialog',
      'How to start',
      'Source',
      'Release',
      'Location',
      'Hardware',
      'footer'
    ])
    gate.hold()

    releaseButton('Latest on GitHub').click()
    await flushPromises()
    expect(gate.pending()).toBe(1)
    expect(hardwareTrigger().getAttribute('aria-busy')).toBe('true')
    expect((hardwareTrigger() as HTMLButtonElement).disabled).toBe(true)
    expect(hardwareDescriptions(wrapper)).toHaveLength(HARDWARE.length)
    expect(onScreen('.config-loading')).toEqual([])

    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
    expect(onScreen('.config-release-version')).toEqual([])
    expect(hardwareTrigger().hasAttribute('aria-busy')).toBe(false)
    expect((hardwareTrigger() as HTMLButtonElement).disabled).toBe(false)
    expect(hardwareDescriptions(wrapper).every((text) => text.includes('0.4.2 (nightly)'))).toBe(
      true
    )

    releaseButton('Stable').click()
    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
    expect(only('.config-release-version .ui-select-label').textContent?.trim()).toBe('v0.4.2')
    expect(hardwareDescriptions(wrapper).some((text) => text.includes('nightly'))).toBe(false)
  })

  it('keeps the first-run Change setup still while the other channel loads', async () => {
    const gate = createLoadGate()
    installStandaloneApi(gate)
    await openChangeSetup({ hideBackToDashboard: true })
    const settled = formLayout()
    gate.hold()

    releaseButton('Latest on GitHub').click()
    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)

    releaseButton('Stable').click()
    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
  })

  it('applies only the last choice when the channel is switched back before the first switch loaded', async () => {
    const gate = createLoadGate()
    const getFieldOptions = installStandaloneApi(gate)
    const wrapper = await openChangeSetup()
    const settled = formLayout()
    gate.hold()

    releaseButton('Latest on GitHub').click()
    await flushPromises()
    releaseButton('Stable').click()

    for (const layout of await layoutsWhileLoading(gate)) expect(layout).toEqual(settled)
    expect(only('.config-release-version .ui-select-label').textContent?.trim()).toBe('v0.4.2')
    expect(hardwareDescriptions(wrapper).some((text) => text.includes('nightly'))).toBe(false)
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
