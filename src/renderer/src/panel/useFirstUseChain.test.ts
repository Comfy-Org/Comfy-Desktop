import { createTestingPinia } from '@pinia/testing'
import { stubWindowApi } from '../lib/stubWindowApi'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { ActionResult, FieldOption, ShowProgressOpts, Source } from '../types/ipc'
import { useProgressStore } from '../stores/progressStore'
import { emitTelemetryAction } from '../lib/telemetry'
import { useFirstUseChain, type FirstUseChainApi } from './useFirstUseChain'
import { __resetLauncherPrefsForTest } from '../composables/useLauncherPrefs'
import type { SetupPlan } from '../lib/setupPlan'

const modal = vi.hoisted(() => ({ confirm: vi.fn(), alert: vi.fn() }))
vi.mock('../composables/useModal', () => ({ useModal: () => modal }))

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toErrorBucket: vi.fn(),
  toVariantBucket: (id?: string) => (id ? id.replace(/^(win|mac|linux)-/, '') : 'unknown')
}))

const standaloneSource: Source = {
  id: 'standalone',
  label: 'Standalone',
  fields: [
    { id: 'release', label: 'Release', type: 'select' },
    { id: 'variant', label: 'Variant', type: 'select' }
  ]
}

const recommendedRelease: FieldOption = {
  value: 'v1.0.0',
  label: 'v1.0.0',
  recommended: true
}
const fallbackRelease: FieldOption = { value: 'v0.9.0', label: 'v0.9.0' }
const recommendedVariant: FieldOption = {
  value: 'nvidia',
  label: 'NVIDIA',
  recommended: true,
  data: { variantId: 'nvidia-cuda' }
}

function setupPlan(): SetupPlan {
  return {
    sourceId: 'standalone',
    selections: { release: recommendedRelease, variant: recommendedVariant },
    installRoot: '/Users/test/ComfyUI',
    downloadBytes: 1024 ** 3,
    requiredBytes: 2.25 * 1024 ** 3
  }
}

interface TestApi {
  getDiskSpace: ReturnType<typeof vi.fn>
  validateHardware: ReturnType<typeof vi.fn>
  getDefaultInstallDir: ReturnType<typeof vi.fn>
  getSources: ReturnType<typeof vi.fn>
  getFieldOptions: ReturnType<typeof vi.fn>
  buildInstallation: ReturnType<typeof vi.fn>
  getUniqueName: ReturnType<typeof vi.fn>
  addInstallation: ReturnType<typeof vi.fn>
  installInstance: ReturnType<typeof vi.fn>
  setFirstUseMode: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
  getSetting: ReturnType<typeof vi.fn>
  getInstallations: ReturnType<typeof vi.fn>
  onInstallationsChanged: ReturnType<typeof vi.fn>
  onInstallationsVersionsUpdated: ReturnType<typeof vi.fn>
  onFirstUseSkip: ReturnType<typeof vi.fn>
  onErrorDetail: ReturnType<typeof vi.fn>
  onInstallProgress: ReturnType<typeof vi.fn>
  onComfyOutput: ReturnType<typeof vi.fn>
}

function buildApi(overrides: Partial<TestApi> = {}): TestApi {
  return {
    getDiskSpace: vi.fn().mockResolvedValue({ free: 400 * 1024 ** 3, total: 1000 * 1024 ** 3 }),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getDefaultInstallDir: vi.fn().mockResolvedValue('/Users/test/ComfyUI'),
    getSources: vi.fn().mockResolvedValue([standaloneSource]),
    getFieldOptions: vi.fn().mockImplementation((_sourceId: string, fieldId: string) => {
      if (fieldId === 'release') return Promise.resolve([recommendedRelease, fallbackRelease])
      if (fieldId === 'variant') return Promise.resolve([recommendedVariant])
      return Promise.resolve([])
    }),
    buildInstallation: vi
      .fn()
      .mockResolvedValue({ sourceId: 'standalone', sourceCategory: 'local' }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    addInstallation: vi
      .fn()
      .mockResolvedValue({ ok: true, entry: { id: 'inst-express-1', name: 'ComfyUI' } }),
    installInstance: vi.fn().mockResolvedValue(undefined),
    setFirstUseMode: vi.fn(),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(undefined),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(),
    onInstallationsVersionsUpdated: vi.fn(),
    onFirstUseSkip: vi.fn().mockReturnValue(() => {}),
    onErrorDetail: vi.fn().mockReturnValue(() => {}),
    onInstallProgress: vi.fn().mockReturnValue(() => {}),
    onComfyOutput: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
}

interface MountedChain {
  api: FirstUseChainApi | null
  handleShowProgress: ReturnType<typeof vi.fn>
  switchPanel: ReturnType<typeof vi.fn>
  dismissTakeoverDirect: ReturnType<typeof vi.fn>
  performChooserLaunch: ReturnType<typeof vi.fn>
  openFirstUseTakeover: ReturnType<typeof vi.fn>
  resetFirstUseSpinner: ReturnType<typeof vi.fn>
}

function mountChain(): MountedChain {
  const handleShowProgress = vi.fn().mockResolvedValue(undefined)
  const switchPanel = vi.fn().mockResolvedValue(undefined)
  const dismissTakeoverDirect = vi.fn()
  const performChooserLaunch = vi.fn().mockResolvedValue('launched')
  const openFirstUseTakeover = vi.fn().mockResolvedValue(undefined)
  const resetFirstUseSpinner = vi.fn()

  const apiRef: Ref<FirstUseChainApi | null> = ref(null)

  const TestHost = defineComponent({
    setup() {
      apiRef.value = useFirstUseChain({
        handleShowProgress,
        switchPanel,
        dismissTakeoverDirect,
        performChooserLaunch,
        openFirstUseTakeover,
        resetFirstUseSpinner
      })
      return () => h('div')
    }
  })

  mount(TestHost)

  return {
    api: apiRef.value,
    handleShowProgress,
    switchPanel,
    dismissTakeoverDirect,
    performChooserLaunch,
    openFirstUseTakeover,
    resetFirstUseSpinner
  }
}

describe('useFirstUseChain — Set up', () => {
  let testApi: TestApi

  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    testApi = buildApi()
    stubWindowApi(testApi)
    vi.clearAllMocks()
    vi.mocked(modal.confirm).mockResolvedValue(true)
    vi.mocked(modal.alert).mockResolvedValue(undefined)
    __resetLauncherPrefsForTest()
  })

  it('creates the build Set up showed and hands its install off with the express flag', async () => {
    const chain = mountChain()
    await chain.api!.handleSetupInstall(setupPlan())

    expect(testApi.buildInstallation).toHaveBeenCalledWith('standalone', {
      release: recommendedRelease,
      variant: recommendedVariant
    })
    expect(testApi.addInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ComfyUI',
        installPath: '/Users/test/ComfyUI',
        sourceId: 'standalone',
        status: 'installing'
      })
    )
    const showOpts = chain.handleShowProgress.mock.calls[0]![0] as ShowProgressOpts
    expect(showOpts).toMatchObject({ installationId: 'inst-express-1', opKind: 'install' })
    await showOpts.apiCall()
    expect(testApi.installInstance).toHaveBeenCalledWith('inst-express-1', true)
    expect(vi.mocked(emitTelemetryAction)).toHaveBeenCalledWith(
      'comfy.desktop.install.dispatched',
      expect.objectContaining({
        installation_id: 'inst-express-1',
        variant: 'nvidia-cuda',
        express: true,
        entrypoint: 'first_use'
      })
    )
  })

  it('finishes first use once the install runs in the background', async () => {
    const chain = mountChain()
    await chain.api!.handleSetupInstall(setupPlan())
    chain.api!.hooks.onBackgroundInstall()
    await vi.waitFor(() => {
      expect(testApi.setSetting).toHaveBeenCalledWith('firstUseCompleted', true)
      expect(testApi.setFirstUseMode).toHaveBeenLastCalledWith('none')
    })
  })

  it('asks before installing onto a disk that is too small, and stays on Set up when declined', async () => {
    testApi.getDiskSpace = vi.fn().mockResolvedValue({ free: 1024 ** 3, total: 2 * 1024 ** 3 })
    stubWindowApi(testApi)
    vi.mocked(modal.confirm).mockResolvedValue(false)

    const chain = mountChain()
    await chain.api!.handleSetupInstall(setupPlan())

    expect(modal.confirm).toHaveBeenCalledTimes(1)
    expect(testApi.addInstallation).not.toHaveBeenCalled()
    expect(chain.handleShowProgress).not.toHaveBeenCalled()
    expect(chain.resetFirstUseSpinner).toHaveBeenCalled()
  })

  it('explains a build that cannot be added and stays on Set up', async () => {
    testApi.addInstallation = vi.fn().mockResolvedValue({ ok: false, message: 'path conflict' })
    stubWindowApi(testApi)

    const chain = mountChain()
    await chain.api!.handleSetupInstall(setupPlan())

    expect(modal.alert).toHaveBeenCalledWith(expect.objectContaining({ message: 'path conflict' }))
    expect(chain.handleShowProgress).not.toHaveBeenCalled()
    expect(chain.resetFirstUseSpinner).toHaveBeenCalled()
  })

  it('opens every install option from Change, with a way back to Set up', async () => {
    const chain = mountChain()
    await chain.api!.handleSetupChange()

    expect(chain.switchPanel).toHaveBeenCalledWith('new-install', 'first_use')
    expect(testApi.setFirstUseMode).toHaveBeenCalledWith('post-consent')
    expect(chain.api!.hooks.consumeCameFromSetup()).toBe(true)
    expect(chain.api!.hooks.consumeCameFromSetup()).toBe(false)

    await chain.api!.handleNewInstallBackToSetup()
    expect(chain.openFirstUseTakeover).toHaveBeenCalledTimes(1)
  })
})

describe('useFirstUseChain — chainSpan stamping', () => {
  let testApi: TestApi

  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    testApi = buildApi()
    stubWindowApi(testApi)
    vi.clearAllMocks()
  })

  function progressOpts(
    installationId: string,
    extra: Partial<ShowProgressOpts> = {}
  ): ShowProgressOpts {
    return {
      installationId,
      title: `Installing — ${installationId}`,
      apiCall: () => Promise.resolve({ ok: true } as ActionResult) as Promise<unknown>,
      ...extra
    }
  }

  it('stamps chainSpan=install when the first-use chain captures a takeover op', async () => {
    const chain = mountChain()
    await chain.api!.handleSetupChange()

    const showOpts = progressOpts('inst-chain-1')
    chain.api!.hooks.onShowProgress(showOpts)
    expect(showOpts.chainSpan).toBe('install')
  })

  it('stamps chainSpan=install when an autoLaunchOnFinish op begins (non-first-use entry point)', () => {
    const chain = mountChain()
    const opts = progressOpts('inst-auto-1', { autoLaunchOnFinish: true })
    chain.api!.hooks.onShowProgress(opts)
    expect(opts.chainSpan).toBe('install')
  })

  it('does not stamp chainSpan on a plain standalone op', () => {
    const chain = mountChain()
    const opts = progressOpts('inst-plain-1')
    chain.api!.hooks.onShowProgress(opts)
    expect(opts.chainSpan).toBeUndefined()
  })

  it('stamps chainSpan=launch when the auto-launch watcher fires the chained launch leg', async () => {
    const chain = mountChain()
    let resolveLaunch: (v: unknown) => void = () => {}
    chain.performChooserLaunch.mockReturnValue(
      new Promise((res) => {
        resolveLaunch = res
      })
    )

    const progressStore = useProgressStore()
    const installationStore = (await import('../stores/installationStore')).useInstallationStore()
    installationStore.installations = [
      {
        id: 'inst-chained-1',
        name: 'ComfyUI',
        sourceCategory: 'local',
        sourceId: 'standalone',
        createdAt: new Date().toISOString()
      } as never
    ]

    const installOpts = progressOpts('inst-chained-1', { autoLaunchOnFinish: true })
    chain.api!.hooks.onShowProgress(installOpts)
    expect(installOpts.chainSpan).toBe('install')

    progressStore.startOperation({
      installationId: 'inst-chained-1',
      title: 'Installing',
      apiCall: () => Promise.resolve({ ok: true } as ActionResult)
    })
    const op = progressStore.operations.get('inst-chained-1')!
    op.finished = true
    op.result = { ok: true }
    await vi.waitFor(() => expect(chain.performChooserLaunch).toHaveBeenCalledTimes(1))

    const launchOpts = progressOpts('inst-chained-1', { triggersInstanceStart: true })
    chain.api!.hooks.onShowProgress(launchOpts)
    expect(launchOpts.chainSpan).toBe('launch')

    resolveLaunch('launched')
    await Promise.resolve()
    await Promise.resolve()
    const unrelated = progressOpts('inst-other')
    chain.api!.hooks.onShowProgress(unrelated)
    expect(unrelated.chainSpan).toBeUndefined()
  })

  it('clears pendingChainedLaunch via the watcher .finally() when performChooserLaunch resolves', async () => {
    const chain = mountChain()
    chain.performChooserLaunch.mockResolvedValue('missing-action')

    const progressStore = useProgressStore()
    const installationStore = (await import('../stores/installationStore')).useInstallationStore()
    installationStore.installations = [
      {
        id: 'inst-noop-1',
        name: 'ComfyUI',
        sourceCategory: 'local',
        sourceId: 'standalone',
        createdAt: new Date().toISOString()
      } as never
    ]

    chain.api!.hooks.onShowProgress(progressOpts('inst-noop-1', { autoLaunchOnFinish: true }))
    progressStore.startOperation({
      installationId: 'inst-noop-1',
      title: 'Installing',
      apiCall: () => Promise.resolve({ ok: true } as ActionResult)
    })
    const op = progressStore.operations.get('inst-noop-1')!
    op.finished = true
    op.result = { ok: true }
    await nextTick()
    await vi.waitFor(() => expect(chain.performChooserLaunch).toHaveBeenCalled())
    await Promise.resolve()
    await Promise.resolve()

    const after = progressOpts('inst-after-missing')
    chain.api!.hooks.onShowProgress(after)
    expect(after.chainSpan).toBeUndefined()
  })
})
