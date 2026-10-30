<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CheckCircle,
  XCircle,
  ChevronUp,
  HardDrive,
  SlidersHorizontal,
  Info,
  RefreshCw,
  History,
  SquareTerminal,
  Cloud,
  Play,
  RotateCcw,
  LayoutDashboard,
  SquareArrowOutUpRight,
  Copy,
  CopyPlus,
  FolderOpen,
  Share2,
  ArrowRightLeft,
  Pencil,
  Trash2,
  CircleStop,
  EyeOff,
  Settings2,
  Repeat2,
  Server
} from 'lucide-vue-next'
import type { Component } from 'vue'
import { useComfyUISettings } from '../../composables/useComfyUISettings'
import { useInstanceNavState } from '../../composables/useInstanceNavState'
import { decideNavigation, type NavDecision } from '../../../../shared/navigation/navDecision'
import type { Category, ViewKind } from '../../../../shared/viewKind'
import { findActionById } from '../../lib/findAction'
import MoreMenu, { type MenuAction } from '../../views/comfyUISettings/MoreMenu.vue'
import ArgsBuilderPage from '../../views/comfyUISettings/ArgsBuilderPage.vue'
import SnapshotsView from '../../views/comfyUISettings/SnapshotsView.vue'
import StatusFactPanel from '../../views/comfyUISettings/StatusFactPanel.vue'
import SettingsSectionList from '../../views/comfyUISettings/SettingsSectionList.vue'
import StoragePane, { type StorageSnapshot } from '../../views/comfyUISettings/StoragePane.vue'
import ConsoleTerminalPane from '../../views/comfyUISettings/ConsoleTerminalPane.vue'
import Tooltip from '../ui/Tooltip.vue'
import OperationErrorDetail from '../ui/OperationErrorDetail.vue'
import type { PickerTab, SectionTab } from '../../lib/pickerTabs'
import { isTabAllowedForCategory } from '../../lib/pickerTabs'
import {
  humanizeOpStatus,
  operationInflightLabel,
  operationSuccessLabel
} from '../../lib/progressStatusLabel'
import type { ActionDef, DetailField, Installation, ShowProgressOpts } from '../../types/ipc'
import { TID } from '../../../../shared/testIds'

/** Per-install settings body. The host owns chrome, focus trap, and
 *  dismissal; this component is the pure inner UI. */

export type ComfyUISettingsTab = PickerTab

interface ActiveOperation {
  percent: number
  status: string
  speedBytesPerSec?: number | null
  done: boolean
  ok: boolean | null
  error: string | null
  cancellable: boolean
  title: string
  actionId: string
  actionData?: Record<string, unknown>
}

interface Props {
  installation: Installation | null
  initialTab?: ComfyUISettingsTab
  /** Action id to fire automatically once `sections` load. Consumed
   *  once per (autoAction, autoActionNonce) transition. */
  autoAction?: string | null
  /** Bumped on each explicit (re)open. The popup is cached, so keying
   *  the consumed-guard on this nonce lets a repeat trigger re-fire. */
  autoActionNonce?: number
  globalSettingsSnapshot?: StorageSnapshot
  /** When set and the active tab is `'update'`, the Update tab body is
   *  replaced with an inline progress / result view. */
  activeOperation?: ActiveOperation | null
  /** Install attached to the host window. Decides whether the footer
   *  primary action restarts in-place (this window) or focuses the
   *  install's already-open window (another window). */
  activeInstallationId?: string | null
  /** Host view-kind (from the picker snapshot). Drives the state-aware
   *  navigation decision for the footer CTA + caret. Defaults to a dashboard
   *  host for callers that don't pass it. */
  currentView?: ViewKind
  /** Raw active-install category of the host (`null` on a dashboard host). */
  currentCategory?: Category | null
}

const props = withDefaults(defineProps<Props>(), {
  initialTab: 'update',
  showBack: false,
  autoAction: null,
  autoActionNonce: 0,
  activeOperation: null,
  activeInstallationId: null,
  currentView: 'dashboard',
  currentCategory: null,
  globalSettingsSnapshot: () => ({
    sharedDirectoriesFields: [],
    modelsDirs: [],
    modelsSystemDefault: ''
  })
})

const emit = defineEmits<{
  'show-progress': [opts: ShowProgressOpts]
  /** Install was removed; host should close and tear down the window. */
  'navigate-list': []
  'request-close': []
  /** Backend stopped from the preview; host dismisses the whole popup so the
   *  window's stopped-relaunch card shows. */
  'request-dismiss': []
  /** Footer primary CTA. Carries the resolved `NavDecision`; the picker routes
   *  its verb through the instance-action dispatcher. */
  'primary-action': [decision: NavDecision]
  /** Caret split-button item (e.g. "Open in new window"). Carries the secondary
   *  `NavDecision` the user picked. */
  'open-new-window': [decision: NavDecision]
  'op-cancel': []
  'op-retry': []
  'op-dismiss': []
}>()

const { t } = useI18n()

const activeTab = ref<ComfyUISettingsTab>(props.initialTab)

watch(
  () => props.initialTab,
  (next) => {
    activeTab.value = next
  }
)

watch(
  () => props.installation?.id ?? null,
  (next, prev) => {
    if (next !== prev) activeTab.value = props.initialTab
  }
)

const installation = toRef(props, 'installation')
// One nav-state read-model drives both the footer CTA and the caret; `installCta`
// is its shared run-state derivation, reused here rather than built twice.
const navState = useInstanceNavState(installation, {
  currentView: () => props.currentView,
  currentCategory: () => props.currentCategory,
  activeInstallationId: () => props.activeInstallationId
})
const installCta = navState.cta
const {
  sections,
  loading,
  error,
  notice,
  sectionsFresh,
  updateField,
  renameInstallation,
  pendingRestartFieldIds,
  clearPendingRestart,
  fieldErrorMessages,
  runAction,
  runningActionIds,
  sectionsForTab,
  diskUsageItem,
  pinBottomActions,
  reload
} = useComfyUISettings({
  installation,
  onShowProgress: (opts) => emit('show-progress', opts),
  onNavigateList: () => emit('navigate-list'),
  onClose: () => emit('request-close'),
  onDismissPreview: () => emit('request-dismiss')
})

// Fires the named action once per prop transition, after sections load.
// Keyed on `autoAction` + `autoActionNonce` (not install id) so reloads
// on the same trigger don't double-fire while a repeat of the same
// action still re-fires.
const autoActionKey = computed<string | null>(() =>
  props.autoAction ? `${props.autoAction}#${props.autoActionNonce ?? 0}` : null
)
const consumedAutoActionKey = ref<string | null>(null)
watch(autoActionKey, (next, prev) => {
  if (next !== prev) consumedAutoActionKey.value = null
})
watch(
  [() => autoActionKey.value, () => props.installation?.id ?? null, () => sectionsFresh.value],
  async ([key, installId, isFresh]) => {
    // `isFresh` guards against acting on a previous install's stale
    // payload — sections are no longer blanked on switch.
    if (!installId || !key || !isFresh) return
    if (consumedAutoActionKey.value === key) return
    const autoAction = props.autoAction
    if (!autoAction) return

    // Channel-card-aware resolution so nested per-channel actions target
    // the install's currently-selected channel, not another channel's
    // same-id action.
    const channelField = sections.value
      .flatMap((s) => s.fields ?? [])
      .find((f) => f.editType === 'channel-cards')
    const currentChannel = typeof channelField?.value === 'string' ? channelField.value : null
    const action = findActionById(sections.value, autoAction, currentChannel)
    if (!action) return

    consumedAutoActionKey.value = key
    await nextTick()

    // Re-check the install after the tick — selection can change and a
    // stale invocation would fire a destructive op against the wrong one.
    if (props.installation?.id !== installId) return

    void runAction(action)
  },
  { immediate: true }
)

// Auto-refresh stale channel-cards when the Update tab opens, so a user
// who opens the picker long after install doesn't see release data from
// the last manual check. Fires only when the selected card's
// `data.lastCheckedAt` is missing or older than `STALE_CHANNEL_CARD_MS`.
// Per-(install, channel) dedupe via `refreshedChannelKeys`; main
// short-circuits on a 10s window.
const STALE_CHANNEL_CARD_MS = 15 * 60 * 1000
const refreshedChannelKeys = new Set<string>()
watch(
  [() => activeTab.value, () => props.installation?.id ?? null, () => sectionsFresh.value],
  ([tab, installId, isFresh]) => {
    // `isFresh` is critical: without it the watcher would walk the
    // previous install's stale sections and fire `check-update` against
    // the new install, which errors on Cloud / remote URL installs.
    if (tab !== 'update' || !installId || !isFresh) return

    const channelField = sections.value
      .flatMap((s) => s.fields ?? [])
      .find((f) => f.editType === 'channel-cards')
    if (!channelField) return

    const currentChannel = typeof channelField.value === 'string' ? channelField.value : null
    if (!currentChannel) return

    // Skip while the selected card's data is still fresh. Without this
    // gate the watcher fires on every Update-tab mount regardless of
    // cache age — the dedupe set below only blocks repeat fires within
    // the same component instance, not re-mounts (the picker rebuilds
    // on every open).
    const currentCard = channelField.options?.find((o) => o.value === currentChannel)
    const lastCheckedAt = (currentCard?.data as { lastCheckedAt?: number } | undefined)
      ?.lastCheckedAt
    if (lastCheckedAt && Date.now() - lastCheckedAt <= STALE_CHANNEL_CARD_MS) return

    // Look up the canonical action def from sections to inherit whatever
    // `enabled` / disabledMessage main attaches. Bail if main isn't
    // exposing the action for this install.
    const checkAction = sections.value
      .flatMap((s) => s.actions ?? [])
      .find((a) => a.id === 'check-update')
    if (!checkAction || checkAction.enabled === false) return

    const dedupeKey = `${installId}:${currentChannel}`
    if (refreshedChannelKeys.has(dedupeKey)) return
    refreshedChannelKeys.add(dedupeKey)

    // `silent: true` — automatic on-tab-open refresh, not a user click,
    // so it must not pop the "you're up to date" alert a manual check does.
    void runAction({ ...checkAction, data: { ...checkAction.data, silent: true } })
  },
  { immediate: true }
)

interface TabDef {
  key: ComfyUISettingsTab
  sectionTab: SectionTab
  label: string
  icon: typeof SlidersHorizontal
  /** Richer hover copy; falls back to `label` when unset. */
  tooltip?: string
}

const ALL_TABS: TabDef[] = [
  {
    key: 'update',
    sectionTab: 'update',
    label: t('comfyUISettings.tabUpdate', 'Update'),
    icon: RefreshCw,
    tooltip: t('tooltips.tabUpdate')
  },
  {
    key: 'config',
    sectionTab: 'settings',
    label: t('comfyUISettings.tabConfig', 'Startup Args'),
    icon: SlidersHorizontal,
    tooltip: t('tooltips.tabConfig')
  },
  {
    key: 'snapshots',
    sectionTab: 'snapshots',
    label: t('comfyUISettings.tabSnapshots', 'Snapshots'),
    icon: History,
    tooltip: t('tooltips.snapshots')
  },
  {
    key: 'storage',
    sectionTab: 'storage',
    label: t('comfyUISettings.tabStorage', 'Storage'),
    icon: HardDrive,
    tooltip: t('tooltips.tabStorage')
  },
  {
    key: 'console',
    sectionTab: 'console',
    label: t('comfyUISettings.tabTerminal', 'Terminal'),
    icon: SquareTerminal,
    tooltip: t('tooltips.console')
  },
  {
    key: 'status',
    sectionTab: 'status',
    label: t('comfyUISettings.tabStatus', 'About'),
    icon: Info,
    tooltip: t('tooltips.tabStatus')
  }
]

// The console tab has no backend `sections` — it's a live PTY view — so it
// can't be section-gated like the others. Visibility by instance type is
// centralized in `isTabAllowedForCategory` (cloud + remote run no local
// process to attach a shell to).
const showConsoleTab = computed(
  () =>
    installation.value != null &&
    isTabAllowedForCategory('console', installation.value.sourceCategory)
)

const tabs = computed<TabDef[]>(() => {
  // Cloud runs no local process, so the `config` tab carries no real
  // startup args — relabel it "Storage" to match its contents.
  const isCloud = installation.value?.sourceCategory === 'cloud'
  return ALL_TABS.filter((tab) =>
    tab.key === 'console' ? showConsoleTab.value : sectionsForTab(tab.sectionTab).value.length > 0
  ).map((tab) =>
    isCloud && tab.key === 'config'
      ? { ...tab, label: t('comfyUISettings.tabStorage', 'Storage'), icon: HardDrive }
      : tab
  )
})

const showUpdateBadge = computed(() => {
  const inst = installation.value
  return inst?.statusTag?.style === 'update' || inst?.status === 'update-available'
})

// If the selected tab disappeared, fall back to the requested
// `initialTab` if now available, else the first surviving tab. Prefer
// the requested tab over `next[0]` so deep links honour caller intent.
//
// Gated on `sectionsFresh`: while a local install's sections are empty or
// stale (initial load / retarget), every backend-gated tab vanishes and
// only the section-less Console tab survives, so an ungated fallback would
// latch `activeTab` onto Console and never revert once the real sections
// arrive (the Console tab stays valid). Only reconcile against a payload
// that actually belongs to the current install.
watch([tabs, sectionsFresh], ([next, isFresh]) => {
  if (!isFresh) return
  if (next.length === 0) return
  if (next.some((tab) => tab.key === activeTab.value)) return
  const requested = next.find((tab) => tab.key === props.initialTab)
  activeTab.value = requested ? requested.key : next[0]!.key
})

const visibleSections = computed(() => {
  const tab = tabs.value.find((tt) => tt.key === activeTab.value)?.sectionTab ?? 'settings'
  return sectionsForTab(tab).value
})

const statusSections = computed(() => sectionsForTab('status').value)

const storageSections = computed(() => sectionsForTab('storage').value)

const rootRef = useTemplateRef<HTMLElement>('root')
const tabsRef = useTemplateRef<HTMLElement>('tabs')

// Tooltips that echo the visible label add nothing, so only keep them
// alive for tabs whose label is hidden. Mirror the `< 640px` collapse
// breakpoint (see `@container settings-tabs` below) via a ResizeObserver.
const TAB_COLLAPSE_PX = 640
const tabsCollapsed = ref(false)
let tabsObserver: ResizeObserver | undefined

onMounted(() => {
  if (tabsRef.value && typeof ResizeObserver !== 'undefined') {
    tabsObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      tabsCollapsed.value = entry.contentRect.width < TAB_COLLAPSE_PX
    })
    tabsObserver.observe(tabsRef.value)
  }
})

onUnmounted(() => {
  tabsObserver?.disconnect()
  tabsObserver = undefined
})

function isTabLabelHidden(key: ComfyUISettingsTab): boolean {
  return tabsCollapsed.value && activeTab.value !== key
}

function handleTabKeydown(event: KeyboardEvent, index: number): void {
  if (opInflight.value) return
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  const delta = event.key === 'ArrowRight' ? 1 : -1
  const next = (index + delta + tabs.value.length) % tabs.value.length
  const nextKey = tabs.value[next]?.key
  if (nextKey) {
    selectTab(nextKey)
    nextTick(() => {
      const buttons = rootRef.value?.querySelectorAll<HTMLButtonElement>('.settings-v2-tab')
      buttons?.[next]?.focus()
    })
  }
}

const moreMenuOpen = ref(false)
function toggleMoreMenu(): void {
  moreMenuOpen.value = !moreMenuOpen.value
}
function closeMoreMenu(): void {
  moreMenuOpen.value = false
}

// When set, the body swaps to the dedicated sub-page instead of the
// tab list. Tab switch resets it so the args editor never orphans.
type SubPage = 'args' | null
const subPage = ref<SubPage>(null)
const subPageTransition = ref<'subpage-push' | 'subpage-pop'>('subpage-push')
function openArgsPage(): void {
  subPageTransition.value = 'subpage-push'
  subPage.value = 'args'
}
function handleOpenPath(path: string): void {
  if (path) void window.api.openPath(path)
}
function closeSubPage(): void {
  subPageTransition.value = 'subpage-pop'
  subPage.value = null
}

// Tab-swap transition direction. Compares tab indices from the visible
// `tabs` list (not static ALL_TABS) because cloud installs hide tabs.
const tabTransition = ref<'subpage-push' | 'subpage-pop'>('subpage-push')

function selectTab(key: ComfyUISettingsTab): void {
  // Locked while an op is in flight — only the active tab stays live.
  if (opInflight.value && key !== activeTab.value) return
  if (subPage.value !== null) subPageTransition.value = 'subpage-pop'
  if (key !== activeTab.value) {
    const list = tabs.value
    const fromIdx = list.findIndex((t) => t.key === activeTab.value)
    const toIdx = list.findIndex((t) => t.key === key)
    if (fromIdx >= 0 && toIdx >= 0) {
      tabTransition.value = toIdx > fromIdx ? 'subpage-push' : 'subpage-pop'
    }
  }
  activeTab.value = key
  subPage.value = null
}

// Reset sub-page + close the More menu when the install changes, and
// force the tab-swap into "push" so every switch reads as forward motion.
watch(
  () => props.installation?.id ?? null,
  () => {
    subPage.value = null
    moreMenuOpen.value = false
    tabTransition.value = 'subpage-push'
  }
)

// Keys the inner tab panes so switching installs (even on the same tab)
// remounts the pane and fires the `tabTransition` animation.
const paneInstallKey = computed(() => props.installation?.id ?? 'none')

const argsField = computed<DetailField | null>(() => {
  for (const s of sectionsForTab('settings').value) {
    for (const f of s.fields ?? []) {
      if (f.editType === 'args-builder') return f
    }
  }
  return null
})

const argsValue = computed(() => {
  const v = argsField.value?.value
  return typeof v === 'string' ? v : v == null ? '' : String(v)
})

function handleArgsUpdate(value: string): void {
  const f = argsField.value
  if (f) void updateField(f, value)
}

/** Live `remoteUrl` field from the status sections (remote connections only). */
const remoteUrlField = computed<DetailField | null>(() => {
  for (const s of sectionsForTab('status').value) {
    for (const f of s.fields ?? []) {
      if (f.id === 'remoteUrl') return f
    }
  }
  return null
})

/** Commit a remote-URL edit through `updateField` (optimistic write, rollback,
 *  error pill, restart-dirty + telemetry). Resolves `false` on rejection so
 *  StatusFactPanel reverts; success is read back from the field-error map. */
async function handleUrlUpdate(value: string): Promise<boolean> {
  const field = remoteUrlField.value
  if (!field) return false
  await updateField(field, value)
  return !fieldErrorMessages.value.has(field.id)
}

function handleSnapshotAction(action: ActionDef): void {
  void runAction(action)
}

function handleSnapshotsRefresh(): void {
  void reload()
}

const isRunningInThisWindow = installCta.runningInThisWindow

const hasPendingRestart = computed(
  () => isRunningInThisWindow.value && pendingRestartFieldIds.value.size > 0
)

// The footer CTA verb/label and the caret items both come from one
// `decideNavigation` call (via the shared `navState` above), so they can't drift.
const primaryDecision = computed<NavDecision>(() => decideNavigation(navState.navInput('primary')))

/** Resolve a decision label key, re-pointing "Open Cloud" → "Open Remote" for a
 *  remote install (the table folds remote into cloud; raw category is known here). */
function resolveNavLabel(key: string): string {
  if (key === 'instancePicker.openCloud' && installation.value?.sourceCategory === 'remote') {
    return t('instancePicker.openRemote', 'Open Remote')
  }
  return t(key)
}

const primaryActionLabel = computed(() => {
  if (hasPendingRestart.value) {
    return t('instancePicker.restartToApply', 'Restart to apply changes')
  }
  return resolveNavLabel(primaryDecision.value.primaryLabel)
})

/** Leading icon for a nav label key (shared by the primary CTA and caret items). */
function navIcon(labelKey: string): Component {
  switch (labelKey) {
    case 'instancePicker.openCloud':
      return Cloud
    case 'instancePicker.openDashboard':
      return LayoutDashboard
    case 'instancePicker.restart':
    case 'instancePicker.restartToApply':
      return RotateCcw
    case 'instancePicker.switch':
      return Repeat2
    case 'instancePicker.openInNewWindow':
      return SquareArrowOutUpRight
    case 'instancePicker.open':
      return Play
    default:
      return Settings2
  }
}

/** Category-aware icon: the folded "Open Cloud" cell shows a server glyph for an
 *  actual remote install (mirrors `resolveNavLabel`). */
function navIconFor(key: string): Component {
  if (key === 'instancePicker.openCloud' && installation.value?.sourceCategory === 'remote') {
    return Server
  }
  return navIcon(key)
}

const primaryActionIcon = computed<Component>(() =>
  hasPendingRestart.value ? RotateCcw : navIconFor(primaryDecision.value.primaryLabel)
)

/** The selected install's "Stop" action (absent for cloud — no local process to
 *  stop). Surfaced on the caret to put stopping one click from the CTA. */
const stopAction = computed<ActionDef | undefined>(() =>
  pinBottomActions.value.find((a) => a.id === 'stop')
)
/** Nav caret items are keyed by `secondary[]` index, not label, so two
 *  alternatives sharing a label can't collide. */
const NAV_ITEM_PREFIX = 'nav:'
const caretActions = computed<MenuAction[]>(() => {
  // A running target (verb `focus`) can't open a second window — its only
  // useful caret action is Stop (remote has one; cloud doesn't → empty caret).
  if (primaryDecision.value.verb === 'focus') {
    return stopAction.value ? [{ ...stopAction.value, icon: actionIcon('stop') }] : []
  }
  const navItems: MenuAction[] = primaryDecision.value.secondary.map((alt, i) => ({
    id: `${NAV_ITEM_PREFIX}${i}`,
    label: resolveNavLabel(alt.primaryLabel),
    icon: navIconFor(alt.primaryLabel)
  }))
  if (primaryDecision.value.verb === 'restart' && stopAction.value) {
    navItems.push({ ...stopAction.value, icon: actionIcon('stop') })
  }
  return navItems
})

/** Leading icon for a footer "More" action id; falls back to a neutral glyph so
 *  the icon column never reads half-empty for a backend action we don't map. */
function actionIcon(id: string): Component {
  switch (id) {
    case 'update-comfyui':
    case 'check-update':
      return RefreshCw
    case 'copy':
      return Copy
    case 'copy-update':
    case 'copy-pytorch':
      return CopyPlus
    case 'open-folder':
    case 'reveal-in-folder':
      return FolderOpen
    case 'share':
      return Share2
    case 'migrate-to-standalone':
    case 'migrate':
      return ArrowRightLeft
    case 'restore-snapshot':
      return History
    case 'rename':
      return Pencil
    case 'stop':
      return CircleStop
    case 'untrack':
    case 'remove':
      return EyeOff
    case 'delete':
      return Trash2
    default:
      return Settings2
  }
}

const pinBottomMenuActions = computed<MenuAction[]>(() =>
  pinBottomActions.value.map((action) => ({ ...action, icon: actionIcon(action.id) }))
)

function handlePrimaryAction(): void {
  const selectedInstall = installation.value
  if (!selectedInstall) return
  // A restart click IS the restart: main stops + relaunches with the
  // freshly-saved values, so consume the pending-restart state now. A remote
  // relaunch surfaces no observable lifecycle dip, so the watchers can't clear it.
  if (primaryDecision.value.verb === 'restart' && pendingRestartFieldIds.value.size > 0) {
    clearPendingRestart(selectedInstall.id)
  }
  emit('primary-action', primaryDecision.value)
}

const caretMenuOpen = ref(false)
function toggleCaretMenu(): void {
  caretMenuOpen.value = !caretMenuOpen.value
}
function closeCaretMenu(): void {
  caretMenuOpen.value = false
}
function handleCaretPick(action: ActionDef): void {
  if (!installation.value) return
  // Nav alternatives carry a `nav:<index>` id → emit the matching decision; a
  // reused lifecycle action (e.g. Stop) keeps its own id and routes through the
  // same `runAction` the More menu uses.
  if (action.id.startsWith(NAV_ITEM_PREFIX)) {
    const index = Number(action.id.slice(NAV_ITEM_PREFIX.length))
    const picked = primaryDecision.value.secondary[index]
    if (picked) emit('open-new-window', picked)
    return
  }
  void runAction(action)
}

const opInflight = computed(() => props.activeOperation != null && !props.activeOperation.done)
const opSuccess = computed(
  () => props.activeOperation?.done === true && props.activeOperation.ok === true
)
const opError = computed(
  () =>
    props.activeOperation?.done === true &&
    props.activeOperation.ok === false &&
    props.activeOperation.error !== 'Cancelled.'
)
const opCancelled = computed(
  () => props.activeOperation?.done === true && props.activeOperation.error === 'Cancelled.'
)

const opProgressPct = computed(() =>
  Math.min(100, Math.max(0, props.activeOperation?.percent ?? 0))
)
const opIsIndeterminate = computed(
  () => (props.activeOperation?.percent ?? -1) < 0 && !props.activeOperation?.done
)

const opStatusLabel = computed(() => {
  const op = props.activeOperation
  if (!op) return ''
  if (opCancelled.value) return t('instancePicker.progressCancelled')
  if (opError.value) return op.error ?? t('instancePicker.progressError')
  if (opSuccess.value) return opSuccessLabel.value
  return humanizeOpStatus(op.status, t)
})

const opTitleLabel = computed(() => {
  const op = props.activeOperation
  return op ? operationInflightLabel(op, t) : ''
})

const opSuccessLabel = computed(() => {
  const op = props.activeOperation
  return op ? operationSuccessLabel(op, t) : ''
})

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} KB/s`
  return `${Math.round(bps)} B/s`
}
const opSpeedLabel = computed(() => {
  const spd = props.activeOperation?.speedBytesPerSec
  return spd != null && spd > 0 ? formatSpeed(spd) : null
})

// Show overlay whenever an op is present, except snapshot-restore on
// the Snapshots tab, which has its own timeline rail in SnapshotsView.
const showOpOverlay = computed(() => {
  const op = props.activeOperation
  if (!op) return false
  if (op.actionId === 'snapshot-restore' && activeTab.value === 'snapshots') return false
  return true
})

const opBlocksFooter = computed(() => opInflight.value)

// The tab that renders progress for the active op. Only snapshot-restore
// has its own rail in SnapshotsView (matching `showOpOverlay`); every
// other op — including snapshot-save/delete — surfaces in the Update
// tab's inline overlay.
const opHomeTab = computed<ComfyUISettingsTab | null>(() => {
  const op = props.activeOperation
  if (!op) return null
  return op.actionId === 'snapshot-restore' ? 'snapshots' : 'update'
})

// Locking the other tabs during an op is meant to force the user onto
// the progress view, but the lock alone doesn't move them there. Switch
// to the op's home tab whenever the selected install has an in-flight op
// so progress is always visible. Covers op-start, mount, async tab load,
// and selecting an already-operating install (e.g. from another window's
// shelf). Sets `activeTab` directly because `selectTab` is locked mid-op.
watch(
  [
    () => opInflight.value,
    () => props.installation?.id ?? null,
    () => tabs.value.map((tab) => tab.key).join(',')
  ],
  () => {
    if (!opInflight.value) return
    const home = opHomeTab.value
    if (!home || activeTab.value === home) return
    if (!tabs.value.some((tab) => tab.key === home)) return
    activeTab.value = home
  },
  { immediate: true }
)

const successCountdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

function clearCountdown(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  successCountdown.value = 0
}

watch(opSuccess, (yes) => {
  if (!yes) {
    clearCountdown()
    return
  }
  // Reload so installed version + update badge reflect the new state.
  void reload()
  // Clear the dedup key so the auto-refresh watcher can re-fire.
  const installId = props.installation?.id
  if (installId) {
    for (const key of Array.from(refreshedChannelKeys)) {
      if (key.startsWith(`${installId}:`)) refreshedChannelKeys.delete(key)
    }
  }
  successCountdown.value = 3
  countdownTimer = setInterval(() => {
    successCountdown.value -= 1
    if (successCountdown.value <= 0) {
      clearCountdown()
      emit('op-dismiss')
    }
  }, 1000)
})

// Close the More menu when an op begins, before its footer button greys out.
watch(opInflight, (yes) => {
  if (yes && moreMenuOpen.value) closeMoreMenu()
})

onUnmounted(clearCountdown)

const subpageTransitionActiveClass =
  '[transition:transform_110ms_cubic-bezier(0.32,0.72,0,1),opacity_90ms_ease] motion-reduce:[transition:opacity_70ms_ease]'
const subpageTransitionClasses = {
  'subpage-push': {
    enter:
      'subpage-push-enter-from opacity-0 [transform:translateX(24px)] motion-reduce:transform-none',
    leave:
      'subpage-push-leave-to opacity-0 [transform:translateX(-12px)] motion-reduce:transform-none'
  },
  'subpage-pop': {
    enter:
      'subpage-pop-enter-from opacity-0 [transform:translateX(-12px)] motion-reduce:transform-none',
    leave:
      'subpage-pop-leave-to opacity-0 [transform:translateX(24px)] motion-reduce:transform-none'
  }
}

defineExpose({
  /** Host can force-focus the active tab so initial focus lands in the body. */
  focusActiveTab(): void {
    const firstTab = rootRef.value?.querySelector<HTMLButtonElement>('.settings-v2-tab.is-active')
    firstTab?.focus()
  }
})
</script>

<template>
  <div ref="root" class="settings-v2-content flex min-h-0 flex-1 flex-col">
    <nav
      ref="tabs"
      class="settings-v2-tabs @container/settings-tabs flex min-w-0 shrink-0 flex-nowrap items-center gap-1.5 overflow-hidden border-b border-solid border-[var(--chooser-surface-border)] p-3"
      :class="{ 'is-subpage-active opacity-60': subPage !== null }"
      role="tablist"
      :aria-label="t('comfyUISettings.title', 'Settings')"
    >
      <Tooltip
        v-for="(tab, i) in tabs"
        :key="tab.key"
        :text="tab.tooltip ?? tab.label"
        side="bottom"
        :disabled="tab.tooltip ? false : !isTabLabelHidden(tab.key)"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :tabindex="activeTab === tab.key ? 0 : -1"
          :disabled="opInflight && activeTab !== tab.key"
          class="settings-v2-tab group/settings-tab disabled:cursor-not-allowed inline-flex min-w-0 items-center rounded-lg border-none text-[13px] font-normal cursor-pointer transition-[color,background-color,opacity] duration-[120ms] ease-[ease] [-webkit-app-region:no-drag] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring,var(--neutral-50))] focus-visible:[outline-style:solid] [&>span:not(.settings-v2-tab-icon-wrap)]:min-w-0 [&>span:not(.settings-v2-tab-icon-wrap)]:truncate"
          :class="[
            activeTab === tab.key
              ? 'is-active bg-accent text-text opacity-100'
              : opInflight
                ? 'is-locked bg-transparent text-neutral-100 opacity-40 hover:bg-transparent hover:opacity-40 cursor-not-allowed'
                : 'bg-transparent text-neutral-100 opacity-72 hover:bg-secondary hover:opacity-100',
            'gap-1.5 px-3 py-1.5 [@container_settings-tabs_(width<=640px)]:[&:not(.is-active)]:gap-0 [@container_settings-tabs_(width<=640px)]:[&:not(.is-active)]:px-2 [@container_settings-tabs_(width<=640px)]:[&:not(.is-active)>span:not(.settings-v2-tab-icon-wrap)]:hidden'
          ]"
          :data-testid="TID.settingsTab(tab.key)"
          @click="selectTab(tab.key)"
          @keydown="handleTabKeydown($event, i)"
        >
          <span class="settings-v2-tab-icon-wrap relative inline-flex shrink-0 items-center">
            <component
              :is="tab.icon"
              :size="14"
              aria-hidden="true"
              class="settings-v2-tab-icon shrink-0 opacity-85"
            />
            <span
              v-if="tab.key === 'update' && showUpdateBadge"
              :class="
                activeTab === tab.key ? 'border-neutral-700' : 'border-[var(--modal-surface-bg)]'
              "
              class="settings-v2-tab-badge absolute -right-px -bottom-px box-content size-1.5 rounded-[50%] border-2 border-solid bg-[var(--status-update,#f59e0b)]"
              aria-hidden="true"
            ></span>
          </span>
          <span>{{ tab.label }}</span>
        </button>
      </Tooltip>
    </nav>

    <section
      class="settings-v2-body scroll-visible relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-4"
    >
      <p
        v-if="!installation"
        class="empty m-0 text-[length:var(--takeover-fs-body)] text-text-muted [&.error]:text-danger"
      >
        {{ t('comfyUISettings.emptyInstallLess', 'Open a ComfyUI instance to view its settings.') }}
      </p>
      <p
        v-else-if="loading && !visibleSections.length && activeTab !== 'console'"
        class="empty m-0 text-[length:var(--takeover-fs-body)] text-text-muted [&.error]:text-danger"
        :data-testid="TID.pickerSettingsLoading"
      >
        {{ t('common.loading', 'Loading…') }}
      </p>
      <p
        v-else-if="error && activeTab !== 'console'"
        class="empty error m-0 text-[length:var(--takeover-fs-body)] text-text-muted [&.error]:text-danger"
      >
        {{ error }}
      </p>

      <Transition
        v-else
        :name="subPageTransition"
        mode="out-in"
        :enter-active-class="`${subPageTransition}-enter-active ${subpageTransitionActiveClass}`"
        :leave-active-class="`${subPageTransition}-leave-active ${subpageTransitionActiveClass}`"
        :enter-from-class="subpageTransitionClasses[subPageTransition].enter"
        :leave-to-class="subpageTransitionClasses[subPageTransition].leave"
      >
        <ArgsBuilderPage
          v-if="subPage === 'args' && installation"
          key="subpage-args"
          :installation-id="installation.id"
          :initial-value="argsValue"
          :pending-restart="argsField != null && pendingRestartFieldIds.has(argsField.id)"
          @back="closeSubPage"
          @update="handleArgsUpdate"
        />

        <div
          v-else
          key="subpage-root"
          class="settings-v2-body-root flex flex-auto flex-col gap-[inherit]"
          :class="{ 'is-stale pointer-events-none': !sectionsFresh }"
          :data-testid="TID.pickerSettingsSections"
          :data-install-id="installation?.id"
        >
          <Transition
            :name="tabTransition"
            mode="out-in"
            :enter-active-class="`${tabTransition}-enter-active ${subpageTransitionActiveClass}`"
            :leave-active-class="`${tabTransition}-leave-active ${subpageTransitionActiveClass}`"
            :enter-from-class="subpageTransitionClasses[tabTransition].enter"
            :leave-to-class="subpageTransitionClasses[tabTransition].leave"
          >
            <div
              v-if="activeTab === 'snapshots' && installation"
              :key="`tab-snapshots-${paneInstallKey}`"
              class="settings-v2-tab-pane flex w-full flex-auto flex-col gap-[inherit]"
            >
              <SnapshotsView
                :installation-id="installation.id"
                :active-operation="activeOperation"
                @run-action="handleSnapshotAction"
                @refresh-all="handleSnapshotsRefresh"
                @op-cancel="emit('op-cancel')"
                @op-retry="emit('op-retry')"
                @op-dismiss="emit('op-dismiss')"
              />
            </div>
            <div
              v-else-if="activeTab === 'status' && installation"
              :key="`tab-status-${paneInstallKey}`"
              class="settings-v2-tab-pane flex w-full flex-auto flex-col gap-[inherit]"
            >
              <StatusFactPanel
                :installation="installation"
                :sections="statusSections"
                :disk-usage="diskUsageItem"
                :on-rename="renameInstallation"
                :on-update-url="handleUrlUpdate"
                :url-restart-pending="pendingRestartFieldIds.has('remoteUrl')"
              />
            </div>
            <div
              v-else-if="activeTab === 'storage'"
              :key="`tab-storage-${paneInstallKey}`"
              class="settings-v2-tab-pane flex w-full flex-auto flex-col gap-[inherit]"
            >
              <!-- Lazy-mounted via `v-else-if` so picker opens that never
                   visit Storage skip rendering the global model-dir UI. -->
              <StoragePane
                :snapshot="globalSettingsSnapshot"
                :sections="storageSections"
                :pending-restart-field-ids="pendingRestartFieldIds"
                @update-field="updateField"
                @refresh="reload"
              />
            </div>
            <div
              v-else-if="activeTab === 'console' && installation"
              :key="`tab-console-${paneInstallKey}`"
              class="settings-v2-tab-pane settings-v2-tab-pane--console flex w-full flex-auto flex-col gap-[inherit]"
            >
              <ConsoleTerminalPane :installation-id="installation.id" />
            </div>
            <div
              v-else
              :key="`tab-${activeTab}-${paneInstallKey}`"
              class="settings-v2-tab-pane flex w-full flex-auto flex-col gap-[inherit]"
            >
              <Transition
                name="op-overlay"
                mode="out-in"
                enter-active-class="op-overlay-enter-active transition-[opacity,transform] duration-200 ease-[ease]"
                leave-active-class="op-overlay-leave-active transition-[opacity,transform] duration-200 ease-[ease]"
                enter-from-class="op-overlay-enter-from opacity-0 [transform:translateY(5px)]"
                leave-to-class="op-overlay-leave-to opacity-0 [transform:translateY(5px)]"
              >
                <div
                  v-if="showOpOverlay"
                  key="op-overlay"
                  class="op-overlay flex min-h-[200px] w-full flex-auto box-border flex-col items-center justify-center gap-3 p-6 text-center"
                >
                  <template v-if="opInflight">
                    <p
                      class="op-title m-0 text-[15px] leading-[1.25] font-semibold text-text [&.op-title--error]:text-[var(--brand-error,#e74c3c)] [&.op-title--muted]:text-text-muted"
                    >
                      {{ opTitleLabel }}
                    </p>
                    <p
                      class="op-name m-0 max-w-60 truncate text-[12px] leading-[1.4] text-text-muted [&.op-name--error]:text-[var(--brand-error,#e74c3c)] [&.op-name--error]:opacity-80"
                    >
                      {{ installation?.name }}
                    </p>

                    <div
                      class="op-bar-wrap mt-1 flex w-full max-w-[260px] flex-col gap-[5px]"
                      role="progressbar"
                      :aria-valuenow="opIsIndeterminate ? undefined : opProgressPct"
                      aria-valuemin="0"
                      aria-valuemax="100"
                    >
                      <div class="op-bar-header flex items-baseline justify-between gap-2">
                        <span
                          class="op-bar-status min-w-0 flex-auto truncate text-left text-[11px] text-text-muted"
                          >{{ opStatusLabel }}</span
                        >
                        <span class="op-bar-right flex shrink-0 items-baseline gap-1.5">
                          <span
                            v-if="opSpeedLabel"
                            class="op-speed text-[11px] text-text-muted opacity-65 tabular-nums"
                            >{{ opSpeedLabel }}</span
                          >
                          <span
                            v-if="!opIsIndeterminate"
                            class="op-pct text-[11px] font-semibold text-text tabular-nums"
                            >{{ opProgressPct }}%</span
                          >
                        </span>
                      </div>
                      <div
                        class="op-bar-track h-[3px] overflow-hidden rounded-[2px] bg-[var(--chooser-surface-border)]"
                      >
                        <div
                          class="op-bar-fill h-full rounded-[2px] bg-[var(--brand-accent,#f5c518)] transition-[width] duration-300 ease-[ease]"
                          :class="{
                            'is-indeterminate w-2/5 animate-[op-bar-slide_1.5s_ease-in-out_infinite]':
                              opIsIndeterminate
                          }"
                          :style="opIsIndeterminate ? {} : { width: `${opProgressPct}%` }"
                        />
                      </div>
                    </div>

                    <button
                      v-if="activeOperation?.cancellable"
                      type="button"
                      class="op-ghost-btn h-7 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-3.5 py-0 text-[11px] text-text-muted cursor-pointer transition-[color,border-color] duration-[120ms] ease-[ease] hover:border-[var(--text-muted)] hover:text-text"
                      @click="emit('op-cancel')"
                    >
                      {{ t('instancePicker.progressCancel') }}
                    </button>
                  </template>

                  <template v-else-if="opSuccess">
                    <div
                      class="op-icon op-icon--success mb-0.5 flex items-center justify-center text-[var(--brand-success,#27ae60)]"
                    >
                      <CheckCircle :size="32" />
                    </div>
                    <p
                      class="op-title m-0 text-[15px] leading-[1.25] font-semibold text-text [&.op-title--error]:text-[var(--brand-error,#e74c3c)] [&.op-title--muted]:text-text-muted"
                    >
                      {{ opSuccessLabel }}
                    </p>
                    <p
                      class="op-name m-0 max-w-60 truncate text-[12px] leading-[1.4] text-text-muted [&.op-name--error]:text-[var(--brand-error,#e74c3c)] [&.op-name--error]:opacity-80"
                    >
                      {{ installation?.name }}
                    </p>
                    <p
                      v-if="successCountdown > 0"
                      class="op-countdown m-0 text-[11px] text-text-muted opacity-55"
                    >
                      {{ t('instancePicker.progressSuccessCountdown', { n: successCountdown }) }}
                    </p>
                  </template>

                  <template v-else-if="opError">
                    <div
                      class="op-icon op-icon--error mb-0.5 flex items-center justify-center text-[var(--brand-error,#e74c3c)]"
                    >
                      <XCircle :size="32" />
                    </div>
                    <p
                      class="op-title op-title--error m-0 text-[15px] leading-[1.25] font-semibold text-text [&.op-title--error]:text-[var(--brand-error,#e74c3c)] [&.op-title--muted]:text-text-muted"
                    >
                      {{ t('instancePicker.progressError') }}
                    </p>
                    <OperationErrorDetail
                      v-if="activeOperation?.error"
                      :error="activeOperation.error"
                    />
                    <div class="op-actions mt-1 flex flex-col items-center gap-2">
                      <button
                        type="button"
                        class="op-primary-btn h-8 rounded-lg border-none bg-[var(--brand-accent,#f5c518)] px-[18px] py-0 text-[12px] font-semibold text-black cursor-pointer transition-opacity duration-[120ms] ease-[ease] hover:opacity-85 active:opacity-70"
                        @click="emit('op-retry')"
                      >
                        {{ t('instancePicker.progressRetry') }}
                      </button>
                      <button
                        type="button"
                        class="op-ghost-btn h-7 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-3.5 py-0 text-[11px] text-text-muted cursor-pointer transition-[color,border-color] duration-[120ms] ease-[ease] hover:border-[var(--text-muted)] hover:text-text"
                        @click="emit('op-dismiss')"
                      >
                        {{ t('instancePicker.progressDismiss') }}
                      </button>
                    </div>
                  </template>

                  <template v-else-if="opCancelled">
                    <p
                      class="op-title op-title--muted m-0 text-[15px] leading-[1.25] font-semibold text-text [&.op-title--error]:text-[var(--brand-error,#e74c3c)] [&.op-title--muted]:text-text-muted"
                    >
                      {{ t('instancePicker.progressCancelled') }}
                    </p>
                    <button
                      type="button"
                      class="op-ghost-btn h-7 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-3.5 py-0 text-[11px] text-text-muted cursor-pointer transition-[color,border-color] duration-[120ms] ease-[ease] hover:border-[var(--text-muted)] hover:text-text"
                      @click="emit('op-dismiss')"
                    >
                      {{ t('instancePicker.progressDismiss') }}
                    </button>
                  </template>
                </div>

                <div
                  v-else
                  key="sections"
                  class="settings-v2-tab-pane flex w-full flex-auto flex-col gap-[inherit]"
                >
                  <SettingsSectionList
                    :sections="visibleSections"
                    :installation-id="installation?.id"
                    :running-action-ids="runningActionIds"
                    :pending-restart-field-ids="pendingRestartFieldIds"
                    :field-error-messages="fieldErrorMessages"
                    @update-field="updateField"
                    @run-action="runAction"
                    @open-args-page="openArgsPage"
                    @open-path="handleOpenPath"
                  />
                </div>
              </Transition>
            </div>
          </Transition>
        </div>
      </Transition>
    </section>

    <footer
      class="settings-v2-footer flex shrink-0 items-center justify-end gap-2 border-t border-solid border-[var(--chooser-surface-border)] bg-[var(--modal-surface-bg)] px-4 py-3"
    >
      <Transition
        name="settings-v2-notice-fade"
        enter-active-class="settings-v2-notice-fade-enter-active transition-opacity duration-300 ease-[ease]"
        leave-active-class="settings-v2-notice-fade-leave-active transition-opacity duration-300 ease-[ease]"
        enter-from-class="settings-v2-notice-fade-enter-from opacity-0"
        leave-to-class="settings-v2-notice-fade-leave-to opacity-0"
      >
        <span
          v-if="notice"
          class="settings-v2-notice mr-auto text-[13px] leading-[1.3] text-text-muted"
          role="status"
          aria-live="polite"
        >
          {{ notice }}
        </span>
      </Transition>

      <div
        class="settings-v2-cta-wrap relative inline-flex flex-[0_1_auto]"
        :class="{ 'has-caret': caretActions.length > 0 }"
      >
        <button
          type="button"
          class="settings-v2-relaunch inline-flex h-8 min-w-[200px] flex-[0_1_auto] items-center justify-center gap-[7px] rounded-lg border border-solid px-3.5 py-0 text-[12px] leading-4 font-medium cursor-pointer transition-[background-color,border-color,color] duration-[160ms] ease-[ease] hover:transition-[background,border-color] hover:duration-[120ms] disabled:opacity-40 disabled:cursor-default [&.is-split]:rounded-r-none"
          :class="[
            hasPendingRestart
              ? 'is-pending-restart border-neutral-50 bg-neutral-50 text-background hover:text-neutral-950 enabled:hover:border-accent-hover enabled:hover:bg-accent-hover disabled:hover:border-neutral-50 disabled:hover:bg-neutral-50'
              : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-background enabled:hover:border-accent-hover enabled:hover:bg-accent-hover disabled:hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] disabled:hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)]',
            { 'is-split': caretActions.length > 0 }
          ]"
          :disabled="!installation || opBlocksFooter"
          :data-testid="TID.pickerPrimaryCta"
          @click="handlePrimaryAction"
        >
          <component
            :is="primaryActionIcon"
            :size="15"
            class="settings-v2-relaunch-icon shrink-0 opacity-85"
            aria-hidden="true"
          />
          <span>{{ primaryActionLabel }}</span>
        </button>
        <template v-if="caretActions.length > 0">
          <button
            type="button"
            class="settings-v2-cta-caret font-medium inline-flex h-8 w-[30px] items-center justify-center rounded-r-lg rounded-l-none border border-solid border-[var(--accent-primary)] border-l-[color-mix(in_srgb,var(--neutral-950)_18%,transparent)] bg-[var(--accent-primary)] p-0 text-background cursor-pointer enabled:hover:border-accent-hover enabled:hover:bg-accent-hover disabled:hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] disabled:hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] hover:transition-[background,border-color] hover:duration-[120ms] hover:ease-[ease] disabled:opacity-40 disabled:cursor-default"
            data-more-trigger
            :class="{ 'is-active brightness-[0.94]': caretMenuOpen }"
            aria-haspopup="menu"
            :aria-expanded="caretMenuOpen"
            :aria-label="t('instancePicker.moreWindowOptions', 'Window options')"
            :disabled="!installation || opBlocksFooter"
            :data-testid="TID.pickerNewWindow"
            @click="toggleCaretMenu"
          >
            <ChevronUp :size="14" />
          </button>
          <MoreMenu
            :open="caretMenuOpen"
            :actions="caretActions"
            :heading="t('instancePicker.windowOptions', 'Window options')"
            @close="closeCaretMenu"
            @pick="handleCaretPick"
          />
        </template>
      </div>

      <div class="settings-v2-more-wrap relative inline-flex">
        <button
          type="button"
          class="settings-v2-more inline-flex h-8 items-center gap-1 rounded-lg border-none px-3.5 py-0 text-[12px] leading-4 font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default hover:bg-[var(--brand-surface-border-hover)] hover:text-text hover:outline-none focus-visible:bg-[var(--brand-surface-border-hover)] focus-visible:text-text focus-visible:outline-none"
          data-more-trigger
          :class="
            moreMenuOpen
              ? 'is-active bg-[var(--brand-surface-border-hover)] text-text'
              : 'bg-[var(--chooser-surface-border-hover)] text-neutral-100'
          "
          aria-haspopup="menu"
          :aria-expanded="moreMenuOpen"
          :aria-label="t('comfyUISettings.more', 'More')"
          :disabled="!installation || pinBottomActions.length === 0 || opInflight || !sectionsFresh"
          :data-testid="TID.pickerMoreTrigger"
          @click="toggleMoreMenu"
        >
          {{ t('comfyUISettings.more', 'More') }}
          <ChevronUp :size="14" />
        </button>
        <MoreMenu
          :open="moreMenuOpen"
          :actions="pinBottomMenuActions"
          @close="closeMoreMenu"
          @pick="runAction"
        />
      </div>
    </footer>
  </div>
</template>

<style>
/* The indeterminate operation bar translates beyond both clipped edges. */
@keyframes op-bar-slide {
  0% {
    transform: translateX(-130%);
  }
  100% {
    transform: translateX(280%);
  }
}
</style>
