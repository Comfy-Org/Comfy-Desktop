<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowDownToLine,
  Bell,
  ChevronDown,
  CloudDownload,
  Loader2,
  Menu as MenuIcon,
  MessageSquarePlus,
  RefreshCw,
  RotateCw,
  ZoomIn
} from 'lucide-vue-next'
import { useTitleBarTooltip } from './useTitleBarTooltip'
import { useTitleBarMenus } from './useTitleBarMenus'
import { useTitleBarIdentity } from './useTitleBarIdentity'
import { useUpdatePills } from './useUpdatePills'
import { useTitleBarHoverGate } from './useTitleBarHoverGate'
import { useCentralPillCoachmark } from './useCentralPillCoachmark'
import { useBetaActivationNotice } from './useBetaActivationNotice'
import { useAppLocale, windowApiLocaleSource } from '../lib/useAppLocale'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'

const { t, locale } = useI18n()
const { syncLocale } = useAppLocale(windowApiLocaleSource())

// Inlined to keep the title-bar renderer self-contained — the preload TS
// file isn't visible to tsconfig.web (only its .d.ts would be). Kept in
// sync with the literal union in src/preload/comfyTitleBarPreload.ts and
// the ComfyPanelKey export in src/main/index.ts.
type ComfyPanelKey =
  | 'comfy'
  | 'performance-test'
  | 'benchmarks'
  | 'new-install'
  | 'track'
  | 'load-snapshot'
  | 'quick-install'

/** Which feature owns the single sticky coachmark card. Same reason as `ComfyPanelKey` above:
 *  kept in sync with the `CoachmarkKind` union in src/preload/comfyTitleBarPreload.ts. */
type CoachmarkKind = 'pill-hint' | 'beta-notice'

/** Position passed to main so the native menu pops below the anchor button.
 *  Coordinates are in title-bar-local pixels — main translates to window
 *  coordinates (titleBarView is at y=0 so they're already aligned). */
interface MenuAnchor {
  x: number
  y: number
}

/** Single download entry surfaced by the title-bar tray.
 *  Inline mirror of `DownloadsTrayEntry` in
 *  `src/preload/comfyTitleBarPreload.ts` — kept in sync because the
 *  title-bar renderer can't import preload TS directly (only its
 *  generated `.d.ts` would be visible, and we ship neither). */
interface DownloadsTrayEntry {
  url: string
  filename: string
  directory?: string
  progress: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
}

/** Payload pushed by main on `comfy-titlebar:downloads-changed`.
 *  Inline mirror of `DownloadsTrayState` in the preload file. */
interface DownloadsTrayState {
  active: DownloadsTrayEntry[]
  recent: DownloadsTrayEntry[]
}

interface Bridge {
  getInstallationId: () => string | null
  isMac: () => boolean
  setPanel: (panel: ComfyPanelKey) => void
  openNewWindow: () => void
  /** Pop the File menu natively (avoids WebContentsView clipping the popup). */
  openFileMenu: (anchor: MenuAnchor) => void
  /** Ask main to dismiss the File menu popup (toggle-close). */
  dismissFileMenu: () => void
  /** Issue #514 — show a hover tooltip in the cached title-bar tooltip
   *  popup. macOS-only path: native HTML `title` tooltips don't appear
   *  reliably for sibling chrome WebContentsViews on macOS, so the
   *  renderer routes hover through main → cached `WebContentsView`
   *  popup. `leftX` / `rightX` / `bottomY` are title-bar-local pixels
   *  (the title-bar view sits at parent-window content (0,0) so they
   *  map directly to window coords on the main side). Main prefers to
   *  anchor the bubble's left edge to `leftX` so the bubble extends
   *  rightward from the trigger; it falls back to right-aligning
   *  `rightX` when growing rightward would overflow. */
  showTooltip: (payload: { text: string; leftX: number; rightX: number; bottomY: number }) => void
  /** Issue #514 — hide the title-bar hover tooltip popup. */
  hideTooltip: () => void
  /** Sticky title-bar coachmark card (issue #701) — show/hide the card pointing at a
   *  title-bar element, and subscribe to how it was retired. One popup per window serves
   *  both the onboarding pill hint and the Core beta activation notice, so `kind` names the
   *  owner on the way out and back. */
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
  /** The card's secondary action, when it has one. Retires the card like dismiss does. */
  onCoachmarkAction: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  /** The popup was hidden without a retirement (host window moved/resized). */
  onCoachmarkAutoHidden: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  /** The host window has stopped moving; safe to put a forgotten card back. */
  onCoachmarkSettled: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  /** The popup was reconfigured for the other card; `kind` is the owner that lost it. */
  onCoachmarkDisplaced: (cb: (payload: { kind: CoachmarkKind }) => void) => () => void
  onPanelChanged: (cb: (panel: ComfyPanelKey) => void) => () => void
  onTitleChanged: (cb: (title: string) => void) => () => void
  /** Install source-category pushes from main. The raw category
   *  string drives the install-type icon next to the install name
   *  (Standalone / Cloud / Legacy Desktop / …). `null` for
   *  install-less host windows; the renderer suppresses the icon in
   *  that case. */
  onSourceCategoryChanged: (cb: (category: string | null) => void) => () => void
  onZoomChanged: (cb: (level: number) => void) => () => void
  onThemeChanged: (cb: (theme: { bg: string; text: string }) => void) => () => void
  onFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  onMenuOpened: (cb: (info: { menu: 'menu' | 'downloads' }) => void) => () => void
  onMenuClosed: (cb: (info: { menu: 'menu' | 'downloads' }) => void) => () => void
  /** First-use takeover step pushes from main. Drives the T&C-step
   *  lockdown that hides the waffle menu (the otherwise-always-live
   *  escape hatch) so the user has to either accept consent or close
   *  the window via OS chrome — there's no in-app affordance that
   *  drops them past the T&C without a recorded answer. The
   *  post-consent steps stay normal except for the Skip Onboarding
   *  entry the menu builder adds. */
  onFirstUseModeChanged: (
    cb: (mode: 'none' | 'consent-lockdown' | 'post-consent') => void
  ) => () => void
  /** Preview-mode flag pushed by main. `true` while an in-progress
   *  install identity preview is active on a chooser host (an op was
   *  claimed and the install's title + source icon are showing in the
   *  title bar but the host is still install-less); `false`
   *  otherwise. Drives renderer gates that would normally suppress
   *  install-scoped chrome on install-less hosts so the previewed
   *  install's identity surfaces cleanly. */
  onPreviewModeChanged: (cb: (preview: boolean) => void) => () => void
  /** Installation-id pushes from main. The title bar is a long-lived
   *  view across attach / detach (no URL reload), so the URL query
   *  param is only a cold-boot seed; this push is the
   *  runtime-authoritative source of truth that drives `isInstallLess`
   *  and any install-scoped chrome gated by the install id. `null`
   *  for install-less hosts. */
  onInstallationIdChanged: (cb: (installationId: string | null) => void) => () => void
  /** App-update state pushes from main. `kind` is `'available'`
   *  after `update-available`, `'ready'` after `update-downloaded`,
   *  and `null` when nothing is pending. Drives the title-bar
   *  app-update pill that sits to the right of the hamburger menu.
   *
   *  `autoUpdate` mirrors the `autoUpdate` setting at the moment the
   *  state was committed. With auto-updates ON the
   *  `'available'` state never fires (main triggers the download
   *  itself); the `'ready'` state then reads "Update will apply on
   *  restart". With auto-updates OFF the `'available'` pill reads
   *  "Update v{version} available" and the `'ready'` pill keeps the
   *  existing "Restart to update" copy. */
  onAppUpdateStateChanged: (
    cb: (state: {
      kind: 'available' | 'downloading' | 'ready' | null
      version: string | null
      autoUpdate: boolean
    }) => void
  ) => () => void
  /** Install-update flag pushes from main. `available` is `true`
   *  when the install's `statusTag.style === 'update'`; `version`
   *  carries the target release version when known so the pill can
   *  read "Update v{version}". Only meaningful on install-backed
   *  host windows; install-less hosts never receive this signal.
   *  Drives the title-bar install-update pill. */
  onInstallUpdateAvailable: (
    cb: (state: { available: boolean; version: string | null }) => void
  ) => () => void
  /** Click handler for the app-update pill. */
  clickAppUpdatePill: () => void
  /** Click handler for the install-update pill. */
  clickInstallUpdatePill: () => void
  /** Downloads tray state pushes from main. The payload
   *  carries both in-flight downloads (`active`) and the most recent
   *  terminal entries (`recent`, capped server-side at 10). The tray
   *  is hidden entirely when both arrays are empty so it doesn't
   *  squat in the steady state. Pushed initially on `ready()` and
   *  on every state change (broadcast by the download manager). */
  onDownloadsChanged: (cb: (state: DownloadsTrayState) => void) => () => void
  /** Click handler for the downloads tray. Opens the title-bar
   *  dropdown popup in `'downloads'` mode anchored under the tray
   *  button. */
  clickDownloadsTray: (anchor: MenuAnchor) => void
  /** Click handler for the centre install pill. Opens the instance-
   *  picker popover anchored beneath the pill. Main filters install-
   *  less hosts (the chooser host pill stays non-interactive — the
   *  dashboard body already IS the picker, so a smaller copy on top
   *  would be redundant). */
  clickInstallPill: (anchor: MenuAnchor) => void
  /** Click handler for the title-bar Send Feedback button. Main
   *  forwards `comfy-panel:open-feedback` to the panel renderer,
   *  which fires the `comfy.desktop.feedback.opened` telemetry action and
   *  opens the support URL via `openExternal`. */
  clickFeedback: () => void
  /** Click handler for the title-bar news bell. Main forwards
   *  `comfy-panel:open-announcement` to the panel renderer, which mounts
   *  the announcement modal over the live canvas. */
  clickAnnouncement: () => void
  /** Click handler for the cloud-instance refresh button. Re-navigates
   *  the host's comfyView via the same reload path as F5/Ctrl+R. */
  clickRefreshInstance: () => void
  /** Reset the host comfyView's zoom to 100%. */
  resetZoom: () => void
  ready: () => void
}

const bridge = (window as unknown as { __comfyTitleBar?: Bridge }).__comfyTitleBar

const titleMenuButtonClass =
  '[-webkit-app-region:no-drag] inline-flex items-center gap-0 rounded-[4px] border border-solid border-transparent bg-transparent px-1.5 py-1 [font:inherit] text-[var(--titlebar-icon)] opacity-85 cursor-pointer transition-[background-color,opacity,border-color] duration-[120ms] ease-[ease] [.title-bar:not(.is-light)_&]:rounded-control [.title-bar.is-hover-active_&]:hover:opacity-100 [.title-bar.is-hover-active_&]:hover:bg-[rgba(255,255,255,0.08)] [.title-bar.is-hover-active_&]:hover:border-[rgba(255,255,255,0.18)] [.title-bar.is-light.is-hover-active_&]:hover:bg-[rgba(0,0,0,0.06)] [.title-bar.is-light.is-hover-active_&]:hover:border-[rgba(0,0,0,0.18)] [.title-bar.is-hover-active:not(.is-light)_&]:hover:bg-secondary [.title-bar.is-hover-active:not(.is-light)_&]:hover:border-transparent'

const titleInstallPillClass = [
  '[-webkit-app-region:no-drag] inline-flex h-7 items-center gap-2 [inline-size:fit-content] [min-inline-size:200px] [max-inline-size:clamp(200px,22cqi,360px)] rounded-[999px] border border-solid border-transparent bg-[var(--chooser-surface-bg)] py-[5px] pr-2.5 pl-3 [font-family:inherit] text-[12px] leading-[inherit] font-normal text-neutral-100 cursor-default transition-[background-color,border-color,color] duration-[120ms] ease-[ease]',
  '[&.is-interactive]:cursor-pointer',
  '[&.is-interactive:focus-visible]:outline-none [&.is-interactive:focus-visible]:outline-current',
  '[&.is-install-less]:opacity-85',
  '[.title-bar.is-hover-active_&.is-interactive:hover:not(.is-open)]:bg-[var(--chooser-surface-bg-hover)] [.title-bar.is-hover-active_&.is-interactive:hover:not(.is-open)]:border-[color-mix(in_srgb,var(--neutral-50)_35%,transparent)] [.title-bar.is-hover-active_&.is-interactive:hover:not(.is-open)]:text-[color-mix(in_srgb,var(--neutral-50)_70%,var(--neutral-100))]',
  '[&.is-interactive:focus-visible:not(.is-open)]:bg-[var(--chooser-surface-bg-hover)] [&.is-interactive:focus-visible:not(.is-open)]:border-[color-mix(in_srgb,var(--neutral-50)_35%,transparent)] [&.is-interactive:focus-visible:not(.is-open)]:text-[color-mix(in_srgb,var(--neutral-50)_70%,var(--neutral-100))]',
  '[&.is-interactive.is-open]:border-neutral-50 [&.is-interactive.is-open]:text-neutral-50',
  '[.title-bar.is-light_&]:bg-[rgba(0,0,0,0.04)] [.title-bar.is-light_&]:text-neutral-700',
  '[.title-bar:not(.is-light)_&]:border-border [.title-bar:not(.is-light)_&]:bg-[oklch(1_0_0/0.04)] [.title-bar:not(.is-light)_&]:text-text-muted',
  '[.title-bar.is-light.is-hover-active_&.is-interactive:hover:not(.is-open)]:bg-[rgba(0,0,0,0.07)] [.title-bar.is-light.is-hover-active_&.is-interactive:hover:not(.is-open)]:border-[color-mix(in_srgb,var(--neutral-700)_35%,transparent)] [.title-bar.is-light.is-hover-active_&.is-interactive:hover:not(.is-open)]:text-neutral-700',
  '[.title-bar.is-light_&.is-interactive:focus-visible:not(.is-open)]:bg-[rgba(0,0,0,0.07)] [.title-bar.is-light_&.is-interactive:focus-visible:not(.is-open)]:border-[color-mix(in_srgb,var(--neutral-700)_35%,transparent)] [.title-bar.is-light_&.is-interactive:focus-visible:not(.is-open)]:text-neutral-700',
  '[.title-bar.is-hover-active:not(.is-light)_&.is-interactive:hover:not(.is-open)]:border-[oklch(1_0_0/0.12)] [.title-bar.is-hover-active:not(.is-light)_&.is-interactive:hover:not(.is-open)]:bg-[oklch(1_0_0/0.07)] [.title-bar.is-hover-active:not(.is-light)_&.is-interactive:hover:not(.is-open)]:text-text',
  '[.title-bar:not(.is-light)_&.is-interactive.is-open]:border-[oklch(1_0_0/0.3)] [.title-bar:not(.is-light)_&.is-interactive.is-open]:bg-[oklch(1_0_0/0.07)] [.title-bar:not(.is-light)_&.is-interactive.is-open]:text-text',
  '[.title-bar.is-light_&.is-interactive.is-open]:border-[color-mix(in_srgb,var(--neutral-700)_55%,transparent)] [.title-bar.is-light_&.is-interactive.is-open]:text-neutral-700'
].join(' ')

const titleDownloadsBadgeClass =
  'pointer-events-none absolute -top-1 -right-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[999px] bg-[var(--accent,#60a5fa)] px-1 py-0 text-[9px] leading-none font-bold text-white tabular-nums [box-shadow:0_0_0_2px_var(--titlebar-bg-active,var(--titlebar-bg,var(--neutral-900)))] [.title-bar:not(.is-light)_&:not(.is-unseen,.is-error)]:text-background [&.is-unseen]:bg-[#22c55e] [&.is-error]:bg-[var(--danger)] [.title-downloads-tray.has-active_&]:animate-[title-downloads-pulse_1.6s_ease-in-out_infinite] [.title-downloads-tray.is-flashing_&]:[animation:title-downloads-flash_0.55s_cubic-bezier(0.2,0.9,0.3,1.4)_1,title-downloads-pulse_1.6s_ease-in-out_infinite_0.6s]'

const isMac = ref(bridge?.isMac() ?? false)
/** Active body-mode pill, mirrored from main. Drives the native Install
 *  menu's checkmark for install-scoped pages (Install Settings /
 *  Directories). The pill itself no longer reflects this — the pill is
 *  an identity label, not a tab indicator. */
const activePanel = ref<ComfyPanelKey>('comfy')
/**
 * Install-less host window flag — `true` when the host has no install
 * backing it. Drives the center pill's static identity label and
 * suppresses the install-type icon. Seeded from the URL `installationId`
 * query param so the first paint reads correctly, then updated reactively
 * via `onInstallationIdChanged` pushes from main as the host transitions
 * across attach / detach without a title-bar URL reload.
 */
const installationId = ref(bridge?.getInstallationId() ?? '')
const isInstallLess = ref((bridge?.getInstallationId() ?? '') === '')

const {
  installLabel,
  sourceCategory,
  themeBg,
  themeText,
  isFullscreen,
  firstUseMode,
  isConsentLockdown,
  isFirstUseLockdown,
  isLoadingLockdown,
  installTypeMeta,
  installTypeLabel,
  showInstallTypeIcon,
  showBrandMark,
  isLight
} = useTitleBarIdentity({ bridge, isInstallLess })
// firstUseMode is consumed by isFirstUseLockdown / isConsentLockdown
// inside the composable; the template only reads the derived booleans.

/** Browser-style refresh button — shown on any install-backed host (cloud,
 *  user-pointed remote ComfyUI, or local installs), never on install-less
 *  hosts or during first-use lockdown. Clicking re-navigates the comfyView
 *  via the same reload path as F5/Ctrl+R. */
const showRefreshButton = computed(
  () =>
    (sourceCategory.value === 'cloud' ||
      sourceCategory.value === 'remote' ||
      sourceCategory.value === 'local') &&
    !isInstallLess.value &&
    !isFirstUseLockdown.value
)
void firstUseMode

const zoomLevel = ref(0)
const zoomPercent = computed(() => Math.round(Math.pow(1.2, zoomLevel.value) * 100))
const showZoomReset = computed(
  () => zoomLevel.value !== 0 && !isInstallLess.value && !isFirstUseLockdown.value
)

/**
 * Title-bar chrome lockdown. True whenever the bar should collapse to
 * just the static centre pill:
 *   - First-use takeover (consent + post-consent steps).
 *   - ProgressModal takeover (`'loading-lockdown'`) for any long-running
 *     op (install / update / migrate / snapshot / launch).
 * Single derived flag — every gate below reads the same source.
 * `isConsentLockdown` is kept around for the existing CSS class hook
 * on the bar root.
 */

const {
  appUpdateState,
  appUpdatePillLabel,
  appUpdatePillTooltip,
  installUpdatePillLabel,
  showAppUpdatePill,
  showInstallUpdatePill,
  handleAppUpdatePill,
  handleInstallUpdatePill
} = useUpdatePills({ bridge, isInstallLess })

/** Title-bar Send Feedback button. Routes through main, which forwards
 *  `comfy-panel:open-feedback` to the panel renderer — the renderer
 *  fires the `comfy.desktop.feedback.opened` telemetry action and opens the
 *  support URL via `openExternal`. The waffle menu's "Send Feedback"
 *  entry lands on the same panel-side handler. */
function handleFeedback(): void {
  bridge?.clickFeedback()
}

function handleRefreshInstance(): void {
  bridge?.clickRefreshInstance()
}

function handleResetZoom(): void {
  bridge?.resetZoom()
}

// News bell with a subtle unread dot until the announcement is opened. Its state
// lives in the `comfyApiAnnouncementSeen` setting (shared with the panel view);
// opening the modal writes it, and the settings-changed broadcast clears the
// dot here without a dedicated channel.
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

// Icon is ComfyUI-tab only; also visible while the drawer is open so
const titleBarRef = useTemplateRef<HTMLElement>('titleBar')
const fileBtnRef = useTemplateRef<HTMLButtonElement>('fileBtn')
const downloadsBtnRef = useTemplateRef<HTMLButtonElement>('downloadsBtn')
/** News bell — also the anchor the beta activation notice's beak points at. */
const announcementBtnRef = useTemplateRef<HTMLButtonElement>('announcementBtn')
const installPillRef = useTemplateRef<HTMLElement>('installPill')
const titleTrailingRef = useTemplateRef<HTMLElement>('titleTrailing')

/** Mirrors the trailing cluster's measured width onto the title bar as
 *  `--title-trailing-width`, which the left cluster reads as a
 *  `min-width` reservation. This keeps the install pill anchored to
 *  true window center even when only the right side has variable
 *  content (update pills, feedback collapsing to icon, etc.) — the
 *  left cluster grows to match so both 1fr-flanking tracks stay equal.
 *
 *  Pure-CSS can't do this because the left and right clusters have
 *  asymmetric content (waffle menu vs. 5 pills), so neither side can
 *  be a `1fr` mirror of the other. ResizeObserver is the standard
 *  pattern apps like Figma use for the same problem. */
const trailingWidthPx = ref(0)
let trailingObserver: ResizeObserver | undefined

/** Responsive collapse mode for the trailing cluster.
 *
 *  Three tiers, decided from real measured geometry (not bar-width
 *  breakpoints) so the decision actually accounts for the centre
 *  install pill's current position and width:
 *
 *    - 'full'        — Feedback + Desktop Update labels visible.
 *    - 'no-feedback' — Feedback collapsed to icon-only.
 *    - 'icons-only'  — Both Feedback and Desktop Update collapsed.
 *
 *  Each resize frame measures the gap between the install pill's
 *  right edge and the trailing cluster's left edge. With the trailing
 *  mirror live the left-side gap is equal by construction, so the
 *  right gap alone is sufficient. When the gap drops below
 *  `MIN_GAP_PX` the controller advances one tier; it only walks back
 *  when the gap comfortably exceeds the *learned* width cost of
 *  restoring the hidden label plus `RESTORE_BUFFER_PX`. Hysteresis is
 *  essential — collapsing the trailing cluster immediately frees
 *  enough gap to consider re-expanding; the restore-cost guard
 *  prevents that flap. */
type CollapseMode = 'full' | 'no-feedback' | 'icons-only'
const collapseMode = ref<CollapseMode>('full')
const collapsedFeedback = computed(
  () => collapseMode.value === 'no-feedback' || collapseMode.value === 'icons-only'
)
const collapsedUpdate = computed(() => collapseMode.value === 'icons-only')

const MIN_GAP_PX = 16
const RESTORE_BUFFER_PX = 24
/** Learned at runtime via the before/after measurement around each
 *  transition — we don't know analytically how wide each label is
 *  (font, locale, version-string length all vary). The cost is the
 *  drop in `.title-trailing`'s own width, NOT the change in the pill
 *  gap, because the user can be actively dragging a resize during
 *  the rAF settle window and the bar width would otherwise poison
 *  the delta. Trailing width is independent of bar width.
 *
 *  Initialized to 0 so the first transition pair learns the real
 *  cost; until then `RESTORE_BUFFER_PX` is the only guard. */
let feedbackRestoreCostPx = 0
let updateRestoreCostPx = 0
let fitObserver: ResizeObserver | undefined
let fitRaf: number | null = null
let transitionRaf: number | null = null
let unmounted = false

interface FitMeasurement {
  gap: number
  trailingWidth: number
}

/** Measure the gap between the install pill and the trailing cluster,
 *  plus the trailing cluster's own width. Returns sentinels when refs
 *  aren't mounted yet (so the fit controller stays at `'full'` until
 *  layout exists) or when the bar is hidden / detached (rect width 0). */
function measureFit(): FitMeasurement {
  const bar = titleBarRef.value
  const trailing = titleTrailingRef.value
  const pill = installPillRef.value
  if (!bar || !trailing || !pill) return { gap: Infinity, trailingWidth: NaN }
  const barRect = bar.getBoundingClientRect()
  if (barRect.width === 0) return { gap: Infinity, trailingWidth: NaN }
  const trailingRect = trailing.getBoundingClientRect()
  const pillRect = pill.getBoundingClientRect()
  return { gap: trailingRect.left - pillRect.right, trailingWidth: trailingRect.width }
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
  const mode = collapseMode.value
  if (mode === 'full') {
    if (gap < MIN_GAP_PX) transitionTo('no-feedback')
  } else if (mode === 'no-feedback') {
    if (gap < MIN_GAP_PX) transitionTo('icons-only')
    else if (gap > feedbackRestoreCostPx + RESTORE_BUFFER_PX) transitionTo('full')
  } else {
    if (gap > updateRestoreCostPx + RESTORE_BUFFER_PX) transitionTo('no-feedback')
  }
}

function transitionTo(next: CollapseMode): void {
  const prev = collapseMode.value
  if (prev === next) return
  const before = measureFit()
  collapseMode.value = next
  // Wait for Vue to flush the DOM update + the browser to lay out,
  // then learn how much trailing width restoring the hidden label
  // would cost. Tracking the rAF lets `onUnmounted` cancel it so
  // teardown doesn't race against a pending measurement callback.
  void nextTick().then(() => {
    if (unmounted) return
    transitionRaf = requestAnimationFrame(() => {
      transitionRaf = null
      if (unmounted) return
      const after = measureFit()
      if (Number.isFinite(before.trailingWidth) && Number.isFinite(after.trailingWidth)) {
        // Trailing shrinks when a label is hidden; the drop is the
        // width the gap will gain back if we restore the label.
        const delta = before.trailingWidth - after.trailingWidth
        if (prev === 'full' && next === 'no-feedback') {
          feedbackRestoreCostPx = Math.max(feedbackRestoreCostPx, delta)
        } else if (prev === 'no-feedback' && next === 'icons-only') {
          updateRestoreCostPx = Math.max(updateRestoreCostPx, delta)
        }
      }
      // Re-evaluate in case one transition didn't free enough room.
      scheduleFit()
    })
  })
}

/** Discard learned restore costs whenever something that changes the
 *  trailing cluster's content width is mutated (locale switch, update
 *  state, install-update flag, …). The next collapse transition then
 *  re-learns the cost from the new label widths. */
function invalidateRestoreCosts(): void {
  feedbackRestoreCostPx = 0
  updateRestoreCostPx = 0
  scheduleFit()
}

const { tooltipAttrs, handleTooltipPointer, hideTip } = useTitleBarTooltip({
  bridge,
  isMac
})

const { isHoverActive } = useTitleBarHoverGate({ hideTip, handleTooltipPointer })

const {
  isDownloadsOpen,
  isInstancePickerOpen,
  downloadsActiveCount,
  unseenFinishedCount,
  unseenErrorCount,
  downloadsTrayLabel,
  downloadsStartedAt,
  handleFileMenu,
  handleDownloadsTray,
  handleInstallPill
} = useTitleBarMenus({
  bridge,
  hideTip,
  fileBtnRef,
  downloadsBtnRef,
  installPillRef
})

// First-instance onboarding coachmark pointing at the centre pill. Shares
// the menus composable's pill ref; opening the drawer acknowledges it.
const coachmark = useCentralPillCoachmark({
  bridge,
  isInstallLess,
  isFirstUseLockdown,
  isLoadingLockdown,
  // One popup per window: the hint must not hide a card it did not raise.
  ownsPopup: () => coachmark.isShowing.value,
  installPillRef,
  title: t('titleBar.pillHintTitle'),
  body: t('titleBar.pillHintBody'),
  dismissLabel: t('titleBar.pillHintDismiss')
})

/**
 * Core beta activation notice pointing at the news bell — a beta feature turned on for this
 * install, here is how to turn it off. Suppressed while the onboarding hint is up: one popup
 * per window backs both cards, so the later show would replace the earlier one mid-read.
 * The hint is once-ever on first instance entry, so this only defers a brand-new user's
 * notice to their next launch.
 */
const betaNotice = useBetaActivationNotice({
  bridge,
  installationId: () => installationId.value,
  isInstallLess,
  isFirstUseLockdown,
  isLoadingLockdown,
  anchorRef: announcementBtnRef,
  isSuppressed: () => coachmark.isShowing.value,
  // Four wordings, picked by what main could establish: whether the grant turned the feature
  // on or withdrew it, and whether the PostHog payload named it. The generic pair is the
  // fallback, so an unnamed feature still gets a card that is true.
  copyFor: ({ direction, description }) => {
    // Static keys rather than composed ones: `createAppI18n` disables missing-key warnings, so
    // a rename in en.json would otherwise degrade silently to a card titled with the literal
    // key. Written out, the four are greppable and fail visibly.
    //
    // The `{feature}` slot in the *Named variants is an OPAQUE PROPER NAME, supplied by the
    // flag payload and not localized. In every template it modifies the constant head noun
    // ("beta"), so what a gendered or case-marking language agrees with is that head noun and
    // never the slotted name. A translation that promotes `{feature}` to the grammatical head
    // — "{feature} est activé", "{feature} включён" — needs a gender Desktop does not have and
    // cannot get. en and zh are the only shipping locales and zh has neither gender nor case,
    // so nothing exercises this today; the contract is written down so a third locale cannot
    // introduce the fragile form silently. Contract for translators:
    // `locales/drafts/README.md`.
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

/** Wrap the pill opener so opening the drawer retires the coachmark
 *  (the hint did its job) before delegating to the real handler. */
function handleInstallPillWithCoachmark(): void {
  void coachmark.acknowledgeViaPillOpen().then(retryBetaNoticeAfterHint)
  handleInstallPill()
}

/** Re-raise a card that main hid out from under us. Forgetting alone only unlatches the
 *  composable — no watcher observes window movement, so without this the notice stays absent
 *  until some unrelated relaunch or retarget happens to re-run the gate.
 *
 *  Debounced because `move` fires continuously through a drag: each event hides the popup
 *  again, so re-showing per event would thrash the card on and off for the whole gesture.
 *  One re-show once the window settles. `maybeShow` re-reads the anchor rect, which is the
 *  point — the old rect is exactly what went stale. */
/** Put a forgotten card back. Fired from main's settled signal rather than a timer here:
 *  the popup hides on the FIRST move and `onHide` only reports that one transition, so a
 *  local timer could not be extended by the rest of a drag and would reopen the card
 *  mid-gesture — flashing it and stealing focus on every subsequent move. Main sees every
 *  event, so it owns the debounce.
 *
 *  Both cards, in the gate watcher's order and for its reason: the hint wins a collision,
 *  and awaiting it keeps the beta notice's suppression check from reading a stale `false`.
 *  Each is gated and idempotent, so the one that was not hidden simply declines. */
function reshowCoachmarksAfterMove(): void {
  if (unmounted) return
  void coachmark.maybeShow().then(() => {
    if (!unmounted) void betaNotice.maybeShow()
  })
}

/** The beta notice defers while the hint owns the popup, and nothing in the gate watcher
 *  changes when the hint goes away — so without this the deferred card waits for the next
 *  launch. Safe to call unconditionally: `maybeShow` re-checks the gate and main still holds
 *  the pending notice (deferring never acknowledges). */
function retryBetaNoticeAfterHint(): void {
  if (unmounted) return
  void nextTick().then(() => {
    if (!unmounted) void betaNotice.maybeShow()
  })
}

/** One-shot "downloads started" attention flash. Driven by
 *  `downloadsStartedAt` from the menus composable, which bumps each
 *  time a brand-new active download appears. The flash is purely
 *  decorative — it overlays the existing pulsing badge / count so the
 *  user immediately notices the tray came alive even if they were
 *  looking elsewhere on screen. The 1600 ms window matches one full
 *  cycle of the underlying CSS keyframes. */
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
  // Observe the trailing cluster so the left cluster can mirror its
  // width (keeps the centered install pill at true window centre).
  // Pills appearing/disappearing (update pills, feedback collapse)
  // change the trailing width — ResizeObserver fires on each.
  if (titleTrailingRef.value && typeof ResizeObserver !== 'undefined') {
    trailingObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = Math.ceil(entry.contentRect.width)
      if (width !== trailingWidthPx.value) {
        trailingWidthPx.value = width
      }
    })
    trailingObserver.observe(titleTrailingRef.value)
  }

  // Observe the title bar itself for resize so the fit controller can
  // re-evaluate whether the trailing labels still fit alongside the
  // centre pill. Bar-only is sufficient — install-pill width and
  // trailing width changes propagate through layout and either resize
  // the bar (no, fixed `100vw`) or change the measured rects we read
  // inside `evaluateFit`. The locale/state watches below handle
  // changes that don't trigger a bar resize.
  if (titleBarRef.value && typeof ResizeObserver !== 'undefined') {
    fitObserver = new ResizeObserver(() => scheduleFit())
    fitObserver.observe(titleBarRef.value)
  }
  // Initial pass synchronously on mount so we start in the right tier
  // before the first paint instead of flashing 'full' for one frame
  // on a narrow boot width.
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
    // The card names "this instance", so it must not outlive the host retargeting to another.
    // Forgotten rather than retired: it was never acknowledged, so it replays for its own
    // install instead of being spent on one the user never saw it for.
    if (previous !== installationId.value) {
      if (betaNotice.isShowing.value) {
        bridge.hideCoachmark()
        betaNotice.forgetWithoutAcknowledging()
      }
      // The gate watcher keys on install-less/lockdown, none of which move on a retarget
      // between two real installs — so without this the new install's pending notice is never
      // queried again for the rest of the session.
      retryBetaNoticeAfterHint()
    }
  })
  // The popup's own dismiss button (✕ / "Got it") routes through main
  // back to here — flip the once-ever flag + hide. One popup serves both cards,
  // so the retirement arrives addressed with the kind that raised it.
  unsubCoachmarkDismissed = bridge.onCoachmarkDismissed(({ kind }) => {
    if (kind === 'beta-notice') void betaNotice.dismiss()
    else void coachmark.dismiss().then(retryBetaNoticeAfterHint)
  })
  // Secondary action; only the beta notice has one today.
  unsubCoachmarkAction = bridge.onCoachmarkAction(({ kind }) => {
    if (kind === 'beta-notice') void betaNotice.openSettings()
  })
  // Main hid the popup without anyone retiring it — the host window moved or resized, so the
  // anchor the beak points at is stale. Forget WITHOUT acknowledging: the user may never have
  // read the card, and leaving the composable believing it is still up would turn away every
  // later show for the rest of the session.
  unsubCoachmarkAutoHidden = bridge.onCoachmarkAutoHidden(({ kind }) => {
    // Whichever card was on the popup, the owner has to be told. The hint matters as much as
    // the notice: `coachmark.isShowing` is the beta notice's suppression gate, so a hint left
    // believing it is up silences the beta card for the renderer's whole life — and cannot be
    // dismissed either, since there is no longer a card to click.
    if (kind === 'beta-notice') betaNotice.forgetWithoutAcknowledging()
    else coachmark.forgetWithoutAcknowledging()
    // Forgetting is immediate — it is a state correction, and leaving the composable latched
    // is what strands the card. Re-showing waits for `onCoachmarkSettled` below.
  })
  unsubCoachmarkSettled = bridge.onCoachmarkSettled(() => {
    reshowCoachmarksAfterMove()
  })
  // The other card took the popup. Not a hide, so `onCoachmarkAutoHidden` never fires for it —
  // and a composable that still believes its card is up refuses every later show, which is how
  // a beta notice ended up armed but permanently invisible behind the onboarding hint.
  // Forget WITHOUT acknowledging: the user never acted on it, so main keeps it and it replays.
  unsubCoachmarkDisplaced = bridge.onCoachmarkDisplaced(({ kind }) => {
    if (kind === 'beta-notice') betaNotice.forgetWithoutAcknowledging()
    else coachmark.forgetWithoutAcknowledging()
  })
  bridge.ready()
})

// Gate inputs settle async via main's pushes after mount, so watch them
// and re-attempt on each transition (the composable is idempotent) rather
// than firing once on mount.
watch(
  [isInstallLess, isFirstUseLockdown, isLoadingLockdown],
  ([installLess, lockdown, loading]) => {
    if (installLess || lockdown || loading) {
      // The gate has CLOSED on a card that is already up — most often a relaunch of this same
      // install driving the progress takeover. The gate alone only suppresses new shows, so
      // without this the stale card floats over the loader and, worse, leaves the composable
      // latched: main re-arms the install with a fresh grant set and the loading-to-ready
      // transition below cannot raise it. Hiding retires nothing; main still holds the
      // pending notice and `onCoachmarkAutoHidden` clears the display state, so the newer
      // queue is what gets queried when the gate reopens.
      if (betaNotice.isShowing.value) bridge?.hideCoachmark()
      return
    }
    // Defer past the responsive fit settle so the pill's centre is final
    // before anchoring: nextTick flushes the DOM, the rAF the layout.
    void nextTick().then(() => {
      requestAnimationFrame(() => {
        if (unmounted) return
        // AWAITED, not fired alongside: the hint's `maybeShow` suspends on an IPC read before
        // it sets `isShowing`, so launching both together would leave the beta notice's
        // suppression check reading a stale `false`. It happens to work today only because the
        // two IPC replies come back in call order; awaiting makes the dependency real.
        void coachmark.maybeShow().then(() => {
          if (!unmounted) void betaNotice.maybeShow()
        })
      })
    })
  },
  { immediate: true }
)

// Invalidate the learned restore costs when anything that materially
// changes the trailing cluster's content width flips. The fit
// controller re-learns the cost on the next transition.
watch(
  [
    locale,
    installLabel,
    appUpdatePillLabel,
    showAppUpdatePill,
    showInstallUpdatePill,
    // Trailing pills (update / feedback / downloads) hide on
    // first-use lockdown only; loading-lockdown keeps them live, so
    // the legacy `isChromeLocked` would over-invalidate.
    isFirstUseLockdown
  ],
  () => invalidateRestoreCosts()
)

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
  trailingObserver?.disconnect()
  trailingObserver = undefined
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
  <!-- Equal outer tracks keep the identity pill centered. Platform padding reserves
       the native window controls; the trailing ResizeObserver supplies the left track width. -->
  <header
    ref="titleBar"
    class="title-bar relative box-border grid h-screen w-screen grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-solid border-current border-b-[var(--border)] bg-[var(--titlebar-bg-active,var(--titlebar-bg))] px-3 py-0 font-sans text-[12px] leading-none font-normal text-text-muted select-none [-webkit-app-region:drag] [container:title-bar_/_inline-size] [&.is-mac]:pl-[78px] [&.is-mac.is-fullscreen]:pl-3 [&:not(.is-mac)]:pr-[140px] [&:not(.is-light)]:border-b-border"
    :class="{
      'is-mac': isMac,
      'is-light': isLight,
      'is-fullscreen': isFullscreen,
      'is-hover-active': isHoverActive,
      'is-consent-lockdown': isConsentLockdown,
      'is-collapsed-feedback': collapsedFeedback,
      'is-collapsed-update': collapsedUpdate
    }"
    :data-collapse-mode="collapseMode"
    :style="{
      color: themeText ?? undefined,
      '--titlebar-bg-active': themeBg ?? undefined,
      '--titlebar-icon': themeText ?? undefined,
      '--title-trailing-width': `${trailingWidthPx}px`
    }"
  >
    <!-- Left: app menu (hamburger). Anchors a native OS menu in main —
         HTML popups would be clipped by the title bar's WebContentsView
         bounds. We previously labelled this "File", but install-backed
         windows host a ComfyUI WebContentsView whose own menus often
         carry their own "File" — having two "File" entries stacked
         vertically read as redundant. The hamburger reads as a
         host-app-level menu and stays out of ComfyUI's namespace. -->
    <!-- Left cluster: waffle menu. The app-update pill moved to the
         right trailing cluster so all user-action controls
         (update / feedback / downloads / settings) live together.
         Hidden only on `consent-lockdown` — `post-consent` still
         surfaces the "Skip Onboarding" escape, and `loading-lockdown`
         keeps the full menu so the user can open a fresh window,
         settings, feedback, or quit cleanly while an op runs. -->
    <div
      class="title-cluster flex min-w-[var(--title-trailing-width,0px)] items-center gap-1 [.title-bar:not(.is-mac)_&]:min-w-[calc(var(--title-trailing-width,0px)_+_128px)]"
    >
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
        <MenuIcon :size="18" />
      </button>
      <!-- Browser-style refresh for install-backed instances (local +
           remote/cloud), right of the hamburger. Re-navigates the
           comfyView via the same reload path as F5/Ctrl+R. -->
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
    </div>

    <!-- Center: install pill + install-update pill. The downloads tray
         moved to the right trailing cluster alongside the other
         user-action controls; the install-update pill remains here so
         it stays adjacent to the install identity. -->
    <div
      class="title-center flex min-w-0 max-w-full items-center justify-center gap-1 justify-self-center"
    >
      <!-- Center identity pill. Install-backed hosts render as a
           button that opens the instance-picker popover (matching the
           rest of the title-bar dropdown buttons — waffle menu +
           downloads tray). Install-less hosts (the chooser host) AND
           first-use-takeover steps render as a static label — the
           chooser body already IS the picker, and the takeover locks
           down all chrome to avoid wandering out of bootstrap.
           `loading-lockdown` keeps the pill interactive so the user
           can open the picker (switch / open another install) while
           an op runs in the background. -->
      <!-- Interactive on every mode except first-use lockdown. The
           bootstrap UX is the only flow that needs to keep the user
           inside one window; long-running ops mount the ProgressModal
           in this window but leave the title bar free to navigate. -->
      <div
        v-if="!isFirstUseLockdown"
        ref="installPill"
        class="title-install-pill is-interactive"
        :class="[
          titleInstallPillClass,
          {
            'is-open': isInstancePickerOpen,
            'is-coachmark': coachmark.isShowing.value,
            'is-install-less': isInstallLess
          }
        ]"
        role="button"
        tabindex="0"
        aria-haspopup="dialog"
        :aria-expanded="isInstancePickerOpen"
        @click="handleInstallPillWithCoachmark"
        @keydown.enter.prevent="handleInstallPillWithCoachmark"
        @keydown.space.prevent="handleInstallPillWithCoachmark"
      >
        <!-- Leading mark: the Comfy logo only on the bare dashboard; on an
             actual instance the pill leads with that install's source/type
             icon so the brand logo isn't repeated on every window. -->
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
          <!-- Instance update CTA, inline after the name. Its own click
               target — stops propagation so it updates without also
               opening the picker; the rest of the pill still opens it. -->
          <button
            v-if="showInstallUpdatePill"
            type="button"
            class="title-install-update-chip [-webkit-app-region:no-drag] ml-1 inline-flex shrink-0 items-center rounded-[999px] border border-solid border-[color-mix(in_srgb,var(--comfy-yellow)_55%,transparent)] bg-[color-mix(in_srgb,var(--comfy-yellow)_12%,transparent)] px-2 py-px [font-family:inherit] text-[11px] leading-4 font-normal text-comfy-yellow cursor-pointer transition-[background-color,border-color] duration-[120ms] ease-[ease] [.title-bar.is-hover-active_&]:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_20%,transparent)] [.title-bar.is-hover-active_&]:hover:border-comfy-yellow [.title-bar.is-light_&]:bg-[color-mix(in_srgb,var(--comfy-yellow)_22%,transparent)] [.title-bar.is-light_&]:border-[color-mix(in_srgb,var(--comfy-yellow)_70%,var(--neutral-700))] [.title-bar.is-light_&]:text-neutral-700 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-1"
            v-bind="tooltipAttrs(installUpdatePillLabel)"
            @click.stop="handleInstallUpdatePill"
            @keydown.enter.stop
            @keydown.space.stop
          >
            {{ t('titleBar.installUpdateShort') }}
          </button>
        </div>
        <!-- Trailing slot: dropdown caret. Marks the pill as an
             interactive opener so the user reads it as actionable. -->
        <div
          class="title-install-slot title-install-slot--trailing inline-flex flex-[0_0_18px] items-center justify-center"
        >
          <ChevronDown
            :size="12"
            class="title-install-caret shrink-0 text-current opacity-70"
            aria-hidden="true"
          />
        </div>
      </div>
      <div v-else ref="installPill" class="title-install-pill" :class="titleInstallPillClass">
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

    <div ref="titleTrailing" class="title-trailing flex items-center gap-2 [justify-self:end]">
      <!-- App-update pill ("Desktop Update") lives in the trailing
           cluster. The instance-update CTA now lives inside the center
           identity pill (next to the install name) so the two updates
           stay visually distinct: install update = in the center pill;
           Desktop app update = here. -->
      <button
        v-if="!isFirstUseLockdown && showAppUpdatePill"
        type="button"
        class="title-update-pill is-app-update [-webkit-app-region:no-drag] inline-flex items-center gap-1 rounded-[999px] border border-solid border-[color-mix(in_srgb,var(--comfy-yellow)_55%,transparent)] bg-[color-mix(in_srgb,var(--comfy-yellow)_8%,transparent)] px-2.5 py-0.5 [font-family:inherit] text-[12px] leading-4 font-normal text-comfy-yellow cursor-pointer transition-[background-color,border-color,opacity] duration-[120ms] ease-[ease] [.title-bar.is-hover-active_&]:hover:enabled:bg-[color-mix(in_srgb,var(--comfy-yellow)_14%,transparent)] [.title-bar.is-hover-active_&]:hover:enabled:border-comfy-yellow [.title-bar.is-light_&]:bg-[color-mix(in_srgb,var(--comfy-yellow)_18%,transparent)] [.title-bar.is-light_&]:border-[color-mix(in_srgb,var(--comfy-yellow)_65%,var(--neutral-700))] [.title-bar.is-light_&]:text-neutral-700 [.title-bar.is-light.is-hover-active_&]:hover:enabled:bg-[color-mix(in_srgb,var(--comfy-yellow)_26%,transparent)] [.title-bar.is-light.is-hover-active_&]:hover:enabled:border-[color-mix(in_srgb,var(--comfy-yellow)_85%,var(--neutral-700))] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 [.title-bar.is-collapsed-update_&]:size-6 [.title-bar.is-collapsed-update_&]:justify-center [.title-bar.is-collapsed-update_&]:gap-0 [.title-bar.is-collapsed-update_&]:p-0"
        :class="{
          'is-ready': appUpdateState.kind === 'ready',
          'is-downloading': appUpdateState.kind === 'downloading'
        }"
        v-bind="tooltipAttrs(appUpdatePillTooltip)"
        @click="handleAppUpdatePill"
      >
        <CloudDownload v-if="appUpdateState.kind === 'available'" :size="14" />
        <Loader2
          v-else-if="appUpdateState.kind === 'downloading'"
          :size="14"
          class="title-update-pill-spinner animate-spin"
        />
        <RefreshCw v-else-if="appUpdateState.kind === 'ready'" :size="14" />
        <span
          class="title-update-pill-label max-w-[clamp(80px,14cqi,200px)] truncate [.title-bar.is-collapsed-update_&]:hidden"
          >{{ appUpdatePillLabel ?? 'Desktop Update' }}</span
        >
      </button>
      <!-- Zoom-level pill. Contextual — fades in only when the comfyView
           is zoomed off 100%; click resets to 100% and it fades out. -->
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
      <!-- Downloads tray. Click opens the title-bar dropdown popup in
           `'downloads'` mode anchored under the button. Distinct
           `ArrowDownToLine` icon vs. the update pills' `Download` so
           the user reads "downloads tray" vs "update available" at a
           glance. Hidden during first-use takeover — no installs yet.
           Visible during loading-lockdown so model downloads kicked
           off in parallel with an install/update remain reachable. -->
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
        <!-- Mid-batch failure marker: while downloads are still active the
             badge shows the active count, so layer a small red dot on top
             to surface a failure the instant it happens rather than waiting
             for the queue to drain. -->
        <span
          v-if="downloadsActiveCount > 0 && unseenErrorCount > 0"
          class="title-downloads-error-dot pointer-events-none absolute -top-[3px] -left-[3px] size-2 rounded-[999px] bg-[var(--danger)] [box-shadow:0_0_0_2px_var(--titlebar-bg-active,var(--titlebar-bg,var(--neutral-900)))]"
          aria-hidden="true"
        />
      </button>
    </div>
  </header>
</template>

<style>
/* Download notification animations retain their original timing and reduced-motion override. */

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
