<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ProgressModal from '../views/ProgressModal.vue'
import ModalDialog from '../components/ModalDialog.vue'
import DialogHost from '../components/DialogHost.vue'
import FeedbackModal from '../components/FeedbackModal.vue'
import AppSidebar from './AppSidebar.vue'
import BuildProgressDialog from './BuildProgressDialog.vue'
import BuildDetailsView from './BuildDetailsView.vue'
import HomeView from './HomeView.vue'
import ComfyLifecycleView from './ComfyLifecycleView.vue'
import AssetsView from './AssetsView.vue'
import AppsView from './AppsView.vue'
import CatalogWorkflowDialog from './CatalogWorkflowDialog.vue'
import StaffAppsView from './StaffAppsView.vue'
import ChooserView from '../views/ChooserView.vue'
import PerformanceTestView from '../views/PerformanceTestView.vue'
import BenchmarksView from '../views/BenchmarksView.vue'
import InstallWizardModal from '../views/InstallWizardModal.vue'
import TrackModal from '../views/TrackModal.vue'
import LoadSnapshotModal from '../views/LoadSnapshotModal.vue'
import FirstUseTakeover from '../views/FirstUseTakeover.vue'
import MigrateConfirmTakeover from '../views/MigrateConfirmTakeover.vue'
import { useTheme } from '../composables/useTheme'
import { provideLocalDeviceKind } from '../composables/useLocalDeviceKind'
import { useSessionStore } from '../stores/sessionStore'
import { useInstallationStore } from '../stores/installationStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { isInstallationInWorkspace } from '../../../shared/workspaces'
import { isNewWindowDashboardPage } from '../../../shared/dashboardPages'
import { seedLauncherPrefsFromUrl, useLauncherPrefs } from '../composables/useLauncherPrefs'
import { useModal } from '../composables/useModal'
import { useAdoptPromptBridge } from '../composables/useAdoptPromptBridge'
import { useAppUpdatePrompts } from '../composables/useAppUpdatePrompts'
import { useReturnToDashboardConfirm } from '../composables/useReturnToDashboardConfirm'
import { useSendFeedback } from '../composables/useSendFeedback'
import { emitTelemetryAction } from '../lib/telemetry'
import { useDeepLinkRouter } from '../composables/useDeepLinkRouter'
import { useInstallContextMenu } from '../composables/useInstallContextMenu'
import { useActionGuard } from '../composables/useActionGuard'
import { registerMigrateTakeover } from '../composables/useMigrateAction'
import { isFlowPanel, isValidPanel, usePanelOverlays } from './usePanelOverlays'
import { useChooserHandoff } from './useChooserHandoff'
import { useFirstUseChain } from './useFirstUseChain'
import { bindE2EPanelHooks } from './e2eRendererHooks'
import { resolvePickerTab } from '../lib/pickerTabs'
import { useAppLocale, windowApiLocaleSource } from '../lib/useAppLocale'
import {
  SUCCESS_ACTION_GO_DASHBOARD,
  SUCCESS_ACTION_OPEN_INSTANCE
} from '../lib/progressTerminalPresets'
import { provideBuildLogs } from '../composables/useBuildProgress'
import { provideBuildMenuHost } from './home/useBuildMenu'
import HomeTour from './home/HomeTour.vue'
import { useDialogs } from '../composables/useDialogs'
import { provideAutoStartBuild } from '../composables/useAutoStartBuild'
import { provideOpenWhenReady } from './home/useOpenWhenReady'
import { focusRunningBuild } from '../lib/focusRunningBuild'
import { runningAppIds, watchAppRuns } from './appRuns'
import { useAppSwitchConfirm } from './useAppSwitchConfirm'
import { useStaffApps } from './useStaffApps'
import type {
  AppCard,
  CatalogWorkflow,
  DashboardPage,
  DraftAppRequest,
  HiddenAppCard,
  Installation
} from '../types/ipc'

const { t } = useI18n()
const { syncLocale } = useAppLocale(windowApiLocaleSource())
useTheme()

const params = new URLSearchParams(window.location.search)
const installationId = params.get('installationId') || ''
seedLauncherPrefsFromUrl(window.location.search)
const urlFirstUseCompleted = params.get('firstUseCompleted') === 'true'
const urlFirstUsePending = params.get('firstUseCompleted') === 'false'

const sessionStore = useSessionStore()
provideLocalDeviceKind()
const installationStore = useInstallationStore()
const launcherPrefs = useLauncherPrefs()
void launcherPrefs.loadPrefs()
const { loaded: launcherPrefsLoaded, firstUseCompleted } = launcherPrefs

const modal = useModal()
useAdoptPromptBridge()
const { showAppUpdateRestartPrompt, showAppUpdateDownloadPrompt } = useAppUpdatePrompts()
const { feedbackOpen, feedbackHiddenFields, closeFeedback } = useSendFeedback()
const dialogs = useDialogs()

function showHomePage(): void {
  if (!showSidebar.value || sidebarPage.value === 'home') return
  window.api.navigatePanel('home')
  handleSidebarNavigate('home')
}

let unsubShowHomePage: (() => void) | null = null
let stopWatchingAppRuns: (() => void) | null = null
let unsubOpenRunningApp: (() => void) | null = null
onMounted(() => {
  unsubShowHomePage = window.api.onShowHomePage(showHomePage)
  stopWatchingAppRuns = watchAppRuns()
  unsubOpenRunningApp = window.api.onOpenRunningApp((appId) => void openRunningApp(appId))
})
onUnmounted(() => {
  unsubShowHomePage?.()
  stopWatchingAppRuns?.()
  unsubOpenRunningApp?.()
})

const installation = computed<Installation | null>(() =>
  installationId ? (installationStore.getById(installationId) ?? null) : null
)

let resolveBootstrap: (() => void) | null = null
const bootstrapReady: Promise<void> = new Promise<void>((resolve) => {
  resolveBootstrap = resolve
})

const progressRef = ref<InstanceType<typeof ProgressModal> | null>(null)
const newInstallRef = ref<InstanceType<typeof InstallWizardModal> | null>(null)
const trackRef = ref<InstanceType<typeof TrackModal> | null>(null)
const loadSnapshotRef = ref<InstanceType<typeof LoadSnapshotModal> | null>(null)
const firstUseRef = ref<InstanceType<typeof FirstUseTakeover> | null>(null)
const migrateTakeoverRef = ref<InstanceType<typeof MigrateConfirmTakeover> | null>(null)

let overlays!: ReturnType<typeof usePanelOverlays>
let chooserHandoff!: ReturnType<typeof useChooserHandoff>

const firstUseChain = useFirstUseChain({
  dismissTakeoverDirect: () => overlays.dismissTakeoverDirect(),
  switchPanel: (panel, entrypoint) => overlays.switchPanel(panel, entrypoint),
  handleShowProgress: (showOpts) => overlays.handleShowProgress(showOpts),
  performChooserLaunch: (inst, onMissing) => chooserHandoff.performChooserLaunch(inst, onMissing),
  openFirstUseTakeover: () => overlays.openFirstUseTakeover(),
  resetFirstUseSpinner: () => firstUseRef.value?.resetContinue(),
  changeInstallLocation: () => firstUseRef.value?.browseInstallLocation()
})
const {
  chainingFirstUseToNewInstall,
  setupConsent,
  savedSetup,
  completeFirstUseAndDismiss,
  handleSetupInstall,
  handleSetupChange,
  handleSetupLocationChange,
  handleNewInstallConsentChange,
  handleFirstUseChainMigrate,
  handleNewInstallTakeoverClose,
  handleNewInstallBackToSetup,
  handleNewInstallSaveSetup
} = firstUseChain

overlays = usePanelOverlays({
  installationId,
  progressRef,
  newInstallRef,
  trackRef,
  loadSnapshotRef,
  firstUseRef,
  prepareChooserHostHandoff: (id) => chooserHandoff.prepareChooserHostHandoff(id),
  firstUseChain: firstUseChain.hooks,
  onBackgroundInstall: () => void showHome(),
  onBuildCreated: (id) => landOnNewBuild(id),
  launchesInPlace: (id) => chooserHandoff.launchesInPlace(id)
})
const {
  activePanel,
  initialPanel,
  currentOverlay,
  openOverlay,
  closeOverlay,
  answerCloseRequest,
  handleShowProgress,
  handleProgressClose,
  openFirstUseTakeover,
  dismissTakeoverDirect,
  switchPanel
} = overlays

const buildProgressId = ref<string | null>(null)
provideBuildLogs((id) => {
  buildProgressId.value = id
})

if (params.get('e2e') === '1') {
  bindE2EPanelHooks({
    showProgress: handleShowProgress,
    actionGuard: useActionGuard()
  })
}

type DashboardHomePage = Extract<
  DashboardPage,
  'home' | 'workflows' | 'apps' | 'chooser' | 'assets' | 'staff-apps'
>

type AppHomePage = Extract<DashboardHomePage, 'apps' | 'staff-apps'>

const staffApps = useStaffApps()
const liveStaffApps = computed(() => staffApps.apps.value.filter((app) => app.page === 'live'))

const urlDashboardPage = params.get('dashboardPage')
const dashboardHomePage = ref<DashboardHomePage>(
  isNewWindowDashboardPage(urlDashboardPage) ? urlDashboardPage : 'home'
)

const sidebarPage = computed<DashboardPage | null>(() => {
  const panel = activePanel.value
  if (panel === 'chooser') {
    const openedFromDevelopment =
      dashboardHomePage.value === 'apps' && appIsOpen.value && appHome.value === 'staff-apps'
    return openedFromDevelopment ? 'staff-apps' : dashboardHomePage.value
  }
  return panel === 'benchmarks' || panel === 'performance-test' ? panel : null
})

const buildDetailsId = ref<string | null>(null)
const dashboardScope = useDashboardScopeStore()
const workspaceInstallations = computed(() =>
  installationStore.installations.filter((inst) =>
    isInstallationInWorkspace(inst, dashboardScope.selectedWorkspaceId)
  )
)
const buildDetailsInstall = computed(() => {
  const inst = buildDetailsId.value ? installationStore.getById(buildDetailsId.value) : undefined
  return inst && isInstallationInWorkspace(inst, dashboardScope.selectedWorkspaceId) ? inst : null
})

function openBuildDetails(inst: Installation): void {
  buildDetailsId.value = inst.id
}

function closeBuildDetails(): void {
  buildDetailsId.value = null
}

watch(activePanel, closeBuildDetails)
watch(buildDetailsInstall, (inst) => {
  if (!inst) closeBuildDetails()
})

const sidebarBuildId = computed(() =>
  activePanel.value === 'chooser' && dashboardHomePage.value === 'chooser'
    ? (buildDetailsInstall.value?.id ?? null)
    : null
)

async function openBuildFromSidebar(inst: Installation): Promise<void> {
  dashboardHomePage.value = 'chooser'
  if (activePanel.value !== 'chooser') {
    window.api.navigatePanel('chooser')
    await switchPanel('chooser', 'sidebar')
    await nextTick()
  }
  openBuildDetails(inst)
}

const NEW_BUILD_REFRESH_DELAYS_MS = [0, 1000, 3000]

function landOnNewBuild(id: string): void {
  const startedIn = dashboardScope.selectedWorkspaceId
  const open = (inst: Installation | undefined): boolean => {
    if (!inst) return false
    const stillWhereItStarted = dashboardScope.selectedWorkspaceId === startedIn
    if (stillWhereItStarted && isInstallationInWorkspace(inst, startedIn)) {
      void openBuildFromSidebar(inst)
    }
    return true
  }
  if (open(installationStore.getById(id))) return
  let waiting = true
  const land = (inst: Installation | undefined): boolean => {
    if (!waiting || !open(inst)) return !waiting
    waiting = false
    stop()
    return true
  }
  const stop = watch(
    () => installationStore.getById(id),
    (inst) => {
      land(inst)
    }
  )
  void (async () => {
    for (const delay of NEW_BUILD_REFRESH_DELAYS_MS) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      if (!waiting) return
      await installationStore.fetchInstallations().catch(() => {})
      if (land(installationStore.getById(id))) return
    }
    if (!waiting) return
    waiting = false
    stop()
    console.warn('[builds] the copied build could not be listed, so its page was not opened', id)
  })()
}

async function showHome(): Promise<void> {
  closeBuildDetails()
  dashboardHomePage.value = 'home'
  if (activePanel.value !== 'chooser') await switchPanel('chooser', 'install')
  window.api.navigatePanel('home')
}

const appsVisits = ref(0)
const appIsOpen = ref(false)
const assetsFocusName = ref<string | null>(null)
const appPickedOnHome = ref<AppCard | null>(null)
const selectedWorkflow = ref<CatalogWorkflow | null>(null)
const appInProgress = ref<AppCard | null>(null)
const listedApps = ref<AppCard[] | null>(null)
let stayOnAppsAfterClose = false
const draftsOpenedFromDevelopment = new Set<string>()

function homePageOf(app: AppCard): AppHomePage {
  if (draftsOpenedFromDevelopment.has(app.id)) return 'staff-apps'
  if (listedApps.value?.some((listed) => listed.id === app.id)) return 'apps'
  return liveStaffApps.value.some((staffApp) => staffApp.id === app.id) ? 'staff-apps' : 'apps'
}

const openedAppHome = ref<AppHomePage>('apps')
const appHome = computed<AppHomePage>(() => (staffApps.shown.value ? openedAppHome.value : 'apps'))

const confirmAppSwitch = useAppSwitchConfirm()

function showApp(app: AppCard): void {
  stayOnAppsAfterClose = false
  appPickedOnHome.value = app
  dashboardHomePage.value = 'apps'
}

function noteCurrentApp(app: AppCard | null): void {
  appInProgress.value = app
  if (app) openedAppHome.value = homePageOf(app)
}

function noteAppOpen(open: boolean): void {
  const closed = appIsOpen.value && !open
  appIsOpen.value = open
  if (!closed || stayOnAppsAfterClose || dashboardHomePage.value !== 'apps') return
  if (appHome.value === 'staff-apps') dashboardHomePage.value = 'staff-apps'
}

let navigation = 0
watch([sidebarPage, appInProgress, appsVisits], () => {
  navigation += 1
})

async function switchStillWanted(app: AppCard): Promise<boolean> {
  const started = ++navigation
  const stillCurrent = () => started === navigation
  const confirmed = await confirmAppSwitch(app, appInProgress.value?.id ?? null, stillCurrent)
  return confirmed && stillCurrent()
}

async function openAppFromHome(app: AppCard): Promise<void> {
  if (await switchStillWanted(app)) showApp(app)
}

watch(staffApps.shown, (shown) => {
  if (shown || dashboardHomePage.value !== 'staff-apps') return
  if (sidebarPage.value !== 'staff-apps') {
    dashboardHomePage.value = 'apps'
    return
  }
  window.api.navigatePanel('apps')
  handleSidebarNavigate('apps')
})

async function runningAppCard(appId: string): Promise<AppCard | undefined> {
  const apps = listedApps.value ?? (await window.api.listApps().catch(() => []))
  return (
    apps.find((listed) => listed.id === appId) ??
    liveStaffApps.value.find((staffApp) => staffApp.id === appId)
  )
}

async function openRunningApp(appId: string): Promise<void> {
  const app = await runningAppCard(appId)
  if (!app || !(await switchStillWanted(app))) return
  if (activePanel.value !== 'chooser') {
    window.api.navigatePanel('apps')
    await switchPanel('chooser', 'titlebar')
    await nextTick()
  }
  closeBuildDetails()
  assetsFocusName.value = null
  showApp(app)
}

async function confirmLeavingRuns(): Promise<boolean> {
  const running = [...runningAppIds.value]
  if (running.length === 0) return true
  const [onlyId] = running
  const onlyApp = running.length === 1 && onlyId ? await runningAppCard(onlyId) : null
  const choice = await dialogs.confirm({
    title: t('apps.closeWhileRunning.title'),
    message: onlyApp
      ? t('apps.closeWhileRunning.bodyOne', { app: onlyApp.title })
      : t('apps.closeWhileRunning.bodyMany', { count: running.length }, running.length),
    confirmLabel: t('apps.closeWhileRunning.close'),
    cancelLabel: t('apps.closeWhileRunning.cancel')
  })
  return choice === 'primary'
}

async function openStaffDraft(app: HiddenAppCard): Promise<void> {
  const request = await window.api.openHiddenAppDraft(app.id).catch(() => null)
  if (request) await answerDraftApp(request, 'staff-apps')
}

async function openStaffHubPage(app: HiddenAppCard): Promise<void> {
  const opened = await window.api.openHiddenAppHubPage(app.id).catch(() => false)
  if (!opened) await dialogs.alert({ title: t('staffApps.hubFailed') })
}

async function answerDraftApp(
  request: DraftAppRequest,
  openedFrom: AppHomePage = 'apps'
): Promise<void> {
  if (request.kind === 'refused') {
    await dialogs.alert({ title: request.title, message: request.message })
    return
  }
  if (request.kind === 'ask') {
    const choice = await dialogs.confirm({
      title: request.title,
      message: request.message,
      confirmLabel: 'Open',
      cancelLabel: 'Cancel'
    })
    const accepted = choice === 'primary' ? await window.api.acceptDraftApp(request.token) : null
    if (accepted) await answerDraftApp(accepted, openedFrom)
    return
  }
  if (!(await switchStillWanted(request.card))) return
  if (openedFrom === 'staff-apps') draftsOpenedFromDevelopment.add(request.card.id)
  else draftsOpenedFromDevelopment.delete(request.card.id)
  if (activePanel.value !== 'chooser') await switchPanel('chooser', 'install')
  closeBuildDetails()
  assetsFocusName.value = null
  showApp(request.card)
}

const SIDEBAR_PAGE_OPENED_EVENT = 'comfy.desktop.sidebar.page_opened'

function handleSidebarClick(page: DashboardPage): void {
  const fromPage = sidebarPage.value
  if (page !== fromPage) {
    emitTelemetryAction(SIDEBAR_PAGE_OPENED_EVENT, { page, from_page: fromPage })
  }
  handleSidebarNavigate(page)
}

function returnToApp(app: AppCard): void {
  emitTelemetryAction(SIDEBAR_PAGE_OPENED_EVENT, {
    page: 'apps',
    from_page: sidebarPage.value,
    to_app_in_progress: true
  })
  closeBuildDetails()
  assetsFocusName.value = null
  void openAppFromHome(app)
}

function viewInAssets(name: string): void {
  handleSidebarNavigate('assets')
  assetsFocusName.value = name
}

function handleSidebarNavigate(page: DashboardPage): void {
  closeBuildDetails()
  assetsFocusName.value = null
  if (page === 'apps' || page === 'workflows') {
    stayOnAppsAfterClose = true
    appsVisits.value += 1
  }
  if (page === 'staff-apps' && !staffApps.shown.value) return
  if (
    page === 'home' ||
    page === 'workflows' ||
    page === 'apps' ||
    page === 'chooser' ||
    page === 'assets' ||
    page === 'staff-apps'
  )
    dashboardHomePage.value = page
}

function retryLaunch(id: string): void {
  buildProgressId.value = null
  const inst = installationStore.getById(id)
  if (inst) void handleChooserPick(inst)
}

async function launchFromBuildDetails(inst: Installation): Promise<void> {
  if (await focusRunningBuild(inst)) return
  await handleChooserPick(inst)
}

const firstUseTakeoverActive = computed(
  () => currentOverlay.value?.kind === 'takeover' && currentOverlay.value.component === 'first-use'
)

const showPanelBody = computed(() => {
  if (firstUseTakeoverActive.value) return false
  if (urlFirstUseCompleted) return true
  return launcherPrefsLoaded.value && firstUseCompleted.value
})

const showSidebar = computed(() => showPanelBody.value && sidebarPage.value !== null)

const homeTourInterrupted = computed(
  () => feedbackOpen.value || modal.state.visible || dialogs.state.open
)

const homeTourCanShow = computed(
  () =>
    showSidebar.value &&
    sidebarPage.value === 'home' &&
    currentOverlay.value === null &&
    !feedbackOpen.value &&
    buildProgressId.value === null &&
    !modal.state.visible &&
    !dialogs.state.open
)

const performanceTestRunActive = ref(false)

chooserHandoff = useChooserHandoff({
  showProgress: handleShowProgress,
  switchPanel,
  hostOwnsPerformanceTestRun: () => performanceTestRunActive.value
})
const { handleChooserPick, handleChooserShowNewInstall } = chooserHandoff

provideAutoStartBuild()
provideOpenWhenReady((build) => void handleChooserPick(build))
provideBuildMenuHost({
  launch: (inst, launchOpts) => handleChooserPick(inst, launchOpts),
  openDetails: openBuildFromSidebar,
  showProgress: handleShowProgress
})

if (!installationId) {
  watch(currentOverlay, (next, prev) => {
    if (prev && !next) {
      void window.api.releaseAttachHostPreview()
    }
  })
}

let unsubPanel: (() => void) | null = null
let unsubCloseRequest: (() => void) | null = null
let unsubReturnToDashboardRequest: (() => void) | null = null
let unsubAppUpdatePromptRestart: (() => void) | null = null
let unsubAppUpdateUserActionFailed: (() => void) | null = null
let unsubAppPageClosed: (() => void) | null = null
let unsubOpenDraftApp: (() => void) | null = null
const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

const { triggerAction: triggerInstallAction, viewError: viewBuildError } = useInstallContextMenu({
  onStartAgain: (inst) => launchFromBuildDetails(inst),
  onManage: (inst, manageOpts) => {
    const autoAction = manageOpts?.autoAction ?? null
    const initialTab = manageOpts?.initialTab
    if (initialTab === undefined && autoAction === null) {
      window.api.openInstancePicker({ installationId: inst.id })
      return
    }
    window.api.openInstancePicker({
      installationId: inst.id,
      initialTab: resolvePickerTab(initialTab, 'config'),
      autoAction
    })
  },
  onShowProgress: (showOpts) => handleShowProgress(showOpts)
})

useDeepLinkRouter({
  installationId,
  bootstrapReady,
  openOverlay,
  showAppUpdateRestartPrompt,
  showAppUpdateDownloadPrompt,
  pickInstallFromPicker: async (inst, pickOpts) => {
    const launchOpts = {
      isRestart: pickOpts?.isRestart === true,
      pickerWorkspaceId: pickOpts?.pickerWorkspaceId
    }
    if (!installationId) {
      await chooserHandoff.handleChooserPick(inst, launchOpts)
    } else {
      await chooserHandoff.performPickerLaunch(inst, launchOpts)
    }
  },
  runInstallActionFromPicker: async (inst, actionId) => {
    await triggerInstallAction(actionId, inst)
  },
  showProgressFromPicker: (showOpts) => handleShowProgress(showOpts)
})

function handleProgressSuccessChoice(actionId: string, targetInstallationId: string): void {
  if (actionId === SUCCESS_ACTION_OPEN_INSTANCE) {
    if (!installationId) {
      const inst = installationStore.getById(targetInstallationId)
      if (inst) {
        void handleChooserPick(inst)
        return
      }
    }
    void window.api.openInstallWindow(targetInstallationId)
    return
  }
  if (actionId === SUCCESS_ACTION_GO_DASHBOARD) {
    void window.api.returnToDashboard()
  }
}

watch(
  activePanel,
  (next) => {
    const isOverlay = next === 'feedback'
    document.body.classList.toggle('panel-overlay-mode', isOverlay)
    if (!isOverlay) return
    void nextTick(() => window.api.signalOverlayReady())
  },
  { immediate: true }
)

onMounted(async () => {
  registerMigrateTakeover({
    open: (title, confirmLabel) => migrateTakeoverRef.value!.open(title, confirmLabel),
    update: (opts) => migrateTakeoverRef.value?.update(opts)
  })

  unsubPanel = window.api.onPanelSwitch((data) => {
    if (isValidPanel(data.panel)) {
      void switchPanel(data.panel)
    }
  })

  unsubCloseRequest = window.api.onCloseRequest(({ requestId }) => {
    window.api.ackCloseRequest({ requestId })
    void (async () => {
      const answer = (await confirmLeavingRuns()) ? await answerCloseRequest() : { cleared: false }
      window.api.respondCloseRequest({ requestId, ...answer })
    })()
  })

  unsubReturnToDashboardRequest = window.api.onReturnToDashboardRequest(({ requestId }) => {
    window.api.ackReturnToDashboardRequest({ requestId })
    void (async () => {
      const { cleared, reason } = await (async (): Promise<{
        cleared: boolean
        reason: 'in_flight' | 'running' | 'stopped' | 'crashed'
      }> => {
        try {
          if (currentOverlay.value !== null) {
            return { cleared: await closeOverlay(), reason: 'in_flight' }
          }
          const id = installationId
          const inst = id ? (installationStore.getById(id) ?? null) : null
          const r: 'running' | 'crashed' | 'stopped' =
            id && sessionStore.isRunning(id)
              ? 'running'
              : id && sessionStore.errorInstances.has(id)
                ? 'crashed'
                : 'stopped'
          return { cleared: await confirmReturnToDashboard(inst, r), reason: r }
        } catch (err) {
          console.error('return-to-dashboard consult failed', err)
          return { cleared: false, reason: 'stopped' }
        }
      })()
      if (cleared) {
        emitTelemetryAction('comfy.desktop.instance.return_to_dashboard', {
          from: 'menu',
          reason
        })
      }
      window.api.respondReturnToDashboardRequest({ requestId, cleared })
    })()
  })

  unsubAppUpdatePromptRestart = window.api.onAppUpdatePromptRestart(({ version }) => {
    void showAppUpdateRestartPrompt(version || null)
  })

  unsubAppUpdateUserActionFailed = window.api.onAppUpdateUserActionFailed(({ message }) => {
    void modal.alert({
      title: t('appUpdate.errorTitle'),
      message
    })
  })

  unsubAppPageClosed = window.api.onAppPageClosed(() => {
    appInProgress.value = null
  })

  unsubOpenDraftApp = window.api.onOpenDraftApp((request) => void answerDraftApp(request))

  try {
    const shouldOpenFirstUse =
      urlFirstUsePending ||
      (!urlFirstUseCompleted && (!launcherPrefsLoaded.value || !firstUseCompleted.value))

    if (shouldOpenFirstUse && !isFlowPanel(initialPanel)) {
      void openFirstUseTakeover()
    }

    await Promise.all([
      sessionStore.init(),
      installationStore.fetchInstallations(),
      launcherPrefs.loadPrefs(),
      syncLocale().catch((err) => {
        console.error('Panel: syncLocale failed', err)
      })
    ])

    if (isFlowPanel(initialPanel)) {
      void switchPanel(initialPanel, 'url')
    }

    if (!firstUseCompleted.value && !isFlowPanel(initialPanel)) {
      void openFirstUseTakeover()
    }
  } catch (err) {
    console.error('Panel: bootstrap failed', err)
  } finally {
    resolveBootstrap?.()
    resolveBootstrap = null
  }
})

onUnmounted(() => {
  registerMigrateTakeover(null)
  unsubPanel?.()
  unsubCloseRequest?.()
  unsubReturnToDashboardRequest?.()
  unsubAppUpdatePromptRestart?.()
  unsubAppUpdateUserActionFailed?.()
  unsubAppPageClosed?.()
  unsubOpenDraftApp?.()
  document.body.classList.remove('panel-overlay-mode')
  sessionStore.dispose()
  if (params.get('e2e') === '1') bindE2EPanelHooks(null)
})
</script>

<template>
  <div
    class="panel-shell flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-text [body.panel-overlay-mode_&]:bg-transparent"
  >
    <div
      class="panel-frame flex min-h-0 flex-1"
      :class="showSidebar && 'gap-2 bg-window-background p-2'"
    >
      <AppSidebar
        v-if="showSidebar && sidebarPage"
        :active-page="sidebarPage"
        :active-build-id="sidebarBuildId"
        :make-room="appIsOpen"
        :app-in-progress="appInProgress"
        :app-home="appHome"
        :show-staff-apps="staffApps.shown.value"
        @navigate="handleSidebarClick"
        @open-app="returnToApp"
        @open-build="openBuildFromSidebar"
        @create="handleChooserPick"
        @new-build="handleChooserShowNewInstall"
      />
      <main
        class="panel-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-7 py-6 [&:has(:is(.panel-comfy-lifecycle,.panel-chooser,.panel-performance-test,.panel-benchmarks))]:p-0"
        :class="showSidebar && 'rounded-shell bg-[var(--bg)]'"
      >
        <div v-if="showPanelBody" class="panel-body flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            v-if="activePanel === 'comfy-lifecycle'"
            class="panel-comfy-lifecycle flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <ComfyLifecycleView
              :installation="installation"
              :installation-id="installationId"
              @show-progress="handleShowProgress"
            />
          </div>

          <div
            v-else-if="activePanel === 'chooser'"
            class="panel-chooser flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <HomeView
              v-if="dashboardHomePage === 'home'"
              @open-app="openAppFromHome"
              @pick="handleChooserPick"
              @open-build="openBuildFromSidebar"
              @show-builds="dashboardHomePage = 'chooser'"
              @show-apps="handleSidebarNavigate('apps')"
              @show-workflows="handleSidebarNavigate('workflows')"
              @open-workflow="selectedWorkflow = $event"
              @new-build="handleChooserShowNewInstall"
            />
            <AppsView
              v-else-if="dashboardHomePage === 'apps' || dashboardHomePage === 'workflows'"
              v-model:start-with="appPickedOnHome"
              :tab="dashboardHomePage"
              :revisit="appsVisits"
              @app-open-change="noteAppOpen"
              @current-app="noteCurrentApp"
              @apps-loaded="listedApps = $event"
              @view-in-assets="viewInAssets"
              @open-workflow="selectedWorkflow = $event"
            />
            <StaffAppsView
              v-else-if="dashboardHomePage === 'staff-apps' && staffApps.shown.value"
              :apps="staffApps.apps.value"
              @open-app="openAppFromHome"
              @open-draft="openStaffDraft"
              @open-hub-page="openStaffHubPage"
            />
            <AssetsView
              v-else-if="dashboardHomePage === 'assets'"
              :installation-id="installationId"
              :focus-name="assetsFocusName"
              @focus-used="assetsFocusName = null"
            />
            <BuildDetailsView
              v-else-if="buildDetailsInstall"
              :installation="buildDetailsInstall"
              @back="closeBuildDetails"
              @launch="launchFromBuildDetails"
              @show-progress="handleShowProgress"
              @view-error="viewBuildError"
            />
            <ChooserView
              :visible="dashboardHomePage === 'chooser' && !buildDetailsInstall"
              @pick="handleChooserPick"
              @open-details="openBuildDetails"
              @show-new-install="handleChooserShowNewInstall"
              @show-build-import="switchPanel($event, 'chooser')"
            />
          </div>

          <KeepAlive>
            <BenchmarksView v-if="activePanel === 'benchmarks'" class="panel-benchmarks" />
            <PerformanceTestView
              v-else-if="activePanel === 'performance-test'"
              class="panel-performance-test flex min-h-0 flex-col overflow-hidden [&.panel-performance-test]:flex-1"
              @run-active-change="performanceTestRunActive = $event"
            />
          </KeepAlive>
        </div>
      </main>
    </div>

    <CatalogWorkflowDialog
      v-if="selectedWorkflow"
      :key="selectedWorkflow.id"
      :workflow="selectedWorkflow"
      :installations="workspaceInstallations"
      :workspace-id="dashboardScope.selectedWorkspaceId"
      @close="selectedWorkflow = null"
    />

    <template v-if="currentOverlay?.kind === 'takeover'">
      <ProgressModal
        v-if="currentOverlay.component === 'update'"
        ref="progressRef"
        :installation-id="currentOverlay.installationId ?? ''"
        @close="handleProgressClose"
        @success-choice="handleProgressSuccessChoice"
      />
      <InstallWizardModal
        v-else-if="currentOverlay.component === 'new-install'"
        ref="newInstallRef"
        :hide-back-to-dashboard="chainingFirstUseToNewInstall"
        @close="handleNewInstallTakeoverClose"
        @navigate-list="handleNewInstallTakeoverClose"
        @show-progress="handleShowProgress"
        @back-to-setup="handleNewInstallBackToSetup"
        @save-setup="handleNewInstallSaveSetup"
        @consent-change="handleNewInstallConsentChange"
      />
      <TrackModal
        v-else-if="currentOverlay.component === 'track'"
        ref="trackRef"
        @close="dismissTakeoverDirect"
        @navigate-list="dismissTakeoverDirect"
      />
      <LoadSnapshotModal
        v-else-if="currentOverlay.component === 'load-snapshot'"
        ref="loadSnapshotRef"
        @close="dismissTakeoverDirect"
        @show-progress="handleShowProgress"
      />
      <FirstUseTakeover
        v-else-if="currentOverlay.component === 'first-use'"
        ref="firstUseRef"
        :consent="setupConsent"
        :saved-plan="savedSetup?.plan ?? null"
        @install="handleSetupInstall"
        @change="handleSetupChange"
        @location-change="handleSetupLocationChange"
        @complete-skip="completeFirstUseAndDismiss"
        @chain-migrate="handleFirstUseChainMigrate"
      />
    </template>

    <BuildProgressDialog
      v-if="buildProgressId"
      :installation-id="buildProgressId"
      @close="buildProgressId = null"
      @retry="retryLaunch(buildProgressId)"
    />
    <FeedbackModal
      :open="feedbackOpen"
      :hidden-fields="feedbackHiddenFields"
      @close="closeFeedback"
    />
    <HomeTour :active="homeTourCanShow" :interrupted="homeTourInterrupted" />

    <ModalDialog />
    <DialogHost />
    <MigrateConfirmTakeover ref="migrateTakeoverRef" />
  </div>
</template>
