<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ProgressModal from '../views/ProgressModal.vue'
import ModalDialog from '../components/ModalDialog.vue'
import DialogHost from '../components/DialogHost.vue'
import FeedbackModal from '../components/FeedbackModal.vue'
import AnnouncementModal from '../components/AnnouncementModal.vue'
import AppSidebar from './AppSidebar.vue'
import BuildProgressDialog from './BuildProgressDialog.vue'
import BuildDetailsView from './BuildDetailsView.vue'
import HomeView from './HomeView.vue'
import ComfyLifecycleView from './ComfyLifecycleView.vue'
import AssetsView from './AssetsView.vue'
import AppsView from './AppsView.vue'
import ChooserView from '../views/ChooserView.vue'
import PerformanceTestView from '../views/PerformanceTestView.vue'
import BenchmarksView from '../views/BenchmarksView.vue'
import InstallWizardModal from '../views/InstallWizardModal.vue'
import TrackModal from '../views/TrackModal.vue'
import LoadSnapshotModal from '../views/LoadSnapshotModal.vue'
import QuickInstallModal from '../views/QuickInstallModal.vue'
import FirstUseTakeover from '../views/FirstUseTakeover.vue'
import MigrateConfirmTakeover from '../views/MigrateConfirmTakeover.vue'
import { useTheme } from '../composables/useTheme'
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
import { useAnnouncement } from '../composables/useAnnouncement'
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
import { provideAutoStartBuild } from '../composables/useAutoStartBuild'
import { focusRunningBuild } from '../lib/focusRunningBuild'
import type { AppCard, DashboardPage, Installation } from '../types/ipc'

const { t } = useI18n()
const { syncLocale } = useAppLocale(windowApiLocaleSource())
useTheme()

const params = new URLSearchParams(window.location.search)
const installationId = params.get('installationId') || ''
seedLauncherPrefsFromUrl(window.location.search)
const urlFirstUseCompleted = params.get('firstUseCompleted') === 'true'
const urlFirstUsePending = params.get('firstUseCompleted') === 'false'

const sessionStore = useSessionStore()
const installationStore = useInstallationStore()
const launcherPrefs = useLauncherPrefs()
void launcherPrefs.loadPrefs()
const { loaded: launcherPrefsLoaded, firstUseCompleted } = launcherPrefs

const modal = useModal()
useAdoptPromptBridge()
const { showAppUpdateRestartPrompt, showAppUpdateDownloadPrompt } = useAppUpdatePrompts()
const { feedbackOpen, feedbackHiddenFields, closeFeedback } = useSendFeedback()
const { announcementOpen, closeAnnouncement } = useAnnouncement()

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
const quickInstallRef = ref<InstanceType<typeof QuickInstallModal> | null>(null)
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
  resetFirstUseSpinner: () => firstUseRef.value?.resetContinue()
})
const {
  chainingFirstUseToNewInstall,
  setupConsent,
  savedSetup,
  completeFirstUseAndDismiss,
  handleSetupInstall,
  handleSetupChange,
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
  quickInstallRef,
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

type DashboardHomePage = Extract<DashboardPage, 'home' | 'apps' | 'chooser' | 'assets'>

const urlDashboardPage = params.get('dashboardPage')
const dashboardHomePage = ref<DashboardHomePage>(
  isNewWindowDashboardPage(urlDashboardPage) ? urlDashboardPage : 'home'
)

const sidebarPage = computed<DashboardPage | null>(() => {
  const panel = activePanel.value
  if (panel === 'chooser') return dashboardHomePage.value
  return panel === 'benchmarks' || panel === 'performance-test' ? panel : null
})

const buildDetailsId = ref<string | null>(null)
const dashboardScope = useDashboardScopeStore()
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

function openAppFromHome(app: AppCard): void {
  appPickedOnHome.value = app
  dashboardHomePage.value = 'apps'
}

const SIDEBAR_PAGE_OPENED_EVENT = 'comfy.desktop.sidebar.page_opened'

function handleSidebarClick(page: DashboardPage): void {
  const fromPage = sidebarPage.value
  if (page !== fromPage) {
    emitTelemetryAction(SIDEBAR_PAGE_OPENED_EVENT, { page, from_page: fromPage })
  }
  handleSidebarNavigate(page)
}

function viewInAssets(name: string): void {
  handleSidebarNavigate('assets')
  assetsFocusName.value = name
}

function handleSidebarNavigate(page: DashboardPage): void {
  closeBuildDetails()
  assetsFocusName.value = null
  if (page === 'apps') appsVisits.value += 1
  if (page === 'home' || page === 'apps' || page === 'chooser' || page === 'assets')
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

const performanceTestRunActive = ref(false)

chooserHandoff = useChooserHandoff({
  showProgress: handleShowProgress,
  switchPanel,
  hostOwnsPerformanceTestRun: () => performanceTestRunActive.value
})
const { handleChooserPick, handleChooserShowNewInstall } = chooserHandoff

provideAutoStartBuild()
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
const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

const { triggerAction: triggerInstallAction } = useInstallContextMenu({
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
    const isOverlay = next === 'feedback' || next === 'announcement'
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
      window.api.respondCloseRequest({ requestId, ...(await answerCloseRequest()) })
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
        @navigate="handleSidebarClick"
        @open-build="openBuildFromSidebar"
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
              @new-build="handleChooserShowNewInstall"
            />
            <AppsView
              v-else-if="dashboardHomePage === 'apps'"
              v-model:start-with="appPickedOnHome"
              :revisit="appsVisits"
              @app-open-change="appIsOpen = $event"
              @view-in-assets="viewInAssets"
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
      <QuickInstallModal
        v-else-if="currentOverlay.component === 'quick-install'"
        ref="quickInstallRef"
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
    <AnnouncementModal v-if="announcementOpen" @close="closeAnnouncement" />

    <ModalDialog />
    <DialogHost />
    <MigrateConfirmTakeover ref="migrateTakeoverRef" />
  </div>
</template>
