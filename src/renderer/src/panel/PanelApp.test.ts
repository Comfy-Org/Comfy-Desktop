import { beforeEach, describe, expect, it, vi } from 'vitest'

const installWizardOpen = vi.hoisted(() => vi.fn())

vi.mock('../main', () => ({
  i18n: {
    global: { t: (key: string) => key }
  }
}))

vi.mock('../composables/useTheme', () => ({ useTheme: () => ({ theme: 'dark' }) }))
/** Test-controllable `useModal` mock. Each call returns the same
 *  shared singleton so tests can stub return values per case via
 *  `mockModal.confirm.mockResolvedValueOnce(true)` etc. */
const mockModal = {
  alert: vi.fn(),
  confirm: vi.fn(),
  close: vi.fn()
}
vi.mock('../composables/useModal', () => ({
  useModal: () => mockModal
}))

// Stub the heavy children so we can assert which sub-panel is rendered.
vi.mock('../views/DetailModal.vue', () => ({
  default: {
    name: 'DetailModal',
    // DetailModal has no `inline` prop — it renders one way and the
    // parent owns the close behaviour.
    props: ['installation', 'initialTab', 'autoAction'],
    template: '<div data-testid="detail-modal" :data-installation-id="installation?.id" />'
  }
}))
vi.mock('../views/ProgressModal.vue', () => ({
  default: {
    name: 'ProgressModal',
    props: ['installationId'],
    template: '<div data-testid="progress-modal" />',
    methods: { startOperation: vi.fn(), showOperation: vi.fn() }
  }
}))
vi.mock('../components/ModalDialog.vue', () => ({
  default: { name: 'ModalDialog', template: '<div />' }
}))
// Modal teleports its slot to <body>; replace with a transparent
// pass-through so wrapper.find() can still see the slotted children.
vi.mock('../components/Modal.vue', () => ({
  default: {
    name: 'Modal',
    props: ['binding', 'opacity', 'width', 'contentClass', 'inline'],
    template: '<div data-testid="modal-stub"><slot /></div>'
  }
}))
vi.mock('./ComfyLifecycleView.vue', () => ({
  default: {
    name: 'ComfyLifecycleView',
    props: ['installation', 'installationId'],
    template: '<div data-testid="comfy-lifecycle" :data-installation-id="installationId" />'
  }
}))
vi.mock('../views/ChooserView.vue', () => ({
  default: {
    name: 'ChooserView',
    emits: ['pick', 'show-new-install'],
    template:
      '<div data-testid="chooser-view"><button data-testid="chooser-new-install" @click="$emit(\'show-new-install\', \'workspace-1\')">New</button></div>'
  }
}))
vi.mock('../views/InstallWizardModal.vue', () => ({
  default: {
    name: 'InstallWizardModal',
    emits: ['close', 'navigate-list', 'show-progress'],
    template: '<div data-testid="new-install-modal" />',
    methods: { open: installWizardOpen }
  }
}))
vi.mock('../views/TrackModal.vue', () => ({
  default: {
    name: 'TrackModal',
    emits: ['close', 'navigate-list'],
    template: '<div data-testid="track-modal" />',
    methods: { open: vi.fn() }
  }
}))
vi.mock('../views/LoadSnapshotModal.vue', () => ({
  default: {
    name: 'LoadSnapshotModal',
    emits: ['close', 'show-progress'],
    template: '<div data-testid="load-snapshot-modal" />',
    methods: { open: vi.fn() }
  }
}))
vi.mock('../views/QuickInstallModal.vue', () => ({
  default: {
    name: 'QuickInstallModal',
    emits: ['close', 'show-progress'],
    template: '<div data-testid="quick-install-modal" />',
    methods: { open: vi.fn() }
  }
}))
vi.mock('../views/FirstUseTakeover.vue', () => ({
  default: {
    name: 'FirstUseTakeover',
    emits: ['close', 'complete-cloud', 'complete-skip', 'chain-local', 'chain-migrate'],
    // Stub does NOT auto-call window.api.getLocale on mount — the host
    // exercises the imperative open() reset post-mount, which is what
    // we mock + assert on.
    template:
      '<div data-testid="first-use-takeover">' +
      '<button data-testid="first-use-cloud" @click="$emit(\'complete-cloud\')">Cloud</button>' +
      '<button data-testid="first-use-skip" @click="$emit(\'complete-skip\')">Skip</button>' +
      '<button data-testid="first-use-local" @click="$emit(\'chain-local\')">Local</button>' +
      '<button data-testid="first-use-close" @click="$emit(\'close\')">Close</button>' +
      '</div>',
    methods: { open: vi.fn() }
  }
}))
vi.mock('../views/MigrateConfirmTakeover.vue', () => ({
  default: {
    name: 'MigrateConfirmTakeover',
    emits: ['close'],
    template: '<div data-testid="migrate-confirm-takeover" />',
    methods: { open: vi.fn() }
  }
}))
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import PanelApp from './PanelApp.vue'
import { __resetLauncherPrefsForTest } from '../composables/useLauncherPrefs'
import { useOverlay } from '../composables/useOverlay'
import { TELEMETRY_ACTION_EVENT_NAME, type TelemetryActionEventDetail } from '../lib/telemetry'

const messages = {
  en: {
    titleBar: {
      panelComfy: 'ComfyUI',
      panelInstallSettings: 'Instance Settings',
      panelLauncherSettings: 'Launcher Settings',
      installSettingsComingSoon: 'Coming soon',
      installationLabel: 'Instance'
    },
    common: {
      loading: 'Loading…'
    },
    settings: {
      logs: 'Logs'
    },
    performanceTest: {
      description: 'Run performance tests against your ComfyUI instances.',
      selectInstance: '1. Select an instance',
      workspaceLabel: 'Workspace',
      instanceLabel: 'Instance',
      selectInstancePlaceholder: 'Select an instance',
      dropWorkflow: '2. Drop a workflow in API format',
      dropWorkflowHint: 'Drop a workflow .json file here, or click to browse',
      importingWorkflow: 'Importing workflow...',
      importFailed: 'Could not import the workflow.',
      deleteWorkflow: 'Delete workflow',
      deleteFailed: 'Could not delete the workflow.',
      run: 'Run',
      stop: 'Stop',
      stopping: 'Stopping...',
      stopFailed: 'Could not stop the instance.',
      measurementSettings: '3. Set measurements settings',
      warmupRuns: 'Warm-up runs',
      measuredRuns: 'Measured runs',
      logsPlaceholder: 'Instance logs will appear here.',
      results: 'Results',
      resultsPlaceholder: 'Performance test results will appear here.',
      fastestRun: 'Fastest run',
      slowestRun: 'Slowest run',
      averageRunDuration: 'Average run',
      medianRunDuration: 'Median run',
      measuredRunCount: 'Measured runs',
      runDurationChart: 'Run duration aggregates',
      device: 'Compute device',
      vram: 'VRAM',
      ram: 'RAM',
      pytorchVersion: 'PyTorch version',
      xformersVersion: 'xFormers version',
      systemInformation: 'System information',
      cpu: 'CPU',
      cpuCores: 'CPU cores',
      operatingSystem: 'Operating system',
      architecture: 'Architecture',
      openResultsFolder: 'Open folder',
      imageTitle: 'Performance test results',
      exportResultsImage: 'Export results',
      exportingImage: 'Exporting image...',
      exportImageFailed: 'Could not export the results image.',
      running: 'Running...',
      launchFailed: 'Failed to start the instance.',
      submittingRuns: 'Submitting {warmupCount} warm-up runs and {count} measured runs...',
      completedRuns:
        'Finished {count} measured runs ({unsuccessful} unsuccessful). Final response saved to {path}',
      submitFailed: 'Failed to submit the performance test workflow.'
    },
    benchmarks: {
      description: 'Compare performance tests'
    }
  }
}

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages })
}

interface InstallationLike {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  sourceId?: string
  workspaceId?: string
  status?: string
  version?: string
  statusTag?: { style: string; label: string; detail?: string }
}

type PanelTriggerPayload = {
  kind:
    | 'install-update'
    | 'app-update-restart-prompt'
    | 'app-update-download-prompt'
    | 'picker-pick-install'
  installationId?: string
  version?: string | null
  isRestart?: boolean
}

interface MockApiState {
  panelSwitchCallbacks: ((data: { panel: string; installationId?: string }) => void)[]
  panelTriggerOverlayCallbacks: ((data: PanelTriggerPayload) => void)[]
  appUpdatePromptRestartCallbacks: ((data: { version: string }) => void)[]
  appUpdateUserActionFailedCallbacks: ((data: { message: string }) => void)[]
  installationsChangedCallbacks: (() => void)[]
  /** File-menu Skip Onboarding callbacks. Main fires this when the
   *  user clicks the entry in the waffle popup; tests can simulate
   *  the click by invoking each callback. */
  firstUseSkipCallbacks: (() => void)[]
  /** Feedback callbacks. Main fires this when the user clicks the
   *  title-bar Send Feedback button or the file-menu "Send Feedback"
   *  entry; tests can simulate the click by invoking each callback
   *  with the originating `source`. */
  openFeedbackCallbacks: ((data: { source: 'titlebar' | 'menu' }) => void)[]
  /** Window-close consult callbacks. Main fires `comfy-window:request-close`
   *  when the user clicks the ✕; tests fire each callback to simulate that. */
  closeRequestCallbacks: ((data: { requestId: string }) => void)[]
  installations: InstallationLike[]
  getInstallations: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
  getAppVersion: ReturnType<typeof vi.fn>
  /** Per-key getSetting values. Tests that need first-use takeover to
   *  auto-mount can flip `firstUseCompleted` to false here. Default is
   *  `true` so existing tests don't trip the takeover. */
  settings: Record<string, unknown>
  installUpdate: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
}

function installMockApi(initial?: {
  installations?: InstallationLike[]
  settings?: Record<string, unknown>
}): MockApiState {
  const installations: InstallationLike[] = initial?.installations ?? []
  const state: MockApiState = {
    panelSwitchCallbacks: [],
    panelTriggerOverlayCallbacks: [],
    appUpdatePromptRestartCallbacks: [],
    appUpdateUserActionFailedCallbacks: [],
    installationsChangedCallbacks: [],
    firstUseSkipCallbacks: [],
    openFeedbackCallbacks: [],
    closeRequestCallbacks: [],
    installations,
    getInstallations: vi.fn(async () => state.installations),
    openExternal: vi.fn(async () => {}),
    getAppVersion: vi.fn(async () => '0.5.0'),
    settings: { firstUseCompleted: true, ...initial?.settings },
    installUpdate: vi.fn(async () => {}),
    downloadUpdate: vi.fn(async () => {})
  }
  const api = {
    getLocaleMessages: vi.fn().mockResolvedValue(messages.en),
    getLocale: vi.fn().mockResolvedValue('en'),
    onLocaleChanged: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn(async () => ({
        signedIn: true,
        workspaceId: 'workspace-1',
        workspaceName: 'Workspace One',
        workspaceType: 'team'
      })),
      signIn: vi.fn(async () => ({ signedIn: true })),
      signOut: vi.fn(async () => ({ signedIn: false })),
      listWorkspaces: vi.fn(async () => []),
      listBuilds: vi.fn(async () => []),
      switchWorkspace: vi.fn(async () => ({ signedIn: true })),
      onAuthChanged: vi.fn(() => () => {})
    },
    onPanelSwitch: vi.fn((cb: (d: { panel: string; installationId?: string }) => void) => {
      state.panelSwitchCallbacks.push(cb)
      return () => {}
    }),
    onPanelTriggerOverlay: vi.fn((cb: (d: PanelTriggerPayload) => void) => {
      state.panelTriggerOverlayCallbacks.push(cb)
      return () => {}
    }),
    onAppUpdatePromptRestart: vi.fn((cb: (d: { version: string }) => void) => {
      state.appUpdatePromptRestartCallbacks.push(cb)
      return () => {}
    }),
    onAppUpdateUserActionFailed: vi.fn((cb: (d: { message: string }) => void) => {
      state.appUpdateUserActionFailedCallbacks.push(cb)
      return () => {}
    }),
    installUpdate: state.installUpdate,
    downloadUpdate: state.downloadUpdate,
    setFirstUseMode: vi.fn(),
    closeCurrentPanel: vi.fn(),
    onFirstUseSkip: vi.fn((cb: () => void) => {
      state.firstUseSkipCallbacks.push(cb)
      return () => {}
    }),
    onOpenFeedback: vi.fn((cb: (data: { source: 'titlebar' | 'menu' }) => void) => {
      state.openFeedbackCallbacks.push(cb)
      return () => {}
    }),
    onOpenAnnouncement: vi.fn(() => () => {}),
    openExternal: state.openExternal,
    getAppVersion: state.getAppVersion,
    onSettingsChanged: vi.fn(() => () => {}),
    // Main consults the panel renderer before tearing down the host
    // window. PanelApp subscribes on mount; tests can fire the consult
    // by invoking each captured callback with a `requestId`.
    onCloseRequest: vi.fn((cb: (d: { requestId: string }) => void) => {
      state.closeRequestCallbacks.push(cb)
      return () => {}
    }),
    respondCloseRequest: vi.fn(),
    ackCloseRequest: vi.fn(),
    // Symmetric mock pair for the File menu's Return to Dashboard consult.
    onReturnToDashboardRequest: vi.fn(() => () => {}),
    respondReturnToDashboardRequest: vi.fn(),
    ackReturnToDashboardRequest: vi.fn(),
    // Title-bar Settings icon → main routes a drawer-close request here
    // so the ComfyUISettingsPanel can play its leave animation before
    // closeCurrentPanel collapses the panelView. The test suite never
    // fires it; mock is a no-op.
    onRequestCloseDrawer: vi.fn(() => () => {}),
    onInstallationsChanged: vi.fn((cb: () => void) => {
      state.installationsChangedCallbacks.push(cb)
      return () => {}
    }),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getInstallations: state.getInstallations,
    getRunningInstances: vi.fn().mockResolvedValue([]),
    onInstanceLaunching: vi.fn(() => () => {}),
    onInstanceLaunchFailed: vi.fn(() => () => {}),
    onInstanceStarted: vi.fn(() => () => {}),
    onInstanceStopped: vi.fn(() => () => {}),
    onInstanceStopping: vi.fn(() => () => {}),
    stopComfyUI: vi.fn(async () => {}),
    cancelOperation: vi.fn(async () => {}),
    onComfyOutput: vi.fn(() => () => {}),
    onComfyExited: vi.fn(() => () => {}),
    onInstanceCrashed: vi.fn(() => () => {}),
    onAdoptPrompt: vi.fn(() => () => {}),
    ackAdoptPrompt: vi.fn(),
    respondAdoptPrompt: vi.fn(),
    onErrorDetail: vi.fn(() => () => {}),
    getSetting: vi.fn(async (key: string) => state.settings[key]),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      state.settings[key] = value
    }),
    // PanelApp's first-use takeover host fetches the categorised
    // install state to decide whether to skip the cloud-vs-local
    // pick step. Default mock is "fresh user" — no prior installs,
    // no legacy desktop — so the takeover advances through every
    // step.
    getFirstUseState: vi.fn(async () => ({ skipPick: false, hasLegacyDesktop: false })),
    // Cloud-pick auto-launch fans out into the chooser-launch pipeline:
    // claim the host for in-place attach, look up the install's launch
    // action, then execute it. Mocking the IPC surface lets the new
    // `complete-skip` test assert these are NEVER called (returning
    // users must NOT be teleported into Cloud they didn't pick) while
    // the existing `complete-cloud` test continues to dismiss cleanly
    // when no cloud install is present in the store.
    claimAttachHost: vi.fn(async () => true),
    releaseAttachHostPreview: vi.fn(async () => true),
    transferHostBoundsToInstall: vi.fn(async () => {}),
    closeHostWindow: vi.fn(async () => {}),
    focusComfyWindow: vi.fn(async () => {}),
    getListActions: vi.fn(async () => []),
    runAction: vi.fn(async () => ({ ok: true })),
    // Picker thumbnail warm-up fetches the bundled-template options on the
    // first-use cold-start path; returning users must never trigger it.
    getFieldOptions: vi.fn(async () => []),
    getPathForFile: vi.fn((file: File) => `C:\\incoming\\${file.name}`),
    importPerformanceTestWorkflow: vi.fn(async () => ({
      ok: true,
      filePath: 'C:\\ComfyUI\\performance-tests\\20260907225500\\cat-workflow.json'
    })),
    deletePerformanceTestWorkflow: vi.fn(async () => ({ ok: true })),
    runPerformanceTestWorkflow: vi.fn(
      async (_sessionId: string, _filePath: string, measuredRuns: number, warmupRuns: number) => ({
        ok: true,
        submitted: measuredRuns,
        preparationRuns: warmupRuns,
        totalSubmitted: measuredRuns + warmupRuns,
        promptIds: Array.from(
          { length: measuredRuns + warmupRuns },
          (_, index) => `prompt-${index + 1}`
        ),
        resultPath: 'C:\\ComfyUI\\performance-tests\\20260907225600\\results.json',
        unsuccessfulJobs: 0,
        statistics: {
          fastest: { jobId: 'prompt-3', durationSeconds: 1.25 },
          slowest: { jobId: 'prompt-7', durationSeconds: 2.75 },
          averageDurationSeconds: 2,
          medianDurationSeconds: 1.875,
          measuredJobCount: measuredRuns
        },
        hardware: {
          deviceType: 'cuda',
          deviceIndex: 0,
          deviceName: 'Top-level fallback should not be displayed',
          backend: 'native',
          devices: [
            {
              deviceType: 'cuda',
              deviceIndex: 0,
              deviceName: 'NVIDIA GeForce RTX 4090',
              backend: 'native'
            }
          ],
          vramMb: 24576,
          ramMb: 65461,
          pytorchVersion: '2.10.0+cu130',
          xformersVersion: '0.0.31',
          cudaDeviceSet: 0
        },
        systemInfo: {
          gpu_vendor: 'nvidia',
          gpu_label: 'NVIDIA',
          gpu_model: 'NVIDIA GeForce RTX 4090',
          gpu_vram_mb: 24576,
          gpu_vram_gb: 24,
          gpu_tier: 'high',
          gpus: [],
          nvidia_driver_version: '580.88',
          nvidia_driver_supported: true,
          amd_driver_version: null,
          intel_driver_version: null,
          platform: 'win32',
          arch: 'x64',
          os_version: '10.0.26200',
          os_distro: 'Microsoft Windows 11 Pro',
          os_release: '10.0.26200',
          os_arch: '64-bit',
          electron_version: '37.2.3',
          chrome_version: '138.0.7204.100',
          total_memory_gb: 64,
          cpu_model: 'AMD Ryzen 9 7950X',
          cpu_cores: 32,
          cpu_physical_cores: 16,
          cpu_speed_ghz: 4.5,
          cpu_manufacturer: 'AMD',
          app_version: '1.0.47',
          auto_update: true,
          locale: 'en',
          installation_count: 1,
          installations: []
        }
      })
    ),
    openPath: vi.fn(async () => {}),
    exportPerformanceTestResultsImage: vi.fn(async () => ({
      ok: true,
      filePath: 'C:\\Exports\\performance-test-results.svg'
    })),
    openGlobalSettings: vi.fn(),
    openInstancePicker: vi.fn()
  }
  ;(window as unknown as { api: typeof api }).api = api
  return state
}

function mountPanel() {
  return mount(PanelApp, {
    global: { plugins: [createTestI18n(), createPinia()] }
  })
}

const SAMPLE_INSTALL: InstallationLike = {
  id: 'test-id',
  name: 'Test Install',
  sourceLabel: 'Standalone',
  sourceCategory: 'local'
}

describe('PanelApp', () => {
  let mockState: MockApiState

  beforeEach(() => {
    setActivePinia(createPinia())
    // useLauncherPrefs has module-level shared state + memoized load
    // promise — reset both so each test sees a fresh load against the
    // current mock settings (in particular `firstUseCompleted`).
    __resetLauncherPrefsForTest()
    // useOverlay's slot is also a module-level singleton — clear it
    // so test order doesn't leak overlays between cases.
    useOverlay().current.value = null
    mockModal.alert.mockReset()
    mockModal.confirm.mockReset()
    mockModal.close.mockReset()
    mockState = installMockApi({ installations: [SAMPLE_INSTALL] })
    // Default URL — individual tests override.
    // `firstUseCompleted=true` short-circuits `seedLauncherPrefsFromUrl`
    // so `showPanelBody` returns synchronously on mount (without waiting
    // for the async `getSetting` IPC). Tests asserting the first-use
    // gating path (where the takeover should mount) override the URL
    // back to one without this param and flip `mockState.settings.firstUseCompleted`.
    window.history.replaceState({}, '', '/?installationId=test-id&firstUseCompleted=true')
  })

  it('renders the comfy-lifecycle body by default for install-backed hosts', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="comfy-lifecycle"]').exists()).toBe(true)
  })

  it('ignores unknown panel keys from onPanelSwitch', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="comfy-lifecycle"]').exists()).toBe(true)

    mockState.panelSwitchCallbacks.forEach((cb) => cb({ panel: 'not-a-real-panel' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="comfy-lifecycle"]').exists()).toBe(true)
  })

  it('refetches the installation when onInstallationsChanged fires', async () => {
    window.history.replaceState({}, '', '/?installationId=test-id&firstUseCompleted=true')
    mountPanel()
    await flushPromises()
    expect(mockState.getInstallations).toHaveBeenCalledTimes(1)

    mockState.installations = [{ ...SAMPLE_INSTALL, name: 'Renamed Install' }]
    expect(mockState.installationsChangedCallbacks.length).toBeGreaterThan(0)
    mockState.installationsChangedCallbacks.forEach((cb) => cb())
    await flushPromises()

    expect(mockState.getInstallations).toHaveBeenCalledTimes(2)
  })

  it('renders the comfy-lifecycle view when initialised with that panel', async () => {
    // Main initialises panel.html with `panel=comfy-lifecycle` when the
    // Comfy tab body needs to show the lifecycle UI (instance not running).
    window.history.replaceState(
      {},
      '',
      '/?installationId=test-id&panel=comfy-lifecycle&firstUseCompleted=true'
    )
    const wrapper = mountPanel()
    await flushPromises()
    const lifecycle = wrapper.find('[data-testid="comfy-lifecycle"]')
    expect(lifecycle.exists()).toBe(true)
    expect(lifecycle.attributes('data-installation-id')).toBe('test-id')
  })

  it('renders the benchmarks body with its branded introduction', async () => {
    window.history.replaceState({}, '', '/?panel=benchmarks&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('[data-testid="benchmarks"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="benchmarks-logo"]').exists()).toBe(true)
    expect(wrapper.get('.benchmarks__description').text()).toBe('Compare performance tests')
  })

  it('renders the performance test body with scoped instance rows', async () => {
    mockState.installations = [
      {
        ...SAMPLE_INSTALL,
        id: 'workspace-install',
        name: 'Workspace Install',
        sourceId: 'standalone',
        status: 'installed',
        version: '0.3.50',
        statusTag: { style: 'update', label: 'Update to 0.3.51' },
        workspaceId: 'workspace-1'
      },
      {
        ...SAMPLE_INSTALL,
        id: 'migrate-install',
        name: 'Legacy Install',
        sourceId: 'legacy-desktop',
        sourceCategory: 'local',
        status: 'installed',
        statusTag: { style: 'migrate', label: 'Migrate' },
        workspaceId: 'workspace-1'
      },
      {
        ...SAMPLE_INSTALL,
        id: 'danger-install',
        name: 'Missing Install',
        sourceId: 'standalone',
        sourceCategory: 'local',
        status: 'installed',
        statusTag: {
          style: 'danger',
          label: 'Folder Not Found',
          detail: 'The instance folder could not be found.'
        },
        workspaceId: 'workspace-1'
      },
      {
        ...SAMPLE_INSTALL,
        id: 'other-workspace-install',
        name: 'Other Workspace Install',
        sourceId: 'standalone',
        status: 'installed',
        workspaceId: 'workspace-2'
      },
      {
        ...SAMPLE_INSTALL,
        id: 'unmanaged-install',
        name: 'Unmanaged Install',
        sourceId: 'standalone',
        status: 'installed'
      },
      {
        ...SAMPLE_INSTALL,
        id: 'cloud-install',
        name: 'Comfy Cloud Instance',
        sourceId: 'cloud',
        sourceLabel: 'Comfy Cloud',
        sourceCategory: 'cloud',
        status: 'installed'
      }
    ]
    const listWorkspaces = window.api.comfybuilder.listWorkspaces as ReturnType<typeof vi.fn>
    listWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Workspace One', type: 'team' },
      { id: 'workspace-2', name: 'Workspace Two', type: 'team' }
    ])
    window.history.replaceState({}, '', '/?panel=performance-test&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('[data-testid="performance-test"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="performance-test-logo"]').exists()).toBe(true)
    expect(wrapper.find('.performance-test__account').exists()).toBe(true)
    expect(wrapper.findAll('.performance-test__selection-row')).toHaveLength(2)
    expect(
      wrapper.findAll('.performance-test__selection-label').map((label) => label.text())
    ).toEqual(['Workspace', 'Instance'])
    expect(wrapper.findAll('.performance-test__selection-control button')).toHaveLength(2)
    expect(wrapper.get('.performance-test__workspace-select button').text()).toBe('Workspace One')
    expect(wrapper.find('.performance-test__columns').exists()).toBe(true)
    expect(wrapper.findAll('.performance-test__column')).toHaveLength(3)
    expect(
      wrapper.findAll('.performance-test__column h2').map((heading) => heading.text())
    ).toEqual([
      '1. Select an instance',
      '2. Drop a workflow in API format',
      '3. Set measurements settings'
    ])
    const settings = wrapper.findAll('.performance-test__setting')
    expect(settings).toHaveLength(2)
    expect(settings.map((setting) => setting.find('label').text())).toEqual([
      'Warm-up runs',
      'Measured runs'
    ])
    const warmupRunsInput = settings[0]!.get('input')
    expect(warmupRunsInput.element).toHaveProperty('value', '1')
    expect(warmupRunsInput.attributes()).toMatchObject({ min: '1', max: '5', step: '1' })
    await warmupRunsInput.setValue('6')
    expect(warmupRunsInput.element).toHaveProperty('value', '5')
    await warmupRunsInput.setValue('0')
    expect(warmupRunsInput.element).toHaveProperty('value', '1')
    await warmupRunsInput.setValue('')
    expect(warmupRunsInput.element).toHaveProperty('value', '1')
    await warmupRunsInput.setValue('3')
    expect(warmupRunsInput.element).toHaveProperty('value', '3')
    const measuredRunsInput = settings[1]!.get('input')
    expect(measuredRunsInput.element).toHaveProperty('value', '5')
    expect(measuredRunsInput.attributes()).toMatchObject({
      min: '1',
      max: '100',
      step: '1'
    })
    await measuredRunsInput.setValue('101')
    expect(measuredRunsInput.element).toHaveProperty('value', '100')
    await measuredRunsInput.setValue('0')
    expect(measuredRunsInput.element).toHaveProperty('value', '1')
    await measuredRunsInput.setValue('4.6')
    expect(measuredRunsInput.element).toHaveProperty('value', '5')
    await measuredRunsInput.setValue('')
    expect(measuredRunsInput.element).toHaveProperty('value', '5')
    const logsToggle = wrapper.get('.performance-test__logs-section button')
    expect(logsToggle.text()).toBe('Logs')
    expect(logsToggle.attributes('aria-expanded')).toBe('true')
    const resultsToggle = wrapper.get('.performance-test__results-section button')
    expect(resultsToggle.text()).toBe('Results')
    expect(resultsToggle.attributes('aria-expanded')).toBe('true')
    expect(
      wrapper.findAll('.performance-test__content > section').map((section) => section.classes()[0])
    ).toEqual(['performance-test__results-section', 'performance-test__logs-section'])
    expect(wrapper.get('.performance-test__results').text()).toContain(
      'Performance test results will appear here.'
    )
    await resultsToggle.trigger('click')
    expect(resultsToggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.performance-test__results').attributes('style')).toContain('display: none')
    await resultsToggle.trigger('click')
    expect(
      wrapper.get('.performance-test__column:nth-child(3) .performance-test__run').exists()
    ).toBe(true)
    expect(wrapper.find('.performance-test__drop-zone').text()).toBe(
      'Drop a workflow .json file here, or click to browse'
    )
    expect(wrapper.find('.performance-test__run').text()).toBe('Run')
    expect(wrapper.find('.performance-test__logs').text()).toBe('Instance logs will appear here.')
    await logsToggle.trigger('click')
    expect(logsToggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.performance-test__logs').attributes('style')).toContain('display: none')
    await logsToggle.trigger('click')
    const instanceSelect = wrapper.get('.performance-test__instance-select button')
    expect(instanceSelect.attributes()).toMatchObject({
      role: 'combobox',
      'aria-label': 'Select an instance',
      'aria-expanded': 'false'
    })
    expect(instanceSelect.text()).toBe('Select an instance')
    await instanceSelect.trigger('click')
    await flushPromises()
    expect(
      Array.from(document.querySelectorAll('.ui-select-option-label')).map(
        (option) => option.textContent
      )
    ).toEqual(['Workspace Install', 'Legacy Install', 'Missing Install'])
    expect(
      Array.from(document.querySelectorAll('.ui-select-option-desc')).map(
        (option) => option.textContent
      )
    ).toEqual(['Standalone · 0.3.50', 'Standalone', 'Standalone'])
    expect(wrapper.text()).not.toContain('Other Workspace Install')
    expect(wrapper.find('.performance-test__description').text()).toBe(
      'Run performance tests against your ComfyUI instances.'
    )
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(false)
    ;(document.querySelectorAll('.ui-select-option')[0] as HTMLElement).click()
    await flushPromises()
    expect(instanceSelect.text()).toBe('Workspace Install')

    const api = (
      window as unknown as {
        api: {
          openInstancePicker: ReturnType<typeof vi.fn>
          importPerformanceTestWorkflow: ReturnType<typeof vi.fn>
          deletePerformanceTestWorkflow: ReturnType<typeof vi.fn>
          runPerformanceTestWorkflow: ReturnType<typeof vi.fn>
          getPathForFile: ReturnType<typeof vi.fn>
          runAction: ReturnType<typeof vi.fn>
          stopComfyUI: ReturnType<typeof vi.fn>
          cancelOperation: ReturnType<typeof vi.fn>
          onInstanceStarted: ReturnType<typeof vi.fn>
          onInstanceStopped: ReturnType<typeof vi.fn>
          onComfyOutput: ReturnType<typeof vi.fn>
        }
      }
    ).api
    await wrapper.get('.performance-test__drop-content').trigger('click')
    await flushPromises()
    expect(api.importPerformanceTestWorkflow).toHaveBeenCalledWith(undefined)
    expect(wrapper.get('.performance-test__workflow-file').text()).toContain('cat-workflow.json')
    expect(wrapper.get('.performance-test__workflow-file').text()).toContain(
      'C:\\ComfyUI\\performance-tests\\20260907225500\\cat-workflow.json'
    )
    expect(wrapper.get('.performance-test__drop-zone').text()).not.toContain(
      'Drop a workflow .json file here, or click to browse'
    )

    api.importPerformanceTestWorkflow.mockResolvedValueOnce({
      ok: true,
      filePath: 'C:\\ComfyUI\\performance-tests\\20260907225600\\cat-workflow.json'
    })
    const droppedFile = new File(['{}'], 'dropped.json', { type: 'application/json' })
    await wrapper.get('.performance-test__drop-zone').trigger('drop', {
      dataTransfer: { files: [droppedFile] }
    })
    await flushPromises()
    expect(api.getPathForFile).toHaveBeenCalledWith(droppedFile)
    expect(api.importPerformanceTestWorkflow).toHaveBeenLastCalledWith('C:\\incoming\\dropped.json')
    expect(wrapper.get('.performance-test__workflow-file').text()).toContain(
      'C:\\ComfyUI\\performance-tests\\20260907225600\\cat-workflow.json'
    )

    await wrapper.get('.performance-test__run').trigger('click')
    await flushPromises()
    expect(api.runAction).toHaveBeenCalledWith('workspace-install', 'launch', {
      launchModeOverride: 'console',
      autoPortOnConflict: true,
      sessionIdOverride: 'performance-test:workspace-install'
    })
    expect(api.runPerformanceTestWorkflow).toHaveBeenCalledWith(
      'performance-test:workspace-install',
      'C:\\ComfyUI\\performance-tests\\20260907225600\\cat-workflow.json',
      5,
      3
    )
    expect(wrapper.get('.performance-test__logs').text()).toContain(
      'Submitting 3 warm-up runs and 5 measured runs...'
    )
    expect(wrapper.get('.performance-test__logs').text()).toContain(
      'Finished 5 measured runs (0 unsuccessful). Final response saved to '
    )
    expect(wrapper.get('.performance-test__logs').text()).toContain(
      'C:\\ComfyUI\\performance-tests\\20260907225600\\results.json'
    )
    const results = wrapper.get('.performance-test__results').text()
    expect(results).toContain('Fastest run')
    expect(results).toContain('1.250 s')
    expect(results).toContain('Slowest run')
    expect(results).toContain('2.750 s')
    expect(results).not.toContain('prompt-3')
    expect(results).not.toContain('prompt-7')
    expect(results).toContain('Average run')
    expect(results).toContain('2.000 s')
    expect(results).toContain('Median run')
    expect(results).toContain('1.875 s')
    expect(results).toContain('Measured runs')
    expect(results).toContain('5')
    expect(wrapper.get('.performance-test__summary').findAll(':scope > *')).toHaveLength(3)
    expect(wrapper.get('.performance-test__aggregate-chart').attributes('aria-label')).toBe(
      'Run duration aggregates'
    )
    expect(wrapper.findAll('.performance-test__aggregate-bar')).toHaveLength(4)
    expect(wrapper.findAll('.performance-test__results h3')).toHaveLength(1)
    expect(results).toContain('System information')
    expect(results).toContain('NVIDIA GeForce RTX 4090')
    expect(results).not.toContain('Top-level fallback should not be displayed')
    expect(wrapper.find('.performance-test__result-list--compact').exists()).toBe(true)
    expect(wrapper.findAll('.performance-test__system-group h4')).toHaveLength(0)
    const systemGroups = wrapper.findAll('.performance-test__system-group')
    expect(systemGroups[0]!.text()).toContain('NVIDIA GeForce RTX 4090')
    expect(systemGroups[0]!.text()).toContain('VRAM24.0 GB')
    expect(systemGroups[0]!.text()).toContain('RAM63.9 GB')
    expect(systemGroups[0]!.text()).toContain('PyTorch version2.10.0+cu130')
    expect(systemGroups[0]!.text()).toContain('xFormers version0.0.31')
    expect(systemGroups[1]!.text()).toContain('CPUAMD Ryzen 9 7950X')
    expect(systemGroups[1]!.text()).toContain('CPU cores32')
    expect(systemGroups[1]!.text()).toContain('Architecturex64')
    expect(systemGroups[1]!.text()).toContain('Operating systemMicrosoft Windows 11 Pro 10.0.26200')
    expect(results).not.toContain('GPU driver')
    expect(results).not.toContain('Device index')
    expect(results).not.toContain('Backend')
    expect(results).not.toContain('24576 MB')
    expect(results).not.toContain('65461 MB')
    expect(
      wrapper
        .get('.performance-test__results')
        .element.lastElementChild?.classList.contains('performance-test__results-actions')
    ).toBe(true)
    const openResultsFolder = wrapper.get('.performance-test__open-results')
    expect(openResultsFolder.text()).toBe('Open folder')
    await openResultsFolder.trigger('click')
    expect(api.openPath).toHaveBeenCalledWith('C:\\ComfyUI\\performance-tests\\20260907225600')
    const exportResultsImage = wrapper.get('.performance-test__export-results')
    expect(exportResultsImage.text()).toBe('Export results')
    await exportResultsImage.trigger('click')
    await flushPromises()
    expect(api.exportPerformanceTestResultsImage).toHaveBeenCalledTimes(1)
    const [svg, defaultPath] = api.exportPerformanceTestResultsImage.mock.calls[0]!
    expect(defaultPath).toBe('C:\\ComfyUI\\performance-tests\\20260907225600')
    expect(svg).toContain('<svg')
    expect(svg).toContain('Measured runs')
    expect(svg).toContain('NVIDIA GeForce RTX 4090')
    expect(svg).toContain('AMD Ryzen 9 7950X')
    expect(svg).toContain('Microsoft Windows 11 Pro 10.0.26200')
    const outputCallback = api.onComfyOutput.mock.calls[0]![0] as (data: {
      installationId: string
      text: string
    }) => void
    outputCallback({
      installationId: 'performance-test:workspace-install',
      text: 'ComfyUI is ready\n'
    })
    await flushPromises()
    expect(wrapper.get('.performance-test__logs').text()).toContain('ComfyUI is ready')
    expect(wrapper.get('.performance-test__stop').attributes('disabled')).toBe('')
    expect(api.stopComfyUI).toHaveBeenCalledWith('performance-test:workspace-install')
    expect(api.cancelOperation).not.toHaveBeenCalled()

    await wrapper.get('.performance-test__delete-workflow').trigger('click')
    await flushPromises()
    expect(api.deletePerformanceTestWorkflow).toHaveBeenCalledWith(
      'C:\\ComfyUI\\performance-tests\\20260907225600\\cat-workflow.json'
    )
    expect(wrapper.find('.performance-test__workflow-file').exists()).toBe(false)
    expect(wrapper.get('.performance-test__drop-zone').text()).toContain(
      'Drop a workflow .json file here, or click to browse'
    )

    await wrapper.get('.performance-test__workspace-select button').trigger('click')
    await flushPromises()
    ;(document.querySelector('.ui-select-option') as HTMLElement).click()
    await flushPromises()

    expect(instanceSelect.text()).toBe('Select an instance')
    await instanceSelect.trigger('click')
    await flushPromises()
    expect(
      Array.from(document.querySelectorAll('.ui-select-option-label')).map(
        (option) => option.textContent
      )
    ).toEqual(['Unmanaged Install'])
    ;(document.querySelector('.ui-select-option') as HTMLElement).click()
    await flushPromises()
  })

  it('opens the new-install takeover above the chooser body when show-new-install fires', async () => {
    // Flow modals are Tier 3 takeover overlays. The chooser stays
    // mounted underneath the takeover, so dismissing the takeover
    // drops the user back into the chooser tile they came from with
    // no navigation churn.
    window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(true)
    await wrapper.find('[data-testid="chooser-new-install"]').trigger('click')
    await flushPromises()
    // Both visible — takeover sits ABOVE the chooser body.
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="new-install-modal"]').exists()).toBe(true)
    expect(installWizardOpen).toHaveBeenCalledWith({
      entrypoint: 'chooser',
      workspaceId: 'workspace-1'
    })
  })

  it('starts a separate performance test process when the normal instance is running', async () => {
    mockState.installations = [
      {
        ...SAMPLE_INSTALL,
        id: 'workspace-install',
        name: 'Workspace Install',
        sourceId: 'standalone',
        status: 'installed',
        workspaceId: 'workspace-1'
      }
    ]
    const api = (
      window as unknown as {
        api: {
          getRunningInstances: ReturnType<typeof vi.fn>
          stopComfyUI: ReturnType<typeof vi.fn>
          runAction: ReturnType<typeof vi.fn>
        }
      }
    ).api
    api.getRunningInstances.mockResolvedValueOnce([
      {
        installationId: 'workspace-install',
        installationName: 'Workspace Install',
        mode: 'window'
      }
    ])
    window.history.replaceState({}, '', '/?panel=performance-test&firstUseCompleted=true')

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.performance-test__drop-content').trigger('click')
    await wrapper.get('.performance-test__instance-select button').trigger('click')
    await flushPromises()
    ;(document.querySelector('.ui-select-option') as HTMLElement).click()
    await flushPromises()
    const runButton = wrapper.get('.performance-test__run')
    expect(runButton.attributes('disabled')).toBeUndefined()

    await runButton.trigger('click')
    await flushPromises()

    expect(api.stopComfyUI).not.toHaveBeenCalledWith('workspace-install')
    expect(api.runAction).toHaveBeenCalledWith('workspace-install', 'launch', {
      launchModeOverride: 'console',
      autoPortOnConflict: true,
      sessionIdOverride: 'performance-test:workspace-install'
    })
  })

  it('restarts an already-running performance test session before running', async () => {
    mockState.installations = [
      {
        ...SAMPLE_INSTALL,
        id: 'workspace-install',
        name: 'Workspace Install',
        sourceId: 'standalone',
        status: 'installed',
        workspaceId: 'workspace-1'
      }
    ]
    const api = (
      window as unknown as {
        api: {
          getRunningInstances: ReturnType<typeof vi.fn>
          stopComfyUI: ReturnType<typeof vi.fn>
          runAction: ReturnType<typeof vi.fn>
          runPerformanceTestWorkflow: ReturnType<typeof vi.fn>
        }
      }
    ).api
    api.getRunningInstances.mockResolvedValueOnce([
      {
        installationId: 'performance-test:workspace-install',
        installationName: 'Workspace Install',
        mode: 'console'
      }
    ])
    window.history.replaceState({}, '', '/?panel=performance-test&firstUseCompleted=true')

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.performance-test__drop-content').trigger('click')
    await wrapper.get('.performance-test__instance-select button').trigger('click')
    await flushPromises()
    ;(document.querySelector('.ui-select-option') as HTMLElement).click()
    await flushPromises()

    const runButton = wrapper.get('.performance-test__run')
    expect(runButton.attributes('disabled')).toBeUndefined()
    await runButton.trigger('click')
    await flushPromises()

    expect(api.stopComfyUI).toHaveBeenCalledWith('performance-test:workspace-install')
    expect(api.stopComfyUI.mock.invocationCallOrder[0]).toBeLessThan(
      api.runAction.mock.invocationCallOrder[0]!
    )
    expect(api.runAction).toHaveBeenCalledWith('workspace-install', 'launch', {
      launchModeOverride: 'console',
      autoPortOnConflict: true,
      sessionIdOverride: 'performance-test:workspace-install'
    })
    expect(api.runPerformanceTestWorkflow).toHaveBeenCalledWith(
      'performance-test:workspace-install',
      'C:\\ComfyUI\\performance-tests\\20260907225500\\cat-workflow.json',
      5,
      1
    )
  })

  it('allows a crashed performance test session to be stopped and cleared manually', async () => {
    mockState.installations = [
      {
        ...SAMPLE_INSTALL,
        id: 'workspace-install',
        name: 'Workspace Install',
        sourceId: 'standalone',
        status: 'installed',
        workspaceId: 'workspace-1'
      }
    ]
    const api = (
      window as unknown as {
        api: {
          runPerformanceTestWorkflow: ReturnType<typeof vi.fn>
          stopComfyUI: ReturnType<typeof vi.fn>
          onComfyExited: ReturnType<typeof vi.fn>
        }
      }
    ).api
    let resolvePerformanceTest!: (result: {
      ok: boolean
      submitted: number
      preparationRuns: number
      totalSubmitted: number
      message: string
    }) => void
    api.runPerformanceTestWorkflow.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePerformanceTest = resolve))
    )
    window.history.replaceState({}, '', '/?panel=performance-test&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.performance-test__drop-content').trigger('click')
    await wrapper.get('.performance-test__instance-select button').trigger('click')
    await flushPromises()
    ;(document.querySelector('.ui-select-option') as HTMLElement).click()
    await flushPromises()
    await wrapper.get('.performance-test__run').trigger('click')
    await flushPromises()
    expect(wrapper.get('.performance-test__run').text()).toBe('Running...')

    const exitedCallback = api.onComfyExited.mock.calls[0]![0] as (data: {
      installationId: string
      installationName: string
      crashed: boolean
      exitCode: number
    }) => void
    exitedCallback({
      installationId: 'performance-test:workspace-install',
      installationName: 'Workspace Install',
      crashed: true,
      exitCode: 1
    })
    await flushPromises()

    const stopButton = wrapper.get('.performance-test__stop')
    expect(stopButton.attributes('disabled')).toBeUndefined()
    await stopButton.trigger('click')
    await flushPromises()
    expect(api.stopComfyUI).toHaveBeenCalledWith('performance-test:workspace-install')
    expect(stopButton.attributes('disabled')).toBe('')
    resolvePerformanceTest({
      ok: false,
      submitted: 0,
      preparationRuns: 0,
      totalSubmitted: 0,
      message: 'The performance test instance exited.'
    })
    await flushPromises()
  })

  it('returns to the underlying body when a takeover emits close', async () => {
    window.history.replaceState({}, '', '/?panel=new-install&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()
    // The URL-driven flow panel mounts as a takeover above the default
    // body (chooser, since there's no installationId).
    expect(wrapper.find('[data-testid="new-install-modal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(true)
    await wrapper.findComponent({ name: 'InstallWizardModal' }).vm.$emit('close')
    await flushPromises()
    expect(wrapper.find('[data-testid="new-install-modal"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(true)
  })

  it('renders the track takeover when initialised with panel=track', async () => {
    window.history.replaceState({}, '', '/?panel=track&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="track-modal"]').exists()).toBe(true)
  })

  it('renders the load-snapshot takeover when initialised with panel=load-snapshot', async () => {
    window.history.replaceState({}, '', '/?panel=load-snapshot&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="load-snapshot-modal"]').exists()).toBe(true)
  })

  it('renders the quick-install takeover when initialised with panel=quick-install', async () => {
    window.history.replaceState({}, '', '/?panel=quick-install&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="quick-install-modal"]').exists()).toBe(true)
  })

  it.each([
    { panel: 'track', selector: '[data-testid="track-modal"]', name: 'TrackModal' },
    {
      panel: 'load-snapshot',
      selector: '[data-testid="load-snapshot-modal"]',
      name: 'LoadSnapshotModal'
    },
    {
      panel: 'quick-install',
      selector: '[data-testid="quick-install-modal"]',
      name: 'QuickInstallModal'
    },
    {
      panel: 'new-install',
      selector: '[data-testid="new-install-modal"]',
      name: 'InstallWizardModal'
    }
  ])(
    "IPCs closeCurrentPanel when the $panel takeover dismisses, so main's activePanel resets and the file menu can re-open it",
    async ({ panel, selector, name }) => {
      // Without this IPC, main's `entry.activePanel` stays stuck on the
      // wizard key after the renderer-side dismiss; the next file-menu
      // pick of the same item hits `setActivePanel`'s same-panel
      // early-return and the modal silently fails to reopen
      // (Comfy-Org/Comfy-Desktop#486).
      window.history.replaceState({}, '', `/?panel=${panel}&firstUseCompleted=true`)
      const wrapper = mountPanel()
      await flushPromises()
      expect(wrapper.find(selector).exists()).toBe(true)

      const closeCurrentPanel = (
        window as unknown as {
          api: { closeCurrentPanel: ReturnType<typeof vi.fn> }
        }
      ).api.closeCurrentPanel
      expect(closeCurrentPanel).not.toHaveBeenCalled()

      await wrapper.findComponent({ name }).vm.$emit('close')
      await flushPromises()

      expect(closeCurrentPanel).toHaveBeenCalledTimes(1)
      expect(wrapper.find(selector).exists()).toBe(false)
    }
  )

  it('does NOT auto-mount the first-use takeover when firstUseCompleted is true', async () => {
    // Default mock state has firstUseCompleted: true; the takeover
    // should never enter the overlay slot.
    window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="first-use-takeover"]').exists()).toBe(false)
  })

  it('auto-mounts the first-use takeover and suppresses the chooser body when firstUseCompleted is false', async () => {
    // Body is gated out while a Tier 3 takeover owns the overlay slot —
    // BrandTakeoverLayout has a 240ms opacity fade-in, so rendering the
    // chooser behind it would bleed through during the entrance. The
    // dismiss tests below assert the body reveals when the takeover
    // clears (see "marks firstUseCompleted=true and closes the takeover
    // on Cloud-branch pick").
    mockState.settings.firstUseCompleted = false
    window.history.replaceState({}, '', '/?panel=chooser')
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="first-use-takeover"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(false)
  })

  it('warms picker thumbnails on the first-use cold-start path', async () => {
    mockState.settings.firstUseCompleted = false
    window.history.replaceState({}, '', '/?panel=chooser')
    mountPanel()
    await flushPromises()
    const api = (window as unknown as { api: { getFieldOptions: ReturnType<typeof vi.fn> } }).api
    expect(api.getFieldOptions).toHaveBeenCalledTimes(1)
    expect(api.getFieldOptions).toHaveBeenCalledWith('standalone', 'bundledTemplate', {}, {})
  })

  it('does NOT warm picker thumbnails for returning users', async () => {
    window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
    mountPanel()
    await flushPromises()
    const api = (window as unknown as { api: { getFieldOptions: ReturnType<typeof vi.fn> } }).api
    expect(api.getFieldOptions).not.toHaveBeenCalled()
  })

  it('marks firstUseCompleted=true and closes the takeover on Cloud-branch pick', async () => {
    mockState.settings.firstUseCompleted = false
    // Seed a cloud install so the auto-launch path can resolve a
    // target — the host pulls launch actions for it via the chooser
    // launch pipeline. We assert getListActions IS called here so the
    // returning-user `complete-skip` test below can credibly assert
    // the opposite.
    mockState.installations = [
      { id: 'cloud-id', name: 'Comfy Cloud', sourceLabel: 'Cloud', sourceCategory: 'cloud' }
    ]
    window.history.replaceState({}, '', '/?panel=chooser')
    const wrapper = mountPanel()
    await flushPromises()
    const api = (
      window as unknown as {
        api: {
          setSetting: ReturnType<typeof vi.fn>
          getListActions: ReturnType<typeof vi.fn>
        }
      }
    ).api
    expect(api.setSetting).not.toHaveBeenCalledWith('firstUseCompleted', true)

    await wrapper.find('[data-testid="first-use-cloud"]').trigger('click')
    await flushPromises()

    expect(api.setSetting).toHaveBeenCalledWith('firstUseCompleted', true)
    expect(wrapper.find('[data-testid="first-use-takeover"]').exists()).toBe(false)
    // Chooser body underneath remains mounted.
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(true)
    // Cloud auto-launch ran — getListActions resolves the launch
    // action for the seeded cloud install.
    expect(api.getListActions).toHaveBeenCalledWith('cloud-id')
  })

  it('marks firstUseCompleted=true on returning-user complete-skip WITHOUT auto-launching cloud', async () => {
    // Issue #476 — when `skipPick` is true (returning user with prior
    // local installs), accepting consent emits `complete-skip` rather
    // than `complete-cloud`. The host must mark completion and dismiss,
    // but MUST NOT launch the seeded cloud install: the user never
    // picked Cloud (the fork was suppressed), so auto-launching it
    // would hijack their existing local install.
    mockState.settings.firstUseCompleted = false
    mockState.installations = [
      { id: 'cloud-id', name: 'Comfy Cloud', sourceLabel: 'Cloud', sourceCategory: 'cloud' },
      SAMPLE_INSTALL
    ]
    window.history.replaceState({}, '', '/?panel=chooser')
    const wrapper = mountPanel()
    await flushPromises()
    const api = (
      window as unknown as {
        api: {
          setSetting: ReturnType<typeof vi.fn>
          getListActions: ReturnType<typeof vi.fn>
        }
      }
    ).api
    expect(api.setSetting).not.toHaveBeenCalledWith('firstUseCompleted', true)

    await wrapper.find('[data-testid="first-use-skip"]').trigger('click')
    await flushPromises()

    expect(api.setSetting).toHaveBeenCalledWith('firstUseCompleted', true)
    expect(wrapper.find('[data-testid="first-use-takeover"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(true)
    // Critical guarantee — no implicit cloud launch happened.
    expect(api.getListActions).not.toHaveBeenCalled()
  })

  it('chains into the new-install takeover on Local-branch pick and marks completion when new-install closes', async () => {
    mockState.settings.firstUseCompleted = false
    window.history.replaceState({}, '', '/?panel=chooser')
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-testid="first-use-local"]').trigger('click')
    await flushPromises()

    // Tier 3 → Tier 3 swap: first-use unmounts, new-install mounts.
    expect(wrapper.find('[data-testid="first-use-takeover"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="new-install-modal"]').exists()).toBe(true)

    const setSetting = (
      window as unknown as {
        api: { setSetting: ReturnType<typeof vi.fn> }
      }
    ).api.setSetting
    expect(setSetting).not.toHaveBeenCalledWith('firstUseCompleted', true)

    // New-install close (success or cancel) flips the persisted gate.
    await wrapper.findComponent({ name: 'InstallWizardModal' }).vm.$emit('close')
    await flushPromises()
    expect(setSetting).toHaveBeenCalledWith('firstUseCompleted', true)
  })

  it('marks firstUseCompleted=true and closes the takeover when main fires the file-menu Skip Onboarding event', async () => {
    // Main routes the file-menu Skip Onboarding click into the
    // panel renderer via the
    // `comfy-panel:first-use-skip` IPC. PanelApp's listener should
    // run the same `markFirstUseCompleted` + dismiss-takeover
    // sequence the Cloud-branch pick uses, so the takeover
    // disappears and the chooser body underneath is the landing
    // surface (matching the Cloud-pick test above).
    mockState.settings.firstUseCompleted = false
    window.history.replaceState({}, '', '/?panel=chooser')
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="first-use-takeover"]').exists()).toBe(true)

    const setSetting = (
      window as unknown as {
        api: { setSetting: ReturnType<typeof vi.fn> }
      }
    ).api.setSetting
    expect(setSetting).not.toHaveBeenCalledWith('firstUseCompleted', true)

    // Simulate the main → renderer Skip Onboarding push.
    expect(mockState.firstUseSkipCallbacks.length).toBeGreaterThan(0)
    mockState.firstUseSkipCallbacks.forEach((cb) => cb())
    await flushPromises()

    expect(setSetting).toHaveBeenCalledWith('firstUseCompleted', true)
    expect(wrapper.find('[data-testid="first-use-takeover"]').exists()).toBe(false)
    // Chooser body underneath remains mounted, same as Cloud-pick.
    expect(wrapper.find('[data-testid="chooser-view"]').exists()).toBe(true)
  })

  it('emits comfy.desktop.feedback.opened with the originating source and opens the support URL', async () => {
    // Both the title-bar feedback button and the file-menu "Send
    // Feedback" entry route through main's `comfy-panel:open-feedback`
    // IPC. The panel renderer is the natural home for the click side-
    // effects because `buildSupportUrl()` reads `navigator.userAgent`
    // and the telemetry helper lives renderer-side. Verify the listener
    // (a) emits the telemetry action with `source` baked into the
    // context so we can tell the two affordances apart, and
    // (b) opens the typeform URL with the cached app version in `ver`.
    mountPanel()
    await flushPromises()

    interface TelemetryEvent {
      actionName: string
      context?: { source?: string }
    }
    const telemetryEvents: TelemetryEvent[] = []
    const listener = (e: Event): void => {
      telemetryEvents.push((e as CustomEvent<TelemetryEvent>).detail)
    }
    window.addEventListener('launcher-telemetry-action', listener)

    expect(mockState.openFeedbackCallbacks.length).toBeGreaterThan(0)
    // Title-bar button click.
    mockState.openFeedbackCallbacks.forEach((cb) => cb({ source: 'titlebar' }))
    await flushPromises()
    // File-menu entry click.
    mockState.openFeedbackCallbacks.forEach((cb) => cb({ source: 'menu' }))
    await flushPromises()

    window.removeEventListener('launcher-telemetry-action', listener)

    const feedbackTelemetry = telemetryEvents.filter(
      (e) => e.actionName === 'comfy.desktop.feedback.opened'
    )
    expect(feedbackTelemetry.map((e) => e.context?.source)).toEqual(['titlebar', 'menu'])
    // FeedbackModal teleports its iframe to <body>, so query the
    // document directly rather than the wrapper subtree. The iframe
    // src is the resolved support URL — same payload we used to send
    // through `openFeedback`.
    const frame = document.body.querySelector<HTMLIFrameElement>('iframe.feedback-modal-frame')
    expect(frame).not.toBeNull()
    const url = frame?.getAttribute('src') ?? ''
    expect(url).toContain('form.typeform.com/to/VhOXmuaL')
    expect(url).toContain('ver=0.5.0')
    expect(url).toMatch(/[?&]platform=/)
  })

  // The first-use takeover has no in-app ✕ close button (first-use
  // is a binding flow). Mid-flow dismissal happens via OS-chrome
  // window close, which routes through `onCloseRequest` →
  // `closeOverlay` (a renderer-internal direct mutation that doesn't
  // go through any FirstUseTakeover emit). The "doesn't mark
  // firstUseCompleted on mid-flow exit" guarantee holds because no
  // code path between mount and the explicit Cloud / Local picks
  // calls `markFirstUseCompleted` — the cloud / chain-local tests
  // above already assert that ordering by checking `setSetting`
  // hasn't been called with `firstUseCompleted` until the user makes
  // the explicit pick.

  it('keeps the comfy-lifecycle body when a panel-switch IPC event re-confirms it', async () => {
    // The default body for an install-backed host is already comfy-lifecycle;
    // a redundant panel-switch must leave it intact.
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="comfy-lifecycle"]').exists()).toBe(true)

    mockState.panelSwitchCallbacks.forEach((cb) => cb({ panel: 'comfy-lifecycle' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="comfy-lifecycle"]').exists()).toBe(true)
  })

  it('opens the instance picker (expanded, Update tab) and auto-fires update when a panel-trigger-overlay install-update event arrives', async () => {
    // The title-bar install-update pill click is forwarded by main
    // as an `onPanelTriggerOverlay` event with
    // `kind: 'install-update'`. Post-redesign the panel renderer
    // routes that into the instance picker popup (expanded, Update
    // tab) instead of mounting a Tier 1 DetailModal — same surface
    // the chooser-card kebab Update entry now opens. It also seeds
    // `autoAction: 'update-comfyui'` so the user lands directly on the
    // update-confirm modal rather than just staring at the Update tab.
    mountPanel()
    await flushPromises()
    const api = (window as unknown as { api: { openInstancePicker: ReturnType<typeof vi.fn> } }).api

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'install-update', installationId: 'test-id' })
    )
    await flushPromises()

    expect(api.openInstancePicker).toHaveBeenCalledTimes(1)
    expect(api.openInstancePicker).toHaveBeenCalledWith({
      installationId: 'test-id',
      initialTab: 'update',
      autoAction: 'update-comfyui'
    })
  })

  it('preserves restart intent when a chooser host relaunches a booting instance', async () => {
    window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
    const api = (
      window as unknown as {
        api: {
          getRunningInstances: ReturnType<typeof vi.fn>
          getListActions: ReturnType<typeof vi.fn>
          getSetting: ReturnType<typeof vi.fn>
          runAction: ReturnType<typeof vi.fn>
        }
      }
    ).api
    api.getRunningInstances.mockResolvedValueOnce([
      {
        installationId: 'other-id',
        installationName: 'Other Install',
        mode: 'window'
      }
    ])
    api.getListActions.mockResolvedValueOnce([
      {
        id: 'launch',
        label: 'Launch',
        style: 'primary',
        showProgress: false
      }
    ])
    mountPanel()
    await flushPromises()
    api.getSetting.mockClear()

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'picker-pick-install', installationId: 'test-id', isRestart: true })
    )
    await flushPromises()

    expect(api.getListActions).toHaveBeenCalledWith('test-id')
    expect(api.runAction).toHaveBeenCalledWith('test-id', 'launch')
    expect(api.getSetting).not.toHaveBeenCalledWith('warnBeforeRunningMultipleInstances')
  })

  it('opens the instance picker on the Config tab when a panel-trigger-overlay open-settings event arrives with tab=comfy', async () => {
    // `comfy://open-settings?tab=comfy` on an install-backed host
    // opens the picker on the Config tab — the same surface the
    // title-bar Settings entry routes to.
    mountPanel()
    await flushPromises()
    const api = (
      window as unknown as {
        api: {
          openInstancePicker: ReturnType<typeof vi.fn>
          openGlobalSettings: ReturnType<typeof vi.fn>
        }
      }
    ).api

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'open-settings', settingsTab: 'comfy' })
    )
    await flushPromises()

    expect(api.openInstancePicker).toHaveBeenCalledTimes(1)
    expect(api.openInstancePicker).toHaveBeenCalledWith({
      installationId: 'test-id',
      initialTab: 'config'
    })
    expect(api.openGlobalSettings).not.toHaveBeenCalled()
  })

  it('opens global settings when a panel-trigger-overlay open-settings event arrives with tab=global', async () => {
    // `comfy://open-settings?tab=global` routes to the dedicated
    // Global Settings popup regardless of which host received it.
    mountPanel()
    await flushPromises()
    const api = (
      window as unknown as {
        api: {
          openInstancePicker: ReturnType<typeof vi.fn>
          openGlobalSettings: ReturnType<typeof vi.fn>
        }
      }
    ).api

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'open-settings', settingsTab: 'global' })
    )
    await flushPromises()

    expect(api.openGlobalSettings).toHaveBeenCalledTimes(1)
    expect(api.openInstancePicker).not.toHaveBeenCalled()
  })

  it('opens global settings on its Storage tab when open-settings arrives with tab=global-storage', async () => {
    // The instance pane's "Manage Shared Directories" link deep-links to
    // Global Desktop Settings landed on Storage, not just the popup itself.
    mountPanel()
    await flushPromises()
    const api = (
      window as unknown as {
        api: {
          openInstancePicker: ReturnType<typeof vi.fn>
          openGlobalSettings: ReturnType<typeof vi.fn>
        }
      }
    ).api

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'open-settings', settingsTab: 'global-storage' })
    )
    await flushPromises()

    expect(api.openGlobalSettings).toHaveBeenCalledTimes(1)
    expect(api.openGlobalSettings).toHaveBeenCalledWith('storage')
    expect(api.openInstancePicker).not.toHaveBeenCalled()
  })

  it('shows the "Desktop Update Ready" confirm modal when a restart-prompt event arrives, and installs on confirm', async () => {
    // Issue #488 — auto-on click on the 'ready' pill (or the auto
    // restart-prompt that fires on user-initiated download
    // completion) routes through `app-update-restart-prompt`. The
    // panel renderer pops a confirm modal; clicking Restart calls
    // `installUpdate()`.
    mockModal.confirm.mockResolvedValueOnce(true)
    mountPanel()
    await flushPromises()

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'app-update-restart-prompt', version: '1.2.3' })
    )
    await flushPromises()

    expect(mockModal.confirm).toHaveBeenCalledTimes(1)
    expect(mockModal.confirm.mock.calls[0]?.[0]).toMatchObject({
      title: 'appUpdate.readyTitle',
      confirmLabel: 'appUpdate.restartNow'
    })
    expect(mockState.installUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not install when the restart-prompt confirm modal is cancelled', async () => {
    mockModal.confirm.mockResolvedValueOnce(false)
    mountPanel()
    await flushPromises()

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'app-update-restart-prompt', version: '1.2.3' })
    )
    await flushPromises()

    expect(mockModal.confirm).toHaveBeenCalledTimes(1)
    expect(mockState.installUpdate).not.toHaveBeenCalled()
  })

  it('shows the "Desktop Update Available" confirm modal when a download-prompt event arrives, and downloads on confirm', async () => {
    // Issue #488 — auto-off click on the 'available' pill routes
    // through `app-update-download-prompt`. Clicking Download calls
    // `downloadUpdate()`; the auto restart-prompt fires later (covered
    // by `onAppUpdatePromptRestart`).
    mockModal.confirm.mockResolvedValueOnce(true)
    mountPanel()
    await flushPromises()

    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'app-update-download-prompt', version: '1.2.3' })
    )
    await flushPromises()

    expect(mockModal.confirm).toHaveBeenCalledTimes(1)
    expect(mockModal.confirm.mock.calls[0]?.[0]).toMatchObject({
      title: 'appUpdate.availableTitle',
      confirmLabel: 'appUpdate.download'
    })
    expect(mockState.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('auto-shows the restart prompt when onAppUpdatePromptRestart fires (auto-off post-download)', async () => {
    // Closes the loop on the auto-off "Download → wait → Restart"
    // single-gesture flow described in issue #488.
    mockModal.confirm.mockResolvedValueOnce(true)
    mountPanel()
    await flushPromises()

    mockState.appUpdatePromptRestartCallbacks.forEach((cb) => cb({ version: '1.2.3' }))
    await flushPromises()

    expect(mockModal.confirm).toHaveBeenCalledTimes(1)
    expect(mockModal.confirm.mock.calls[0]?.[0]).toMatchObject({
      title: 'appUpdate.readyTitle'
    })
    expect(mockState.installUpdate).toHaveBeenCalledTimes(1)
  })

  it('shows an alert modal when onAppUpdateUserActionFailed fires', async () => {
    mountPanel()
    await flushPromises()

    mockState.appUpdateUserActionFailedCallbacks.forEach((cb) => cb({ message: 'network down' }))
    await flushPromises()

    expect(mockModal.alert).toHaveBeenCalledTimes(1)
    expect(mockModal.alert.mock.calls[0]?.[0]).toMatchObject({
      title: 'appUpdate.errorTitle',
      message: 'network down'
    })
  })

  it('ignores install-update events whose installationId does not match the host', async () => {
    // Defensive — main scopes the install-update broadcast to the
    // matching host's panelView, but the renderer also re-validates.
    const wrapper = mountPanel()
    await flushPromises()
    mockState.panelTriggerOverlayCallbacks.forEach((cb) =>
      cb({ kind: 'install-update', installationId: 'someone-else' })
    )
    await flushPromises()
    expect(wrapper.find('[data-testid="detail-modal"]').exists()).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Telemetry (issue #485) — verify `comfy.desktop.install.flow.opened`
  // and `comfy.desktop.view.opened` fire from PanelApp's
  // `openFlowTakeover` / `switchPanel`.
  //
  // Captures CustomEvents on the `window` (the same channel
  // `emitTelemetryAction` uses to bridge into the providers) so the test
  // doesn't have to mock the Datadog / PostHog modules.
  // ---------------------------------------------------------------------------
  describe('telemetry', () => {
    function captureTelemetry(): TelemetryActionEventDetail[] {
      const events: TelemetryActionEventDetail[] = []
      window.addEventListener(TELEMETRY_ACTION_EVENT_NAME, (event) => {
        events.push((event as CustomEvent<TelemetryActionEventDetail>).detail)
      })
      return events
    }

    it('fires comfy.desktop.install.flow.opened with entrypoint=chooser when chooser empty-state CTA fires', async () => {
      window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
      const wrapper = mountPanel()
      await flushPromises()
      const events = captureTelemetry()
      await wrapper.find('[data-testid="chooser-new-install"]').trigger('click')
      await flushPromises()
      const flowEvents = events.filter((e) => e.actionName === 'comfy.desktop.install.flow.opened')
      expect(flowEvents).toHaveLength(1)
      expect(flowEvents[0].context).toMatchObject({
        flow: 'new_install',
        entrypoint: 'chooser'
      })
    })

    it('fires comfy.desktop.install.flow.opened with entrypoint=titlebar for a panel-switch IPC', async () => {
      window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
      mountPanel()
      await flushPromises()
      const events = captureTelemetry()
      mockState.panelSwitchCallbacks.forEach((cb) => cb({ panel: 'quick-install' }))
      await flushPromises()
      const flowEvents = events.filter((e) => e.actionName === 'comfy.desktop.install.flow.opened')
      expect(flowEvents).toHaveLength(1)
      expect(flowEvents[0].context).toMatchObject({
        flow: 'quick_install',
        entrypoint: 'titlebar'
      })
    })

    it('maps each FlowComponent to its legacy flow string', async () => {
      window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
      mountPanel()
      await flushPromises()
      const events = captureTelemetry()
      const cases: { panel: string; flow: string }[] = [
        { panel: 'new-install', flow: 'new_install' },
        { panel: 'track', flow: 'track_existing' },
        { panel: 'load-snapshot', flow: 'load_snapshot' },
        { panel: 'quick-install', flow: 'quick_install' }
      ]
      for (const { panel } of cases) {
        mockState.panelSwitchCallbacks.forEach((cb) => cb({ panel }))
        await flushPromises()
        // The takeover slot only holds one component; emit close so the
        // next case can open. Each *Modal stub emits 'close'.
        const open = events
          .filter((e) => e.actionName === 'comfy.desktop.install.flow.opened')
          .pop()
        // Dismiss whatever takeover is currently mounted.
        useOverlay().current.value = null
        await flushPromises()
        expect(open?.context?.flow, `panel=${panel}`).toBe(
          cases.find((c) => c.panel === panel)?.flow
        )
      }
    })

    it('fires comfy.desktop.install.flow.opened with entrypoint=url when the URL initial panel is a flow', async () => {
      // Captures must be installed BEFORE mount because the URL-driven
      // initial-panel branch fires from inside `onMounted`.
      const events = captureTelemetry()
      window.history.replaceState({}, '', '/?panel=load-snapshot&firstUseCompleted=true')
      mountPanel()
      await flushPromises()
      const flowEvents = events.filter((e) => e.actionName === 'comfy.desktop.install.flow.opened')
      expect(flowEvents).toHaveLength(1)
      expect(flowEvents[0].context).toMatchObject({
        flow: 'load_snapshot',
        entrypoint: 'url'
      })
    })

    it('fires comfy.desktop.install.flow.opened with entrypoint=first_use on the first-use Local-branch chain', async () => {
      mockState.settings.firstUseCompleted = false
      window.history.replaceState({}, '', '/?panel=chooser')
      const wrapper = mountPanel()
      await flushPromises()
      const events = captureTelemetry()
      await wrapper.find('[data-testid="first-use-local"]').trigger('click')
      await flushPromises()
      const flowEvents = events.filter((e) => e.actionName === 'comfy.desktop.install.flow.opened')
      expect(flowEvents).toHaveLength(1)
      expect(flowEvents[0].context).toMatchObject({
        flow: 'new_install',
        entrypoint: 'first_use'
      })
    })

    it('does NOT fire comfy.desktop.view.opened when a panel-switch IPC re-confirms the active body panel', async () => {
      mountPanel()
      await flushPromises()
      const events = captureTelemetry()
      // Default body is comfy-lifecycle; re-confirming it is a no-op.
      mockState.panelSwitchCallbacks.forEach((cb) => cb({ panel: 'comfy-lifecycle' }))
      await flushPromises()
      expect(events.filter((e) => e.actionName === 'comfy.desktop.view.opened')).toHaveLength(0)
    })

    it('does NOT fire comfy.desktop.install.flow.opened when openFlowTakeover is rejected by an in-flight Tier 2 op', async () => {
      // useOverlay's tier-collision rules can reject a Tier 3 open if a
      // Tier 2 progress op is in flight and the user cancels the
      // confirm-prompt. The renderer must not fire the telemetry event
      // when the takeover never actually mounted. Simulate by pre-
      // populating the overlay slot with a progress op (Tier 2) and
      // routing a flow open through panel-switch — useOverlay will
      // request confirmation via window.api which our mock leaves
      // unresolved, so openOverlay returns false.
      window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
      mountPanel()
      await flushPromises()
      // Pre-populate Tier 2 progress overlay.
      useOverlay().current.value = {
        kind: 'progress',
        installationId: 'test-id',
        operationName: 'install',
        onCancel: () => {}
      }
      const events = captureTelemetry()
      // Trigger the flow open. The collision logic in useOverlay will
      // either prompt (default-deny in tests since no confirm handler is
      // wired) or silently reject — either way openFlowTakeover should
      // bail before emitting telemetry.
      mockState.panelSwitchCallbacks.forEach((cb) => cb({ panel: 'new-install' }))
      await flushPromises()
      expect(
        events.filter((e) => e.actionName === 'comfy.desktop.install.flow.opened')
      ).toHaveLength(0)
    })
  })

  describe('window close consult', () => {
    // With no Tier 2/3 overlay open, the renderer no longer confirms — it
    // defers, and main owns the Close Window / dashboard / quit decision
    // (the panel renderer is unreliable behind a running ComfyUI view).
    it('defers an install-backed ✕ to main when no overlay is open (no renderer modal)', async () => {
      // Default URL already set in beforeEach: installationId=test-id
      mountPanel()
      await flushPromises()

      mockState.closeRequestCallbacks.forEach((cb) => cb({ requestId: 'req-1' }))
      await flushPromises()

      expect(mockModal.confirm).not.toHaveBeenCalled()
      const api = (window as unknown as { api: { respondCloseRequest: ReturnType<typeof vi.fn> } })
        .api
      expect(api.respondCloseRequest).toHaveBeenCalledWith({ requestId: 'req-1', defer: true })
    })

    it('defers a dashboard ✕ to main as well (no renderer modal)', async () => {
      window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
      mountPanel()
      await flushPromises()

      mockState.closeRequestCallbacks.forEach((cb) => cb({ requestId: 'req-2' }))
      await flushPromises()

      expect(mockModal.confirm).not.toHaveBeenCalled()
      const api = (window as unknown as { api: { respondCloseRequest: ReturnType<typeof vi.fn> } })
        .api
      expect(api.respondCloseRequest).toHaveBeenCalledWith({ requestId: 'req-2', defer: true })
    })
  })
})
