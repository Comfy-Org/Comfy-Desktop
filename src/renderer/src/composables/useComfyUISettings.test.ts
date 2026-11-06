import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, arg?: string | Record<string, unknown>) =>
      typeof arg === 'string' ? arg : key
  })
}))

const modalSpies = vi.hoisted(() => ({
  confirm: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  confirmWithOptions: vi.fn(),
  alert: vi.fn()
}))
const dialogsSpies = vi.hoisted(() => ({
  confirm: vi.fn(),
  prompt: vi.fn(),
  actionSheet: vi.fn(),
  alert: vi.fn()
}))
const actionGuardSpies = vi.hoisted(() => ({
  checkBeforeAction: vi.fn()
}))

vi.mock('./useModal', () => ({
  useModal: () => modalSpies
}))

vi.mock('./useDialogs', () => ({
  useDialogs: () => dialogsSpies
}))

vi.mock('./useActionGuard', () => ({
  useActionGuard: () => actionGuardSpies
}))

vi.mock('./useMigrateAction', () => ({
  useMigrateAction: () => ({
    confirmMigration: vi.fn()
  })
}))

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toErrorBucket: () => 'other'
}))

import { useComfyUISettings } from './useComfyUISettings'
import { useSessionStore } from '../stores/sessionStore'
import type {
  ActionDef,
  ActionResult,
  DetailField,
  DetailSection,
  Installation,
  ShowProgressOpts
} from '../types/ipc'

function makeInstall(id: string, name: string): Installation {
  return {
    id,
    name,
    sourceLabel: 'standalone',
    sourceCategory: 'local',
    status: 'installed',
    installPath: `/tmp/${id}`
  } as Installation
}

function makeSection(installName: string): DetailSection {
  return {
    tab: 'status',
    title: `Sections for ${installName}`,
    fields: []
  } as DetailSection
}

interface MockApi {
  getDetailSections: ReturnType<typeof vi.fn>
  getDiskSpace: ReturnType<typeof vi.fn>
  getInstallationSize: ReturnType<typeof vi.fn>
  stopComfyUI: ReturnType<typeof vi.fn>
  runAction: ReturnType<typeof vi.fn>
  updateInstallation: ReturnType<typeof vi.fn>
}

function installMockApi(overrides: Partial<MockApi> = {}): MockApi {
  const api: MockApi = {
    getDetailSections: vi.fn().mockResolvedValue([]),
    getDiskSpace: vi.fn().mockResolvedValue(null),
    getInstallationSize: vi.fn().mockResolvedValue({ sizeBytes: 0 }),
    stopComfyUI: vi.fn().mockResolvedValue(undefined),
    runAction: vi.fn().mockResolvedValue({ ok: true }),
    updateInstallation: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  ;(window as unknown as { api: MockApi }).api = api
  return api
}

describe('useComfyUISettings — switch staleness behaviour (#782 / #582)', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  it('keeps the previous install\'s sections + diskSpace painted during the switch window so the right pane does not flash "Loading…" (#782)', async () => {
    let resolveB: ((value: DetailSection[]) => void) | null = null
    const sectionsB = new Promise<DetailSection[]>((resolve) => {
      resolveB = resolve
    })

    const api = installMockApi({
      getDetailSections: vi.fn((id: string) => {
        if (id === 'a') return Promise.resolve([makeSection('A')])
        if (id === 'b') return sectionsB
        return Promise.resolve([])
      })
    })

    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    const onShowProgress = vi.fn()

    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress })
    })

    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    expect(composable.sections.value.map((s) => s.title)).toEqual(['Sections for A'])
    expect(composable.sectionsFresh.value).toBe(true)

    installation.value = makeInstall('b', 'B')
    await nextTick()

    expect(composable.loading.value).toBe(true)
    expect(composable.sections.value.map((s) => s.title)).toEqual(['Sections for A'])
    expect(composable.sectionsFresh.value).toBe(false)

    resolveB!([makeSection('B')])
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()

    expect(composable.loading.value).toBe(false)
    expect(composable.sections.value.map((s) => s.title)).toEqual(['Sections for B'])
    expect(composable.sectionsFresh.value).toBe(true)
    expect(api.getDetailSections).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('clears sections when the installation prop is set to null', async () => {
    installMockApi({
      getDetailSections: vi.fn().mockResolvedValue([makeSection('A')])
    })
    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    const onShowProgress = vi.fn()

    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress })
    })

    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    expect(composable.sections.value.length).toBeGreaterThan(0)

    installation.value = null
    await nextTick()
    expect(composable.sections.value).toEqual([])
    expect(composable.diskSpace.value).toBeNull()
    expect(composable.sectionsFresh.value).toBe(false)
    scope.stop()
  })

  it('does NOT clear sections on a same-install reload (only on install switches)', async () => {
    let getCallCount = 0
    installMockApi({
      getDetailSections: vi.fn(() => {
        getCallCount++
        return Promise.resolve([makeSection(`A-call-${getCallCount}`)])
      })
    })
    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    const onShowProgress = vi.fn()

    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress })
    })

    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    expect(composable.sections.value.map((s) => s.title)).toEqual(['Sections for A-call-1'])

    await composable.reload()
    expect(composable.sections.value.length).toBeGreaterThan(0)
    expect(composable.sections.value.map((s) => s.title)).toEqual(['Sections for A-call-2'])

    scope.stop()
  })

  it('discards an out-of-order older response (A → B → A returning B late)', async () => {
    let resolveB: ((value: DetailSection[]) => void) | null = null
    const sectionsB = new Promise<DetailSection[]>((resolve) => {
      resolveB = resolve
    })
    const api = installMockApi({
      getDetailSections: vi.fn((id: string) => {
        if (id === 'a') return Promise.resolve([makeSection('A')])
        if (id === 'b') return sectionsB
        return Promise.resolve([])
      })
    })

    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress: vi.fn() })
    })

    await nextTick()
    await Promise.resolve()
    await Promise.resolve()

    installation.value = makeInstall('b', 'B')
    await nextTick()

    installation.value = makeInstall('a', 'A')
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    expect(composable.sections.value.map((s) => s.title)).toEqual(['Sections for A'])
    expect(composable.loading.value).toBe(false)

    resolveB!([makeSection('B')])
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()

    expect(composable.sections.value.map((s) => s.title)).toEqual(['Sections for A'])
    expect(composable.loading.value).toBe(false)
    expect(api.getDetailSections).toHaveBeenCalledTimes(3)
    scope.stop()
  })
})

describe('useComfyUISettings — refreshing after an operation', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  async function flush(): Promise<void> {
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
  }

  async function mountForInstall(apiOverrides: Partial<MockApi> = {}) {
    const api = installMockApi(apiOverrides)
    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress: vi.fn() })
    })
    await flush()
    vi.mocked(api.getDetailSections).mockClear()
    return { composable, api, scope }
  }

  it('re-reads sections when an operation on this install ends', async () => {
    const { api, scope } = await mountForInstall()
    const store = useSessionStore()

    store.operationInstances.set('a', { actionId: 'update-comfyui' })
    await flush()
    expect(api.getDetailSections).not.toHaveBeenCalled()

    store.operationInstances.delete('a')
    await flush()
    expect(api.getDetailSections).toHaveBeenCalledExactlyOnceWith('a')
    scope.stop()
  })

  it('ignores an operation on another install', async () => {
    const { api, scope } = await mountForInstall()
    const store = useSessionStore()

    store.operationInstances.set('b', { actionId: 'update-comfyui' })
    await flush()
    store.operationInstances.delete('b')
    await flush()

    expect(api.getDetailSections).not.toHaveBeenCalled()
    scope.stop()
  })

  it('leaves the refresh to an inline action that is still finishing', async () => {
    let finishAction: (result: ActionResult) => void = () => {}
    const { composable, api, scope } = await mountForInstall({
      runAction: vi.fn(() => new Promise<ActionResult>((resolve) => (finishAction = resolve)))
    })
    const store = useSessionStore()

    const running = composable.runAction({ id: 'check-update', label: 'Check' } as ActionDef)
    await flush()
    store.operationInstances.set('a', { actionId: 'check-update' })
    await flush()
    store.operationInstances.delete('a')
    await flush()
    expect(api.getDetailSections).not.toHaveBeenCalled()

    finishAction({ ok: true })
    await running
    expect(api.getDetailSections).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('stops loading when a section refresh supersedes a full reload', async () => {
    let finishReload: (sections: DetailSection[]) => void = () => {}
    const { composable, api, scope } = await mountForInstall({
      getDetailSections: vi.fn().mockResolvedValue([makeSection('A')])
    })
    vi.mocked(api.getDetailSections).mockImplementationOnce(
      () => new Promise<DetailSection[]>((resolve) => (finishReload = resolve))
    )

    const reloading = composable.reload()
    await flush()
    expect(composable.loading.value).toBe(true)

    await composable.refreshSection('Sections for A')
    finishReload([makeSection('A')])
    await reloading

    expect(composable.loading.value).toBe(false)
    scope.stop()
  })
})

describe('useComfyUISettings.runAction — stop-warning augment + self-stopping apiCall (FLOW 1 + FLOW 3)', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    modalSpies.confirm.mockReset()
    modalSpies.prompt.mockReset()
    modalSpies.select.mockReset()
    modalSpies.confirmWithOptions.mockReset()
    modalSpies.alert.mockReset()
    dialogsSpies.confirm.mockReset()
    dialogsSpies.prompt.mockReset()
    dialogsSpies.actionSheet.mockReset()
    dialogsSpies.alert.mockReset()
    actionGuardSpies.checkBeforeAction.mockReset()
    actionGuardSpies.checkBeforeAction.mockResolvedValue('proceed')
  })

  function markRunning(id: string, name = id): void {
    const sessionStore = useSessionStore()
    sessionStore.runningInstances.set(id, {
      installationId: id,
      installationName: name,
      mode: 'standalone'
    })
  }

  function mountComposable(
    installation: Installation | null,
    onShowProgress = vi.fn()
  ): {
    composable: ReturnType<typeof useComfyUISettings>
    onShowProgress: ReturnType<typeof vi.fn>
    onDismissPreview: ReturnType<typeof vi.fn>
    scope: ReturnType<typeof effectScope>
  } {
    const installationRef = ref<Installation | null>(installation)
    const scope = effectScope()
    const onDismissPreview = vi.fn()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({
        installation: installationRef,
        onShowProgress,
        onDismissPreview
      })
    })
    return { composable, onShowProgress, onDismissPreview, scope }
  }

  it('prepends the willStopRunning warning to the action confirm message when the install is running', async () => {
    installMockApi()
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue(false)
    const { composable, scope } = mountComposable(makeInstall('a', 'A'))

    await composable.runAction({
      id: 'update-comfyui',
      label: 'Update ComfyUI',
      confirm: { title: 'Update?', message: 'This will pull the latest ComfyUI.' }
    } as ActionDef)

    expect(dialogsSpies.confirm).toHaveBeenCalledTimes(1)
    const callArg = dialogsSpies.confirm.mock.calls[0]![0] as { message: string }
    expect(callArg.message).toBe('errors.willStopRunning\n\nThis will pull the latest ComfyUI.')
    scope.stop()
  })

  it('synthesizes a confirm dialog carrying just the warning when the action has neither confirm nor prompt', async () => {
    installMockApi()
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue(false)
    const { composable, scope } = mountComposable(makeInstall('a', 'A'))

    await composable.runAction({
      id: 'snapshot-restore',
      label: 'Restore Snapshot'
    } as ActionDef)

    expect(dialogsSpies.confirm).toHaveBeenCalledTimes(1)
    const callArg = dialogsSpies.confirm.mock.calls[0]![0] as { message: string; title: string }
    expect(callArg.message).toBe('errors.willStopRunning')
    expect(callArg.title).toBe('Restore Snapshot')
    scope.stop()
  })

  it('does NOT prepend the warning when the install is not running', async () => {
    installMockApi()
    dialogsSpies.confirm.mockResolvedValue(false)
    const { composable, scope } = mountComposable(makeInstall('a', 'A'))

    await composable.runAction({
      id: 'update-comfyui',
      label: 'Update ComfyUI',
      confirm: { title: 'Update?', message: 'This will pull the latest ComfyUI.' }
    } as ActionDef)

    expect(dialogsSpies.confirm).toHaveBeenCalledTimes(1)
    const callArg = dialogsSpies.confirm.mock.calls[0]![0] as { message: string }
    expect(callArg.message).toBe('This will pull the latest ComfyUI.')
    scope.stop()
  })

  it('stop: shows a danger confirm, stops the backend, and dismisses the preview on confirm', async () => {
    const api = installMockApi()
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue('primary')
    const { composable, onDismissPreview, scope } = mountComposable(makeInstall('a', 'A'))

    await composable.runAction({ id: 'stop', label: 'Stop' } as ActionDef)

    expect(dialogsSpies.confirm).toHaveBeenCalledTimes(1)
    const callArg = dialogsSpies.confirm.mock.calls[0]![0] as { title: string; tone: string }
    expect(callArg.title).toBe('Stop ComfyUI')
    expect(callArg.tone).toBe('danger')
    expect(api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(api.stopComfyUI).toHaveBeenCalledWith('a')
    expect(onDismissPreview).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('stop: does not stop the backend or dismiss the preview when the confirm is cancelled', async () => {
    const api = installMockApi()
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue(false)
    const { composable, onDismissPreview, scope } = mountComposable(makeInstall('a', 'A'))

    await composable.runAction({ id: 'stop', label: 'Stop' } as ActionDef)

    expect(api.stopComfyUI).not.toHaveBeenCalled()
    expect(onDismissPreview).not.toHaveBeenCalled()
    scope.stop()
  })

  it('stop: keeps the preview open and alerts when stopComfyUI fails', async () => {
    const api = installMockApi({ stopComfyUI: vi.fn().mockRejectedValue(new Error('kill failed')) })
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue('primary')
    const { composable, onDismissPreview, scope } = mountComposable(makeInstall('a', 'A'))

    await composable.runAction({ id: 'stop', label: 'Stop' } as ActionDef)

    expect(api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(onDismissPreview).not.toHaveBeenCalled()
    expect(dialogsSpies.alert).toHaveBeenCalledTimes(1)
    expect(dialogsSpies.alert.mock.calls[0]![0].message).toBe('kill failed')
    scope.stop()
  })

  it('IN_PLACE_RELAUNCH apiCall stops the session, runs the op, and relaunches when the op succeeds', async () => {
    const api = installMockApi({
      stopComfyUI: vi.fn().mockImplementation(async (id: string) => {
        useSessionStore().runningInstances.delete(id)
      }),
      runAction: vi.fn().mockResolvedValue({ ok: true })
    })
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue('primary')

    const onShowProgress = vi.fn()
    const { composable, scope } = mountComposable(makeInstall('a', 'A'), onShowProgress)

    await composable.runAction({
      id: 'update-comfyui',
      label: 'Update ComfyUI',
      showProgress: true,
      confirm: { message: 'Update?' }
    } as ActionDef)

    expect(onShowProgress).toHaveBeenCalledTimes(1)
    const opts = onShowProgress.mock.calls[0]?.[0] as ShowProgressOpts
    expect(opts.triggersInstanceStart).toBe(true)

    const result = (await opts.apiCall()) as ActionResult

    expect(api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(api.stopComfyUI).toHaveBeenCalledWith('a')
    expect(api.runAction).toHaveBeenCalledTimes(2)
    expect(api.runAction).toHaveBeenNthCalledWith(1, 'a', 'update-comfyui', undefined)
    expect(api.runAction).toHaveBeenNthCalledWith(2, 'a', 'launch')
    expect(result).toEqual({ ok: true })
    scope.stop()
  })

  it('IN_PLACE_RELAUNCH apiCall skips the relaunch when the op result reports ok: false', async () => {
    const api = installMockApi({
      stopComfyUI: vi.fn().mockImplementation(async (id: string) => {
        useSessionStore().runningInstances.delete(id)
      }),
      runAction: vi.fn().mockResolvedValue({ ok: false, message: 'no update available' })
    })
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue('primary')
    const onShowProgress = vi.fn()
    const { composable, scope } = mountComposable(makeInstall('a', 'A'), onShowProgress)

    await composable.runAction({
      id: 'update-comfyui',
      label: 'Update ComfyUI',
      showProgress: true,
      confirm: { message: 'Update?' }
    } as ActionDef)

    const opts = onShowProgress.mock.calls[0]?.[0] as ShowProgressOpts
    await opts.apiCall()

    expect(api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledWith('a', 'update-comfyui', undefined)
    scope.stop()
  })

  it('REQUIRES_STOPPED-but-not-IN_PLACE_RELAUNCH apiCall stops and runs the op without an auto-relaunch (e.g. copy-update)', async () => {
    const api = installMockApi({
      stopComfyUI: vi.fn().mockImplementation(async (id: string) => {
        useSessionStore().runningInstances.delete(id)
      }),
      runAction: vi.fn().mockResolvedValue({ ok: true, newInstallationId: 'a-prime' })
    })
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue('primary')
    const onShowProgress = vi.fn()
    const { composable, scope } = mountComposable(makeInstall('a', 'A'), onShowProgress)

    await composable.runAction({
      id: 'copy-update',
      label: 'Copy & Update',
      showProgress: true,
      confirm: { message: 'Copy & update?' }
    } as ActionDef)

    const opts = onShowProgress.mock.calls[0]?.[0] as ShowProgressOpts
    expect(opts.triggersInstanceStart).toBe(false)
    await opts.apiCall()

    expect(api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledWith('a', 'copy-update', undefined)
    scope.stop()
  })

  it('copy-pytorch warns in its prompt, stops the running install, and runs without an auto-relaunch', async () => {
    const api = installMockApi({
      stopComfyUI: vi.fn().mockImplementation(async (id: string) => {
        useSessionStore().runningInstances.delete(id)
      }),
      runAction: vi.fn().mockResolvedValue({ ok: true, newInstallationId: 'a-prime' })
    })
    markRunning('a', 'A')
    dialogsSpies.prompt.mockResolvedValue('A copy')
    const onShowProgress = vi.fn()
    const { composable, scope } = mountComposable(makeInstall('a', 'A'), onShowProgress)

    await composable.runAction({
      id: 'copy-pytorch',
      label: 'Copy & Change PyTorch',
      showProgress: true,
      data: { stackId: 'pytorch-index:cu126:2.11.0' },
      prompt: { title: 'Copy & Change PyTorch', message: 'Name the copy.', field: 'name' }
    } as ActionDef)

    const promptArg = dialogsSpies.prompt.mock.calls[0]![0] as { message: string }
    expect(promptArg.message).toBe('errors.willStopRunning\n\nName the copy.')

    const opts = onShowProgress.mock.calls[0]?.[0] as ShowProgressOpts
    expect(opts.triggersInstanceStart).toBe(false)
    await opts.apiCall()

    expect(api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledWith('a', 'copy-pytorch', {
      stackId: 'pytorch-index:cu126:2.11.0',
      name: 'A copy'
    })
    scope.stop()
  })

  it('apiCall does not stop or relaunch when the install is not running', async () => {
    const api = installMockApi({
      runAction: vi.fn().mockResolvedValue({ ok: true })
    })
    dialogsSpies.confirm.mockResolvedValue('primary')
    const onShowProgress = vi.fn()
    const { composable, scope } = mountComposable(makeInstall('a', 'A'), onShowProgress)

    await composable.runAction({
      id: 'update-comfyui',
      label: 'Update ComfyUI',
      showProgress: true,
      confirm: { message: 'Update?' }
    } as ActionDef)

    const opts = onShowProgress.mock.calls[0]?.[0] as ShowProgressOpts
    expect(opts.triggersInstanceStart).toBe(false)
    await opts.apiCall()

    expect(api.stopComfyUI).not.toHaveBeenCalled()
    expect(api.runAction).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledWith('a', 'update-comfyui', undefined)
    scope.stop()
  })

  it('inline (no showProgress) REQUIRES_STOPPED action self-stops before invoking the backend', async () => {
    const api = installMockApi({
      stopComfyUI: vi.fn().mockImplementation(async (id: string) => {
        useSessionStore().runningInstances.delete(id)
      }),
      runAction: vi.fn().mockResolvedValue({ ok: true })
    })
    markRunning('a', 'A')
    dialogsSpies.confirm.mockResolvedValue('primary')
    const { composable, scope } = mountComposable(makeInstall('a', 'A'))

    await composable.runAction({
      id: 'update-comfyui',
      label: 'Update ComfyUI',
      confirm: { message: 'Update?' }
    } as ActionDef)

    expect(api.stopComfyUI).toHaveBeenCalledTimes(1)
    expect(api.runAction).toHaveBeenCalledWith('a', 'update-comfyui', undefined)
    scope.stop()
  })
})

describe('useComfyUISettings.updateField — optimistic write + restart-required tracking', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  function makeRestartField(id: string, value: unknown): DetailField {
    return {
      id,
      label: id,
      value: value as DetailField['value'],
      editable: true,
      editType: 'select',
      requiresRestart: true
    }
  }

  function makeSectionWithField(field: DetailField): DetailSection {
    return { tab: 'settings', title: 'Launch', fields: [field] } as DetailSection
  }

  async function mountWithField(
    installId: string,
    initialValue: unknown,
    apiOverrides: Partial<MockApi> = {}
  ) {
    const initialField = makeRestartField('launchMode', initialValue)
    const api = installMockApi({
      getDetailSections: vi.fn().mockResolvedValue([makeSectionWithField(initialField)]),
      ...apiOverrides
    })
    const installation = ref<Installation | null>(makeInstall(installId, installId.toUpperCase()))
    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress: vi.fn() })
    })
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    return { composable, api, installation, scope }
  }

  function markRunning(id: string): void {
    useSessionStore().runningInstances.set(id, {
      installationId: id,
      installationName: id.toUpperCase(),
      mode: 'standalone'
    })
  }

  it('re-reads sections when a restart replaces the session without a stopped edge', async () => {
    const { api, scope } = await mountWithField('a', 'window')
    const store = useSessionStore()
    store.runningInstances.set('a', {
      installationId: 'a',
      installationName: 'A',
      mode: 'standalone',
      startedAt: 1
    })
    await nextTick()
    await Promise.resolve()
    const afterLaunch = vi.mocked(api.getDetailSections).mock.calls.length

    store.runningInstances.set('a', { ...store.runningInstances.get('a')!, startedAt: 2 })
    await nextTick()
    await Promise.resolve()
    expect(vi.mocked(api.getDetailSections).mock.calls.length).toBe(afterLaunch + 1)

    store.runningInstances.set('a', { ...store.runningInstances.get('a')! })
    await nextTick()
    await Promise.resolve()
    expect(vi.mocked(api.getDetailSections).mock.calls.length).toBe(afterLaunch + 1)
    scope.stop()
  })

  it('clears a pending restart when a restart replaces the session without a stopped edge', async () => {
    const { composable, scope } = await mountWithField('a', 'window')
    const store = useSessionStore()
    store.runningInstances.set('a', {
      installationId: 'a',
      installationName: 'A',
      mode: 'standalone',
      startedAt: 1
    })
    await nextTick()
    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    store.runningInstances.set('a', { ...store.runningInstances.get('a')!, startedAt: 2 })
    await nextTick()
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(false)
    scope.stop()
  })

  it('keeps a pending restart when the selection moves between two running installs', async () => {
    const { composable, installation, scope } = await mountWithField('b', 'window')
    const store = useSessionStore()
    for (const [id, startedAt] of [
      ['a', 1],
      ['b', 2]
    ] as const) {
      store.runningInstances.set(id, {
        installationId: id,
        installationName: id.toUpperCase(),
        mode: 'standalone',
        startedAt
      })
    }
    await nextTick()
    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    installation.value = makeInstall('a', 'A')
    await nextTick()
    await Promise.resolve()
    installation.value = makeInstall('b', 'B')
    await nextTick()
    await Promise.resolve()

    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)
    scope.stop()
  })

  it('writes the new value into sections optimistically before the IPC resolves', async () => {
    let resolveIpc: (() => void) | null = null
    const ipcPromise = new Promise<void>((r) => {
      resolveIpc = r
    })
    const updateInstallation = vi.fn().mockReturnValue(ipcPromise)
    const { composable, scope } = await mountWithField('a', 'window', { updateInstallation })

    markRunning('a')
    const updatePromise = composable.updateField(
      makeRestartField('launchMode', 'window'),
      'console'
    )

    await nextTick()
    const field = composable.sections.value[0]!.fields![0]!
    expect(field.value).toBe('console')
    expect(updateInstallation).toHaveBeenCalledWith('a', { launchMode: 'console' })

    resolveIpc!()
    await updatePromise
    scope.stop()
  })

  it('marks the field dirty when running, clears it when reverted to baseline', async () => {
    const { composable, scope } = await mountWithField('a', 'window')
    markRunning('a')

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    await composable.updateField(makeRestartField('launchMode', 'console'), 'window')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(false)
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    scope.stop()
  })

  it('does NOT mark dirty when the install is not running', async () => {
    const { composable, scope } = await mountWithField('a', 'window')
    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    scope.stop()
  })

  function markLaunching(id: string): void {
    useSessionStore().launchingInstances.set(id, { installationName: id.toUpperCase() })
  }

  it('marks dirty during the boot window and keeps it once the instance is running', async () => {
    const { composable, scope } = await mountWithField('a', 'window')
    markLaunching('a')
    await nextTick()

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    useSessionStore().launchingInstances.delete('a')
    markRunning('a')
    await nextTick()
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)
    scope.stop()
  })

  it('reverting a boot-window edit to baseline drops the pending state', async () => {
    const { composable, scope } = await mountWithField('a', 'window')
    markLaunching('a')
    await nextTick()

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    await composable.updateField(makeRestartField('launchMode', 'console'), 'window')
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    scope.stop()
  })

  it('clears boot-window edits when the launch fails (nothing left to apply while stopped)', async () => {
    const { composable, scope } = await mountWithField('a', 'window')
    markLaunching('a')
    await nextTick()

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    useSessionStore().launchingInstances.delete('a')
    await nextTick()
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    scope.stop()
  })

  it('clears pending state from a running session the moment a new launch begins', async () => {
    const { composable, scope } = await mountWithField('a', 'window')
    markRunning('a')

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    markLaunching('a')
    await nextTick()
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    scope.stop()
  })

  async function mountTwoInstalls() {
    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    const api = installMockApi({
      getDetailSections: vi.fn(() =>
        Promise.resolve([makeSectionWithField(makeRestartField('launchMode', 'window'))])
      )
    })
    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress: vi.fn() })
    })
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    return { composable, api, installation, scope }
  }

  async function selectInstall(installation: Ref<Installation | null>, id: string): Promise<void> {
    installation.value = makeInstall(id, id.toUpperCase())
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
  }

  it('clears boot-window edits when an off-screen install fails its launch', async () => {
    const { composable, installation, scope } = await mountTwoInstalls()
    markLaunching('a')
    await nextTick()
    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    await selectInstall(installation, 'b')
    useSessionStore().launchingInstances.delete('a')
    await nextTick()
    await selectInstall(installation, 'a')
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    scope.stop()
  })

  it('clears pending state when an off-screen running install stops', async () => {
    const { composable, installation, scope } = await mountTwoInstalls()
    markRunning('a')
    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    await selectInstall(installation, 'b')
    useSessionStore().runningInstances.delete('a')
    await nextTick()
    await selectInstall(installation, 'a')
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    scope.stop()
  })

  it('keeps the dirty state when the picker selection swaps to another install and back', async () => {
    const initialField = makeRestartField('launchMode', 'window')
    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    const api = installMockApi({
      getDetailSections: vi.fn((id: string) => {
        if (id === 'a') return Promise.resolve([makeSectionWithField(initialField)])
        if (id === 'b')
          return Promise.resolve([makeSectionWithField(makeRestartField('launchMode', 'window'))])
        return Promise.resolve([])
      })
    })
    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress: vi.fn() })
    })
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()

    markRunning('a')
    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    installation.value = makeInstall('b', 'B')
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(false)

    installation.value = makeInstall('a', 'A')
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)
    expect(api.getDetailSections).toHaveBeenCalled()
    scope.stop()
  })

  it('rolls back the optimistic write and surfaces an error pill when the IPC rejects', async () => {
    const updateInstallation = vi.fn().mockRejectedValue(new Error('boom'))
    const { composable, scope } = await mountWithField('a', 'window', { updateInstallation })
    markRunning('a')

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')

    const field = composable.sections.value[0]!.fields![0]!
    expect(field.value).toBe('window')
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    expect(composable.fieldErrorMessages.value.get('launchMode')).toBe('boom')
    scope.stop()
  })

  it('treats a 5s+ IPC stall as a timeout and rolls back with a timeout-flavoured message', async () => {
    vi.useFakeTimers()
    try {
      const updateInstallation = vi.fn().mockReturnValue(new Promise<void>(() => {}))
      const { composable, scope } = await mountWithField('a', 'window', { updateInstallation })
      markRunning('a')

      const updatePromise = composable.updateField(
        makeRestartField('launchMode', 'window'),
        'console'
      )
      await vi.advanceTimersByTimeAsync(5_001)
      await updatePromise

      const timeoutField = composable.sections.value[0]!.fields![0]!
      expect(timeoutField.value).toBe('window')
      expect(composable.pendingRestartFieldIds.value.size).toBe(0)
      expect(composable.fieldErrorMessages.value.get('launchMode')).toBe(
        "Couldn't reach app — try again"
      )
      scope.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the per-install dirty + error entries when the install transitions to not-running', async () => {
    const updateInstallation = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined)
    const { composable, scope } = await mountWithField('a', 'window', { updateInstallation })
    markRunning('a')

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.fieldErrorMessages.value.get('launchMode')).toBe('boom')

    await composable.updateField(makeRestartField('launchMode', 'window'), 'console')
    expect(composable.pendingRestartFieldIds.value.has('launchMode')).toBe(true)

    useSessionStore().runningInstances.delete('a')
    await nextTick()
    expect(composable.pendingRestartFieldIds.value.size).toBe(0)
    expect(composable.fieldErrorMessages.value.size).toBe(0)
    scope.stop()
  })

  it('considers envVars equal when keys and values match (revert clears dirty)', async () => {
    const initialField: DetailField = {
      id: 'envVars',
      label: 'envVars',
      value: { FOO: 'bar' } as DetailField['value'],
      editable: true,
      editType: 'env-vars',
      requiresRestart: true
    }
    const installation = ref<Installation | null>(makeInstall('a', 'A'))
    installMockApi({
      getDetailSections: vi.fn().mockResolvedValue([makeSectionWithField(initialField)])
    })
    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress: vi.fn() })
    })
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    markRunning('a')

    await composable.updateField(initialField, { FOO: 'bar', BAZ: 'qux' })
    expect(composable.pendingRestartFieldIds.value.has('envVars')).toBe(true)

    await composable.updateField(
      { ...initialField, value: { FOO: 'bar', BAZ: 'qux' } } as DetailField,
      {
        FOO: 'bar'
      }
    )
    expect(composable.pendingRestartFieldIds.value.has('envVars')).toBe(false)
    scope.stop()
  })
})

describe('useComfyUISettings — renameInstallation', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    dialogsSpies.alert.mockReset()
  })

  async function mountRename(api: MockApi) {
    const installation = ref<Installation | null>(makeInstall('a', 'Old Name'))
    const scope = effectScope()
    let composable!: ReturnType<typeof useComfyUISettings>
    scope.run(() => {
      composable = useComfyUISettings({ installation, onShowProgress: vi.fn() })
    })
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    return { composable, scope, api }
  }

  it('commits a fresh name, reloads sections, and resolves true', async () => {
    const api = installMockApi({ updateInstallation: vi.fn().mockResolvedValue({ ok: true }) })
    const { composable, scope } = await mountRename(api)
    api.getDetailSections.mockClear()

    const committed = await composable.renameInstallation('New Name')

    expect(committed).toBe(true)
    expect(api.updateInstallation).toHaveBeenCalledWith('a', { name: 'New Name' })
    expect(api.getDetailSections).toHaveBeenCalled()
    expect(dialogsSpies.alert).not.toHaveBeenCalled()
    scope.stop()
  })

  it('trims surrounding whitespace before committing', async () => {
    const api = installMockApi({ updateInstallation: vi.fn().mockResolvedValue({ ok: true }) })
    const { composable, scope } = await mountRename(api)

    await composable.renameInstallation('  Padded  ')

    expect(api.updateInstallation).toHaveBeenCalledWith('a', { name: 'Padded' })
    scope.stop()
  })

  it('is a no-op (no IPC) when the trimmed name is empty or unchanged', async () => {
    const api = installMockApi()
    const { composable, scope } = await mountRename(api)

    expect(await composable.renameInstallation('   ')).toBe(false)
    expect(await composable.renameInstallation('Old Name')).toBe(false)
    expect(api.updateInstallation).not.toHaveBeenCalled()
    scope.stop()
  })

  it('surfaces a rejection (duplicate name) as an alert and resolves false', async () => {
    const api = installMockApi({
      updateInstallation: vi.fn().mockResolvedValue({ ok: false, message: 'taken' })
    })
    const { composable, scope } = await mountRename(api)
    api.getDetailSections.mockClear()

    const committed = await composable.renameInstallation('Dupe')

    expect(committed).toBe(false)
    expect(dialogsSpies.alert).toHaveBeenCalledWith(expect.objectContaining({ message: 'taken' }))
    expect(api.getDetailSections).not.toHaveBeenCalled()
    scope.stop()
  })
})
