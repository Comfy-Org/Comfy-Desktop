<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowDownToLine,
  Bell,
  House,
  Menu as MenuIcon,
  MessageSquarePlus,
  RotateCw,
  ZoomIn
} from '@lucide/vue'
import { useTitleBarTooltip } from './useTitleBarTooltip'
import { useTitleBarMenus } from './useTitleBarMenus'
import { useTitleBarIdentity } from './useTitleBarIdentity'
import { useTitleBarHoverGate } from './useTitleBarHoverGate'
import { useBetaActivationNotice } from './useBetaActivationNotice'
import { useAppLocale, windowApiLocaleSource } from '../lib/useAppLocale'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'

const { t, locale } = useI18n()
const { syncLocale } = useAppLocale(windowApiLocaleSource())

type ComfyPanelKey =
  | 'comfy'
  | 'performance-test'
  | 'benchmarks'
  | 'new-install'
  | 'track'
  | 'load-snapshot'
  | 'quick-install'

type CoachmarkKind = 'beta-notice'

interface MenuAnchor {
  x: number
  y: number
}

interface DownloadsTrayEntry {
  url: string
  filename: string
  directory?: string
  progress: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
}

interface DownloadsTrayState {
  active: DownloadsTrayEntry[]
  recent: DownloadsTrayEntry[]
}

interface Bridge {
  getInstallationId: () => string | null
  isMac: () => boolean
  isLinux: () => boolean
  setPanel: (panel: ComfyPanelKey) => void
  openNewWindow: () => void
  openFileMenu: (anchor: MenuAnchor) => void
  dismissFileMenu: () => void
  showTooltip: (payload: { text: string; leftX: number; rightX: number; bottomY: number }) => void
  hideTooltip: () => void
  showCoachmark: (payload: {
    kind?: CoachmarkKind
    title: string
    body: string
    dismissLabel: string
    actionLabel?: string
    leftX: number
    rightX: number
    bottomY: number
  }) => void
  hideCoachmark: () => void
  onCoachmarkDismissed: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  onCoachmarkAction: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  onCoachmarkAutoHidden: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  onCoachmarkSettled: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  onCoachmarkDisplaced: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  onPanelChanged: (cb: (panel: ComfyPanelKey) => void) => () => void
  onTitleChanged: (cb: (title: string) => void) => () => void
  onSourceCategoryChanged: (cb: (category: string | null) => void) => () => void
  onZoomChanged: (cb: (level: number) => void) => () => void
  onThemeChanged: (cb: (theme: { bg: string; text: string }) => void) => () => void
  onFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  onMenuOpened: (cb: (info: { menu: 'menu' | 'downloads' }) => void) => () => void
  onMenuClosed: (cb: (info: { menu: 'menu' | 'downloads' }) => void) => () => void
  onFirstUseModeChanged: (
    cb: (mode: 'none' | 'consent-lockdown' | 'post-consent') => void
  ) => () => void
  onPreviewModeChanged: (cb: (preview: boolean) => void) => () => void
  onInstallationIdChanged: (cb: (installationId: string | null) => void) => () => void
  onAppUpdateStateChanged: (
    cb: (state: {
      kind: 'available' | 'downloading' | 'ready' | null
      version: string | null
      autoUpdate: boolean
    }) => void
  ) => () => void
  onInstallUpdateAvailable: (
    cb: (state: { available: boolean; version: string | null }) => void
  ) => () => void
  clickAppUpdatePill: () => void
  clickInstallUpdatePill: () => void
  onDownloadsChanged: (cb: (state: DownloadsTrayState) => void) => () => void
  clickDownloadsTray: (anchor: MenuAnchor) => void
  clickFeedback: () => void
  clickAnnouncement: () => void
  clickRefreshInstance: () => void
  clickHome: () => void
  resetZoom: () => void
  ready: () => void
}

const bridge = (window as unknown as { __comfyTitleBar?: Bridge }).__comfyTitleBar

const titleMenuButtonClass =
  '[-webkit-app-region:no-drag] inline-flex items-center gap-0 rounded-[4px] border border-solid border-transparent bg-transparent px-1.5 py-1 [font:inherit] text-[var(--titlebar-icon)] opacity-85 cursor-pointer transition-[background-color,opacity,border-color] duration-[120ms] ease-[ease] [.title-bar:not(.is-light)_&]:rounded-control [.title-bar.is-hover-active_&]:hover:opacity-100 [.title-bar.is-hover-active_&]:hover:bg-[rgba(255,255,255,0.08)] [.title-bar.is-hover-active_&]:hover:border-[rgba(255,255,255,0.18)] [.title-bar.is-light.is-hover-active_&]:hover:bg-[rgba(0,0,0,0.06)] [.title-bar.is-light.is-hover-active_&]:hover:border-[rgba(0,0,0,0.18)] [.title-bar.is-hover-active:not(.is-light)_&]:hover:bg-secondary [.title-bar.is-hover-active:not(.is-light)_&]:hover:border-transparent'

const titleInstallPillClass = [
  '[-webkit-app-region:no-drag] inline-flex h-7 items-center gap-2 [inline-size:fit-content] [min-inline-size:200px] [max-inline-size:clamp(200px,22cqi,360px)] rounded-[999px] border border-solid border-transparent bg-[var(--chooser-surface-bg)] py-[5px] pr-2.5 pl-3 [font-family:inherit] text-[12px] leading-[inherit] font-normal text-neutral-100 cursor-default transition-[background-color,border-color,color] duration-[120ms] ease-[ease]',
  '[.title-bar.is-light_&]:bg-[rgba(0,0,0,0.04)] [.title-bar.is-light_&]:text-neutral-700',
  '[.title-bar:not(.is-light)_&]:border-border [.title-bar:not(.is-light)_&]:bg-[oklch(1_0_0/0.04)] [.title-bar:not(.is-light)_&]:text-text-muted'
].join(' ')

const titleHomeButtonClass =
  '[-webkit-app-region:no-drag] inline-flex h-7 shrink-0 items-center gap-2 rounded-control border border-solid border-transparent bg-transparent py-0 pr-2.5 pl-2 [font-family:inherit] text-[13px] leading-5 font-normal text-[var(--titlebar-icon)] opacity-85 cursor-pointer transition-[background-color,opacity] duration-[120ms] ease-[ease] [.title-bar.is-hover-active_&]:hover:opacity-100 [.title-bar.is-hover-active_&]:hover:bg-secondary focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-1'

const titleDownloadsBadgeClass =
  'pointer-events-none absolute -top-1 -right-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[999px] bg-[var(--action,#60a5fa)] px-1 py-0 text-[9px] leading-none font-bold text-white tabular-nums [box-shadow:0_0_0_2px_var(--titlebar-bg-active,var(--titlebar-bg,var(--neutral-900)))] [.title-bar:not(.is-light)_&:not(.is-unseen,.is-error)]:text-background [&.is-unseen]:bg-[#22c55e] [&.is-error]:bg-[var(--danger)] [.title-downloads-tray.has-active_&]:animate-[title-downloads-pulse_1.6s_ease-in-out_infinite] [.title-downloads-tray.is-flashing_&]:[animation:title-downloads-flash_0.55s_cubic-bezier(0.2,0.9,0.3,1.4)_1,title-downloads-pulse_1.6s_ease-in-out_infinite_0.6s]'

const isMac = ref(bridge?.isMac() ?? false)
const isLinux = ref(bridge?.isLinux() ?? false)
const activePanel = ref<ComfyPanelKey>('comfy')
const installationId = ref(bridge?.getInstallationId() ?? '')
const isInstallLess = ref((bridge?.getInstallationId() ?? '') === '')

const {
  installLabel,
  sourceCategory,
  themeBg,
  themeText,
  isFullscreen,
  isConsentLockdown,
  isFirstUseLockdown,
  isLoadingLockdown,
  installTypeMeta,
  installTypeLabel,
  showInstallTypeIcon,
  showBrandMark,
  isLight
} = useTitleBarIdentity({ bridge, isInstallLess })

const showRefreshButton = computed(
  () =>
    (sourceCategory.value === 'cloud' ||
      sourceCategory.value === 'remote' ||
      sourceCategory.value === 'local') &&
    !isInstallLess.value &&
    !isFirstUseLockdown.value
)

const showHomeButton = computed(() => !isInstallLess.value && !isFirstUseLockdown.value)

const zoomLevel = ref(0)
const zoomPercent = computed(() => Math.round(Math.pow(1.2, zoomLevel.value) * 100))
const showZoomReset = computed(
  () => zoomLevel.value !== 0 && !isInstallLess.value && !isFirstUseLockdown.value
)

function handleFeedback(): void {
  bridge?.clickFeedback()
}

function handleRefreshInstance(): void {
  bridge?.clickRefreshInstance()
}

function handleHome(): void {
  hideTip()
  bridge?.clickHome()
}

function handleResetZoom(): void {
  bridge?.resetZoom()
}

const announcementUnread = ref(false)
let unsubAnnouncementSettings: (() => void) | null = null

function handleAnnouncement(): void {
  bridge?.clickAnnouncement()
}

async function refreshAnnouncementUnread(): Promise<void> {
  try {
    announcementUnread.value = (await window.api?.getSetting?.('comfyApiAnnouncementSeen')) !== true
  } catch {
    announcementUnread.value = false
  }
}

onMounted(() => {
  void refreshAnnouncementUnread()
  unsubAnnouncementSettings =
    window.api?.onSettingsChanged?.(({ key }) => {
      if (key === 'comfyApiAnnouncementSeen') void refreshAnnouncementUnread()
    }) ?? null
})

onUnmounted(() => {
  unsubAnnouncementSettings?.()
})

const titleBarRef = useTemplateRef<HTMLElement>('titleBar')
const fileBtnRef = useTemplateRef<HTMLButtonElement>('fileBtn')
const downloadsBtnRef = useTemplateRef<HTMLButtonElement>('downloadsBtn')
const announcementBtnRef = useTemplateRef<HTMLButtonElement>('announcementBtn')
const titleClusterRef = useTemplateRef<HTMLElement>('titleCluster')
const titleTrailingRef = useTemplateRef<HTMLElement>('titleTrailing')

type CollapseMode = 'full' | 'no-feedback'
const collapseMode = ref<CollapseMode>('full')
const collapsedFeedback = computed(() => collapseMode.value === 'no-feedback')

const MIN_GAP_PX = 16
const RESTORE_BUFFER_PX = 24
let feedbackRestoreCostPx = 0
let fitObserver: ResizeObserver | undefined
let fitRaf: number | null = null
let transitionRaf: number | null = null
let unmounted = false

interface FitMeasurement {
  gap: number
  trailingWidth: number
}

function measureFit(): FitMeasurement {
  const bar = titleBarRef.value
  const trailing = titleTrailingRef.value
  const cluster = titleClusterRef.value
  if (!bar || !trailing || !cluster) return { gap: Infinity, trailingWidth: NaN }
  const barRect = bar.getBoundingClientRect()
  if (barRect.width === 0) return { gap: Infinity, trailingWidth: NaN }
  const trailingRect = trailing.getBoundingClientRect()
  const leadingRight = Math.max(
    cluster.getBoundingClientRect().left,
    ...Array.from(cluster.children).map((child) => child.getBoundingClientRect().right)
  )
  return { gap: trailingRect.left - leadingRight, trailingWidth: trailingRect.width }
}

function scheduleFit(): void {
  if (unmounted || fitRaf !== null) return
  fitRaf = requestAnimationFrame(() => {
    fitRaf = null
    if (unmounted) return
    evaluateFit()
  })
}

function evaluateFit(): void {
  const { gap } = measureFit()
  if (!Number.isFinite(gap)) return
  if (collapseMode.value === 'full') {
    if (gap < MIN_GAP_PX) transitionTo('no-feedback')
  } else if (gap > feedbackRestoreCostPx + RESTORE_BUFFER_PX) {
    transitionTo('full')
  }
}

function transitionTo(next: CollapseMode): void {
  const prev = collapseMode.value
  if (prev === next) return
  const before = measureFit()
  collapseMode.value = next
  void nextTick().then(() => {
    if (unmounted) return
    transitionRaf = requestAnimationFrame(() => {
      transitionRaf = null
      if (unmounted) return
      const after = measureFit()
      if (Number.isFinite(before.trailingWidth) && Number.isFinite(after.trailingWidth)) {
        const delta = before.trailingWidth - after.trailingWidth
        if (prev === 'full' && next === 'no-feedback') {
          feedbackRestoreCostPx = Math.max(feedbackRestoreCostPx, delta)
        }
      }
      scheduleFit()
    })
  })
}

function invalidateRestoreCosts(): void {
  feedbackRestoreCostPx = 0
  scheduleFit()
}

const { tooltipAttrs, handleTooltipPointer, hideTip } = useTitleBarTooltip({
  bridge,
  isMac
})

const { isHoverActive } = useTitleBarHoverGate({ hideTip, handleTooltipPointer })

const {
  isDownloadsOpen,
  downloadsActiveCount,
  unseenFinishedCount,
  unseenErrorCount,
  downloadsTrayLabel,
  downloadsStartedAt,
  handleFileMenu,
  handleDownloadsTray
} = useTitleBarMenus({
  bridge,
  hideTip,
  fileBtnRef,
  downloadsBtnRef
})

const betaNotice = useBetaActivationNotice({
  bridge,
  installationId: () => installationId.value,
  isInstallLess,
  isFirstUseLockdown,
  isLoadingLockdown,
  anchorRef: announcementBtnRef,
  copyFor: ({ direction, description }) => {
    const keys =
      direction === 'disabled'
        ? description
          ? (['titleBar.betaNoticeOffTitleNamed', 'titleBar.betaNoticeOffBodyNamed'] as const)
          : (['titleBar.betaNoticeOffTitle', 'titleBar.betaNoticeOffBody'] as const)
        : description
          ? (['titleBar.betaNoticeTitleNamed', 'titleBar.betaNoticeBodyNamed'] as const)
          : (['titleBar.betaNoticeTitle', 'titleBar.betaNoticeBody'] as const)
    const params = { feature: description ?? '' }
    return {
      title: t(keys[0], params),
      body: t(keys[1], params),
      dismissLabel: t('titleBar.betaNoticeDismiss'),
      actionLabel: t('titleBar.betaNoticeSettings')
    }
  }
})

function retryBetaNotice(): void {
  if (unmounted) return
  void nextTick().then(() => {
    if (!unmounted) void betaNotice.maybeShow()
  })
}

const downloadsFlash = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null
watch(downloadsStartedAt, (next) => {
  if (next === 0) return
  downloadsFlash.value = true
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    downloadsFlash.value = false
    flashTimer = null
  }, 1600)
})

let unsubPanel: (() => void) | undefined
let unsubInstallationId: (() => void) | undefined
let unsubZoom: (() => void) | undefined
let unsubCoachmarkDismissed: (() => void) | undefined
let unsubCoachmarkAction: (() => void) | undefined
let unsubCoachmarkAutoHidden: (() => void) | undefined
let unsubCoachmarkSettled: (() => void) | undefined
let unsubCoachmarkDisplaced: (() => void) | undefined

onMounted(() => {
  if (titleBarRef.value && typeof ResizeObserver !== 'undefined') {
    fitObserver = new ResizeObserver(() => scheduleFit())
    fitObserver.observe(titleBarRef.value)
  }
  evaluateFit()

  syncLocale().catch((err) => {
    console.error('TitleBar: syncLocale failed', err)
  })

  if (!bridge) return
  unsubPanel = bridge.onPanelChanged((panel) => {
    activePanel.value = panel
  })
  unsubZoom = bridge.onZoomChanged((level) => {
    zoomLevel.value = level
  })
  unsubInstallationId = bridge.onInstallationIdChanged((nextInstallationId) => {
    const previous = installationId.value
    installationId.value = nextInstallationId ?? ''
    isInstallLess.value = nextInstallationId === null
    if (previous !== installationId.value) {
      if (betaNotice.isShowing.value) {
        bridge.hideCoachmark()
        betaNotice.forgetWithoutAcknowledging()
      }
      retryBetaNotice()
    }
  })
  unsubCoachmarkDismissed = bridge.onCoachmarkDismissed(({ kind }) => {
    if (kind === 'beta-notice') void betaNotice.dismiss()
  })
  unsubCoachmarkAction = bridge.onCoachmarkAction(({ kind }) => {
    if (kind === 'beta-notice') void betaNotice.openSettings()
  })
  unsubCoachmarkAutoHidden = bridge.onCoachmarkAutoHidden(({ kind }) => {
    if (kind === 'beta-notice') betaNotice.forgetWithoutAcknowledging()
  })
  unsubCoachmarkSettled = bridge.onCoachmarkSettled(() => {
    if (!unmounted) void betaNotice.maybeShow()
  })
  unsubCoachmarkDisplaced = bridge.onCoachmarkDisplaced(({ kind }) => {
    if (kind === 'beta-notice') betaNotice.forgetWithoutAcknowledging()
  })
  bridge.ready()
})

watch(
  [isInstallLess, isFirstUseLockdown, isLoadingLockdown],
  ([installLess, lockdown, loading]) => {
    if (installLess || lockdown || loading) {
      if (betaNotice.isShowing.value) bridge?.hideCoachmark()
      return
    }
    void nextTick().then(() => {
      requestAnimationFrame(() => {
        if (!unmounted) void betaNotice.maybeShow()
      })
    })
  },
  { immediate: true }
)

watch([locale, installLabel, isFirstUseLockdown], () => invalidateRestoreCosts())

onUnmounted(() => {
  unmounted = true
  unsubPanel?.()
  unsubInstallationId?.()
  unsubZoom?.()
  unsubCoachmarkDismissed?.()
  unsubCoachmarkAction?.()
  unsubCoachmarkAutoHidden?.()
  unsubCoachmarkSettled?.()
  unsubCoachmarkDisplaced?.()
  bridge?.hideCoachmark()
  hideTip()
  fitObserver?.disconnect()
  fitObserver = undefined
  if (fitRaf !== null) {
    cancelAnimationFrame(fitRaf)
    fitRaf = null
  }
  if (transitionRaf !== null) {
    cancelAnimationFrame(transitionRaf)
    transitionRaf = null
  }
  if (flashTimer) {
    clearTimeout(flashTimer)
    flashTimer = null
  }
})
</script>

<template>
  <header
    ref="titleBar"
    class="title-bar relative box-border grid h-screen w-screen grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-solid border-current border-b-[var(--border)] bg-[var(--titlebar-bg-active,var(--titlebar-bg))] px-3 py-0 font-sans text-[12px] leading-none font-normal text-text-muted select-none [-webkit-app-region:drag] [container:title-bar_/_inline-size] [&.is-mac]:pl-[78px] [&.is-mac.is-fullscreen]:pl-3 [&:not(.is-mac,.is-linux)]:pr-[140px] [&.is-linux]:[--title-controls-left:env(titlebar-area-x,0px)] [&.is-linux]:[--title-controls-right:calc(100vw_-_env(titlebar-area-x,0px)_-_env(titlebar-area-width,100vw))] [&.is-linux]:pl-[calc(var(--title-controls-left)_+_12px)] [&.is-linux]:pr-[calc(var(--title-controls-right)_+_12px)] [&:not(.is-light)]:border-b-border"
    :class="{
      'is-mac': isMac,
      'is-linux': isLinux,
      'is-light': isLight,
      'is-fullscreen': isFullscreen,
      'is-hover-active': isHoverActive,
      'is-consent-lockdown': isConsentLockdown,
      'is-collapsed-feedback': collapsedFeedback
    }"
    :data-collapse-mode="collapseMode"
    :style="{
      color: themeText ?? undefined,
      '--titlebar-bg-active': themeBg ?? undefined,
      '--titlebar-icon': themeText ?? undefined
    }"
  >
    <div ref="titleCluster" class="title-cluster flex items-center gap-1">
      <button
        v-if="showHomeButton"
        type="button"
        class="title-home-button"
        :class="titleHomeButtonClass"
        @click="handleHome"
      >
        <House :size="15" aria-hidden="true" />
        <span>{{ t('titleBar.home') }}</span>
      </button>
      <div v-if="isFirstUseLockdown" class="title-install-pill" :class="titleInstallPillClass">
        <div
          class="title-install-slot title-install-slot--leading inline-flex flex-[0_0_18px] items-center justify-center"
        >
          <ComfyCLogo
            v-if="showBrandMark"
            class="title-install-brand-mark shrink-0 text-current"
            :size="16"
          />
          <component
            :is="installTypeMeta.icon"
            v-else-if="showInstallTypeIcon"
            :size="16"
            class="title-install-type-icon shrink-0 opacity-85"
            v-bind="tooltipAttrs(installTypeLabel)"
          />
        </div>
        <div
          class="title-install-slot title-install-slot--center inline-flex min-w-0 flex-auto items-center justify-center gap-1.5"
        >
          <span class="title-install-name min-w-0 truncate">{{ installLabel }}</span>
        </div>
        <div
          class="title-install-slot title-install-slot--trailing inline-flex flex-[0_0_18px] items-center justify-center"
        ></div>
      </div>
    </div>

    <div class="title-center"></div>

    <div ref="titleTrailing" class="title-trailing flex items-center gap-2 [justify-self:end]">
      <Transition name="title-zoom-fade">
        <button
          v-if="showZoomReset"
          type="button"
          class="title-zoom-reset [&:is(.title-zoom-fade-enter-active,.title-zoom-fade-leave-active)]:transition-[opacity,transform] [&:is(.title-zoom-fade-enter-active,.title-zoom-fade-leave-active)]:duration-[160ms] [&:is(.title-zoom-fade-enter-active,.title-zoom-fade-leave-active)]:ease-[ease] [&:is(.title-zoom-fade-enter-from,.title-zoom-fade-leave-to)]:opacity-0 [&:is(.title-zoom-fade-enter-from,.title-zoom-fade-leave-to)]:[transform:scale(0.9)] [-webkit-app-region:no-drag] inline-flex shrink-0 items-center gap-1 rounded-[999px] border border-solid border-transparent bg-transparent px-2 py-[3px] [font-family:inherit] text-[11px] leading-[14px] font-normal text-[var(--titlebar-icon)] opacity-85 tabular-nums cursor-pointer transition-[background-color,opacity,border-color,color] duration-[120ms] ease-[ease] [.title-bar.is-hover-active_&]:hover:opacity-100 [.title-bar.is-hover-active_&]:hover:bg-[rgba(255,255,255,0.08)] [.title-bar.is-hover-active_&]:hover:border-[rgba(255,255,255,0.18)] [.title-bar.is-light.is-hover-active_&]:hover:bg-[rgba(0,0,0,0.06)] [.title-bar.is-light.is-hover-active_&]:hover:border-[rgba(0,0,0,0.18)] [.title-bar.is-hover-active:not(.is-light)_&]:hover:bg-secondary [.title-bar.is-hover-active:not(.is-light)_&]:hover:border-transparent focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-1"
          v-bind="tooltipAttrs(t('titleBar.resetZoomTooltip'))"
          @click="handleResetZoom"
        >
          <ZoomIn :size="14" class="title-zoom-reset-icon" />
          <span class="title-zoom-reset-percent tracking-[0.01em]">{{ zoomPercent }}%</span>
        </button>
      </Transition>
      <button
        v-if="showRefreshButton"
        type="button"
        class="title-menu-button title-menu-button--icon title-refresh-button"
        :class="titleMenuButtonClass"
        v-bind="tooltipAttrs(t('titleBar.refreshInstanceTooltip'))"
        @click="handleRefreshInstance"
      >
        <RotateCw :size="16" />
      </button>
      <button
        v-if="!isFirstUseLockdown"
        ref="announcementBtn"
        type="button"
        class="title-menu-button title-menu-button--icon title-announcement-button relative"
        :class="titleMenuButtonClass"
        v-bind="tooltipAttrs(t('titleBar.announcementTooltip'), t('titleBar.announcement'))"
        @click="handleAnnouncement"
      >
        <Bell :size="16" />
        <span
          v-if="announcementUnread"
          class="title-announcement-dot pointer-events-none absolute top-[3px] right-1 size-1.5 rounded-[50%] bg-[var(--comfy-yellow,#ffd23f)] [box-shadow:0_0_0_1.5px_var(--titlebar-bg,rgba(0,0,0,0.5))]"
          aria-hidden="true"
        />
      </button>
      <button
        v-if="!isFirstUseLockdown"
        type="button"
        class="title-menu-button title-menu-button--icon title-feedback-button"
        :class="titleMenuButtonClass"
        v-bind="tooltipAttrs(t('titleBar.feedbackTooltip'), t('titleBar.feedback'))"
        @click="handleFeedback"
      >
        <MessageSquarePlus :size="16" />
      </button>
      <button
        v-if="!isFirstUseLockdown"
        ref="downloadsBtn"
        type="button"
        class="title-downloads-tray [-webkit-app-region:no-drag] relative cursor-pointer rounded-lg border border-solid border-transparent bg-transparent px-1.5 py-1 text-[var(--titlebar-icon)] transition-[color] duration-[120ms] ease-[ease] [.title-bar.is-hover-active_&:hover:not(:disabled):not(.is-open)]:text-comfy-yellow [.title-bar.is-light.is-hover-active_&:hover:not(:disabled):not(.is-open)]:text-neutral-700 [&.has-active]:border-[rgba(96,165,250,0.55)] [&.has-active]:bg-[rgba(96,165,250,0.16)] [.title-bar.is-light_&.has-active]:border-[rgba(37,99,235,0.55)] [.title-bar.is-light_&.has-active]:bg-[rgba(37,99,235,0.12)] [&.is-open]:text-neutral-50 [.title-bar.is-light_&.is-open]:text-neutral-700 [&.is-flashing]:animate-[title-downloads-tray-flash_0.9s_ease-out_1] [&.has-unseen]:border-[rgba(34,197,94,0.55)] [&.has-unseen]:bg-[rgba(34,197,94,0.16)] [.title-bar.is-light_&.has-unseen]:border-[rgba(22,163,74,0.55)] [.title-bar.is-light_&.has-unseen]:bg-[rgba(22,163,74,0.12)] [&.has-error]:border-[color-mix(in_srgb,var(--danger)_55%,transparent)] [&.has-error]:bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] [.title-bar.is-hover-active:not(.is-light)_&:not(.has-active,.has-unseen,.has-error):hover]:bg-secondary [.title-bar.is-hover-active:not(.is-light)_&:not(.has-active,.has-unseen,.has-error):hover]:border-transparent"
        :class="{
          'has-active': downloadsActiveCount > 0,
          'has-error': unseenErrorCount > 0,
          'has-unseen':
            downloadsActiveCount === 0 && unseenErrorCount === 0 && unseenFinishedCount > 0,
          'is-flashing': downloadsFlash,
          'is-open': isDownloadsOpen
        }"
        v-bind="tooltipAttrs(downloadsTrayLabel)"
        @click="handleDownloadsTray"
      >
        <ArrowDownToLine :size="16" />
        <span
          v-if="downloadsActiveCount > 0"
          class="title-downloads-badge"
          :class="titleDownloadsBadgeClass"
          aria-hidden="true"
          >{{ downloadsActiveCount }}</span
        >
        <span
          v-else-if="unseenErrorCount > 0"
          class="title-downloads-badge is-error"
          :class="titleDownloadsBadgeClass"
          aria-hidden="true"
          >{{ unseenErrorCount }}</span
        >
        <span
          v-else-if="unseenFinishedCount > 0"
          class="title-downloads-badge is-unseen"
          :class="titleDownloadsBadgeClass"
          aria-hidden="true"
          >{{ unseenFinishedCount }}</span
        >
        <span
          v-if="downloadsActiveCount > 0 && unseenErrorCount > 0"
          class="title-downloads-error-dot pointer-events-none absolute -top-[3px] -left-[3px] size-2 rounded-[999px] bg-[var(--danger)] [box-shadow:0_0_0_2px_var(--titlebar-bg-active,var(--titlebar-bg,var(--neutral-900)))]"
          aria-hidden="true"
        />
      </button>
      <button
        v-if="!isConsentLockdown"
        ref="fileBtn"
        type="button"
        class="title-menu-button title-menu-button--icon"
        :class="titleMenuButtonClass"
        aria-haspopup="menu"
        v-bind="tooltipAttrs(t('titleBar.menu'))"
        @click="handleFileMenu"
      >
        <MenuIcon :size="16" />
      </button>
    </div>
  </header>
</template>

<style>
@keyframes title-downloads-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.55);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(96, 165, 250, 0);
  }
}
@keyframes title-downloads-flash {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  60% {
    transform: scale(1.25);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes title-downloads-tray-flash {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(96, 165, 250, 0);
  }
  20% {
    box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.55);
  }
}
@media (prefers-reduced-motion: reduce) {
  .title-downloads-tray.has-active .title-downloads-badge,
  .title-downloads-tray.is-flashing,
  .title-downloads-tray.is-flashing .title-downloads-badge {
    animation: none;
  }
}
</style>
