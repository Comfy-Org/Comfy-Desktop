<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import Tabs from '@comfyorg/design-system/tabs/Tabs'
import TabsList from '@comfyorg/design-system/tabs/TabsList'
import TabsTrigger from '@comfyorg/design-system/tabs/TabsTrigger'
import TabsContent from '@comfyorg/design-system/tabs/TabsContent'
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CheckCircle,
  XCircle,
  ChevronDown,
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
  autoAction?: string | null
  autoActionNonce?: number
  globalSettingsSnapshot?: StorageSnapshot
  activeOperation?: ActiveOperation | null
  activeInstallationId?: string | null
  currentView?: ViewKind
  currentCategory?: Category | null
  pageActionsTarget?: string
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
  pageActionsTarget: undefined,
  globalSettingsSnapshot: () => ({
    sharedDirectoriesFields: [],
    modelsDirs: [],
    modelsSystemDefault: ''
  })
})

const emit = defineEmits<{
  'show-progress': [opts: ShowProgressOpts]
  'navigate-list': []
  'request-close': []
  'request-dismiss': []
  'primary-action': [decision: NavDecision]
  'open-new-window': [decision: NavDecision]
  'op-cancel': []
  'op-retry': []
  'op-dismiss': []
}>()

const { t } = useI18n()

const isPage = computed(() => props.pageActionsTarget !== undefined)
const menuChevron = computed(() => (isPage.value ? ChevronDown : ChevronUp))

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
    if (!installId || !key || !isFresh) return
    if (consumedAutoActionKey.value === key) return
    const autoAction = props.autoAction
    if (!autoAction) return

    const channelField = sections.value
      .flatMap((s) => s.fields ?? [])
      .find((f) => f.editType === 'channel-cards')
    const currentChannel = typeof channelField?.value === 'string' ? channelField.value : null
    const action = findActionById(sections.value, autoAction, currentChannel)
    if (!action) return

    consumedAutoActionKey.value = key
    await nextTick()

    if (props.installation?.id !== installId) return

    void runAction(action)
  },
  { immediate: true }
)

const STALE_CHANNEL_CARD_MS = 15 * 60 * 1000
const refreshedChannelKeys = new Set<string>()
watch(
  [() => activeTab.value, () => props.installation?.id ?? null, () => sectionsFresh.value],
  ([tab, installId, isFresh]) => {
    if (tab !== 'update' || !installId || !isFresh) return

    const channelField = sections.value
      .flatMap((s) => s.fields ?? [])
      .find((f) => f.editType === 'channel-cards')
    if (!channelField) return

    const currentChannel = typeof channelField.value === 'string' ? channelField.value : null
    if (!currentChannel) return

    const currentCard = channelField.options?.find((o) => o.value === currentChannel)
    const lastCheckedAt = (currentCard?.data as { lastCheckedAt?: number } | undefined)
      ?.lastCheckedAt
    if (lastCheckedAt && Date.now() - lastCheckedAt <= STALE_CHANNEL_CARD_MS) return

    const checkAction = sections.value
      .flatMap((s) => s.actions ?? [])
      .find((a) => a.id === 'check-update')
    if (!checkAction || checkAction.enabled === false) return

    const dedupeKey = `${installId}:${currentChannel}`
    if (refreshedChannelKeys.has(dedupeKey)) return
    refreshedChannelKeys.add(dedupeKey)

    void runAction({ ...checkAction, data: { ...checkAction.data, silent: true } })
  },
  { immediate: true }
)

interface TabDef {
  key: ComfyUISettingsTab
  sectionTab: SectionTab
  label: string
  icon: typeof SlidersHorizontal
  tooltip?: string
}

const ALL_TABS: TabDef[] = [
  {
    key: 'update',
    sectionTab: 'update',
    label: t('comfyUISettings.tabUpdate'),
    icon: RefreshCw,
    tooltip: t('tooltips.tabUpdate')
  },
  {
    key: 'config',
    sectionTab: 'settings',
    label: t('comfyUISettings.tabConfig'),
    icon: SlidersHorizontal,
    tooltip: t('tooltips.tabConfig')
  },
  {
    key: 'snapshots',
    sectionTab: 'snapshots',
    label: t('comfyUISettings.tabSnapshots'),
    icon: History,
    tooltip: t('tooltips.snapshots')
  },
  {
    key: 'storage',
    sectionTab: 'storage',
    label: t('comfyUISettings.tabStorage'),
    icon: HardDrive,
    tooltip: t('tooltips.tabStorage')
  },
  {
    key: 'console',
    sectionTab: 'console',
    label: t('comfyUISettings.tabTerminal'),
    icon: SquareTerminal,
    tooltip: t('tooltips.console')
  },
  {
    key: 'status',
    sectionTab: 'status',
    label: t('comfyUISettings.tabStatus'),
    icon: Info,
    tooltip: t('tooltips.tabStatus')
  }
]

const showConsoleTab = computed(
  () =>
    installation.value != null &&
    isTabAllowedForCategory('console', installation.value.sourceCategory)
)

const tabs = computed<TabDef[]>(() => {
  const isCloud = installation.value?.sourceCategory === 'cloud'
  return ALL_TABS.filter((tab) =>
    tab.key === 'console' ? showConsoleTab.value : sectionsForTab(tab.sectionTab).value.length > 0
  ).map((tab) =>
    isCloud && tab.key === 'config'
      ? { ...tab, label: t('comfyUISettings.tabStorage'), icon: HardDrive }
      : tab
  )
})

const showUpdateBadge = computed(() => {
  const inst = installation.value
  return inst?.statusTag?.style === 'update' || inst?.status === 'update-available'
})

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
const footerRef = useTemplateRef<HTMLElement>('footer')
const tabsRef = useTemplateRef<HTMLElement>('tabs')

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

function onTabValueChange(value: string | number): void {
  const tab = tabs.value.find((item) => item.key === value)
  if (tab) selectTab(tab.key)
}

const moreMenuOpen = ref(false)
function toggleMoreMenu(): void {
  moreMenuOpen.value = !moreMenuOpen.value
}
function closeMoreMenu(): void {
  moreMenuOpen.value = false
}

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

const tabTransition = ref<'subpage-push' | 'subpage-pop'>('subpage-push')

function selectTab(key: ComfyUISettingsTab): void {
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

watch(
  () => props.installation?.id ?? null,
  () => {
    subPage.value = null
    moreMenuOpen.value = false
    tabTransition.value = 'subpage-push'
  }
)

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

const remoteUrlField = computed<DetailField | null>(() => {
  for (const s of sectionsForTab('status').value) {
    for (const f of s.fields ?? []) {
      if (f.id === 'remoteUrl') return f
    }
  }
  return null
})

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

const primaryDecision = computed<NavDecision>(() => decideNavigation(navState.navInput('primary')))

function resolveNavLabel(key: string): string {
  if (key === 'instancePicker.openCloud' && installation.value?.sourceCategory === 'remote') {
    return t('instancePicker.openRemote')
  }
  return t(key)
}

const primaryActionLabel = computed(() => {
  if (hasPendingRestart.value) {
    return t('instancePicker.restartToApply')
  }
  return resolveNavLabel(primaryDecision.value.primaryLabel)
})

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

function navIconFor(key: string): Component {
  if (key === 'instancePicker.openCloud' && installation.value?.sourceCategory === 'remote') {
    return Server
  }
  return navIcon(key)
}

const primaryActionIcon = computed<Component>(() =>
  hasPendingRestart.value ? RotateCcw : navIconFor(primaryDecision.value.primaryLabel)
)

const stopAction = computed<ActionDef | undefined>(() =>
  pinBottomActions.value.find((a) => a.id === 'stop')
)
const NAV_ITEM_PREFIX = 'nav:'
const caretActions = computed<MenuAction[]>(() => {
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

const showOpOverlay = computed(() => {
  const op = props.activeOperation
  if (!op) return false
  if (op.actionId === 'snapshot-restore' && activeTab.value === 'snapshots') return false
  return true
})

const opBlocksFooter = computed(() => opInflight.value)

const opHomeTab = computed<ComfyUISettingsTab | null>(() => {
  const op = props.activeOperation
  if (!op) return null
  return op.actionId === 'snapshot-restore' ? 'snapshots' : 'update'
})

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
  void reload()
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
  focusActiveTab(): void {
    const firstTab = rootRef.value?.querySelector<HTMLButtonElement>('.settings-v2-tab.is-active')
    firstTab?.focus()
  }
})
</script>

<template>
  <Tabs :model-value="activeTab" as-child @update:model-value="onTabValueChange">
    <div ref="root" class="settings-v2-content flex min-h-0 flex-1 flex-col">
      <TabsList as-child>
        <nav
          ref="tabs"
          class="settings-v2-tabs flex min-w-0 shrink-0 flex-nowrap items-center overflow-hidden"
          :class="[
            isPage
              ? 'w-fit gap-0.5 rounded-[10px] bg-secondary p-[3px]'
              : '@container/settings-tabs gap-1.5 border-b border-solid border-[var(--chooser-surface-border)] p-3',
            { 'is-subpage-active opacity-60': subPage !== null }
          ]"
          :aria-label="t('comfyUISettings.title')"
        >
          <Tooltip
            v-for="tab in tabs"
            :key="tab.key"
            :text="tab.tooltip ?? tab.label"
            side="bottom"
            :disabled="tab.tooltip ? false : !isTabLabelHidden(tab.key)"
          >
            <TabsTrigger
              :value="tab.key"
              variant="panel"
              :disabled="opInflight && activeTab !== tab.key"
              class="settings-v2-tab group/settings-tab min-w-0 gap-1.5 [-webkit-app-region:no-drag] [&>span:not(.settings-v2-tab-icon-wrap)]:min-w-0 [&>span:not(.settings-v2-tab-icon-wrap)]:truncate [@container_settings-tabs_(width<=640px)]:[&:not(.is-active)]:gap-0 [@container_settings-tabs_(width<=640px)]:[&:not(.is-active)]:px-2 [@container_settings-tabs_(width<=640px)]:[&:not(.is-active)>span:not(.settings-v2-tab-icon-wrap)]:hidden"
              :class="[
                {
                  'is-active': activeTab === tab.key,
                  'is-locked': opInflight && activeTab !== tab.key
                },
                isPage &&
                  'm-0 h-[26px] rounded-[7px] border-0 bg-transparent px-[11px] py-0 text-[13px] font-normal text-muted-foreground hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground'
              ]"
              :data-testid="TID.settingsTab(tab.key)"
              @click="selectTab(tab.key)"
            >
              <span class="settings-v2-tab-icon-wrap relative inline-flex shrink-0 items-center">
                <component
                  :is="tab.icon"
                  v-if="!isPage"
                  :size="14"
                  aria-hidden="true"
                  class="settings-v2-tab-icon shrink-0 opacity-85"
                />
                <span
                  v-if="tab.key === 'update' && showUpdateBadge"
                  :class="[
                    activeTab === tab.key
                      ? 'border-neutral-700'
                      : 'border-[var(--modal-surface-bg)]',
                    !isPage && 'absolute -right-px -bottom-px'
                  ]"
                  class="settings-v2-tab-badge box-content size-1.5 rounded-[50%] border-2 border-solid bg-[var(--status-update,#f59e0b)]"
                  aria-hidden="true"
                ></span>
              </span>
              <span>{{ tab.label }}</span>
            </TabsTrigger>
          </Tooltip>
        </nav>
      </TabsList>

      <TabsContent :value="activeTab" as-child force-mount>
        <section
          class="settings-v2-body scroll-visible relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
          :class="isPage ? 'pt-5 pb-8' : 'p-4'"
        >
          <p
            v-if="!installation"
            class="empty m-0 text-[length:var(--takeover-fs-body)] text-text-muted [&.error]:text-danger"
          >
            {{ t('comfyUISettings.emptyInstallLess') }}
          </p>
          <p
            v-else-if="loading && !visibleSections.length && activeTab !== 'console'"
            class="empty m-0 text-[length:var(--takeover-fs-body)] text-text-muted [&.error]:text-danger"
            :data-testid="TID.pickerSettingsLoading"
          >
            {{ t('common.loading') }}
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

                        <Button
                          v-if="activeOperation?.cancellable"
                          variant="outline"
                          size="sm"
                          type="button"
                          class="op-ghost-btn"
                          @click="emit('op-cancel')"
                        >
                          {{ t('instancePicker.progressCancel') }}
                        </Button>
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
                          {{
                            t('instancePicker.progressSuccessCountdown', { n: successCountdown })
                          }}
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
                          <Button
                            variant="inverted"
                            size="md"
                            type="button"
                            class="op-primary-btn"
                            @click="emit('op-retry')"
                          >
                            {{ t('instancePicker.progressRetry') }}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            class="op-ghost-btn"
                            @click="emit('op-dismiss')"
                          >
                            {{ t('instancePicker.progressDismiss') }}
                          </Button>
                        </div>
                      </template>

                      <template v-else-if="opCancelled">
                        <p
                          class="op-title op-title--muted m-0 text-[15px] leading-[1.25] font-semibold text-text [&.op-title--error]:text-[var(--brand-error,#e74c3c)] [&.op-title--muted]:text-text-muted"
                        >
                          {{ t('instancePicker.progressCancelled') }}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          class="op-ghost-btn"
                          @click="emit('op-dismiss')"
                        >
                          {{ t('instancePicker.progressDismiss') }}
                        </Button>
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
      </TabsContent>

      <Teleport defer :to="pageActionsTarget" :disabled="!pageActionsTarget">
        <footer
          ref="footer"
          class="settings-v2-footer flex shrink-0 items-center justify-end gap-2"
          :class="
            !isPage &&
            'border-t border-solid border-[var(--chooser-surface-border)] bg-[var(--modal-surface-bg)] px-4 py-3'
          "
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
            <Button
              variant="inverted"
              size="md"
              type="button"
              class="settings-v2-relaunch flex-[0_1_auto] [&.is-split]:rounded-r-none"
              :class="[
                isPage ? 'gap-1.5 px-3 text-[13px]/5' : 'min-w-[200px]',
                { 'is-pending-restart': hasPendingRestart },
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
            </Button>
            <template v-if="caretActions.length > 0">
              <Button
                variant="inverted"
                size="icon"
                type="button"
                class="settings-v2-cta-caret rounded-l-none border-l border-solid border-background/20"
                data-more-trigger
                :class="{ 'is-active brightness-[0.94]': caretMenuOpen }"
                aria-haspopup="menu"
                :aria-expanded="caretMenuOpen"
                :aria-label="t('instancePicker.moreWindowOptions')"
                :disabled="!installation || opBlocksFooter"
                :data-testid="TID.pickerNewWindow"
                @click="toggleCaretMenu"
              >
                <component :is="menuChevron" :size="14" />
              </Button>
              <MoreMenu
                :open="caretMenuOpen"
                :anchor="footerRef?.querySelector<HTMLElement>('.settings-v2-cta-caret')"
                :actions="caretActions"
                :heading="t('instancePicker.windowOptions')"
                @close="closeCaretMenu"
                @pick="handleCaretPick"
              />
            </template>
          </div>

          <div class="settings-v2-more-wrap relative inline-flex">
            <Button
              variant="secondary"
              size="md"
              type="button"
              class="settings-v2-more"
              data-more-trigger
              :class="{ 'is-active': moreMenuOpen }"
              aria-haspopup="menu"
              :aria-expanded="moreMenuOpen"
              :aria-label="t('comfyUISettings.more')"
              :disabled="
                !installation || pinBottomActions.length === 0 || opInflight || !sectionsFresh
              "
              :data-testid="TID.pickerMoreTrigger"
              @click="toggleMoreMenu"
            >
              {{ t('comfyUISettings.more') }}
              <component :is="menuChevron" :size="14" />
            </Button>
            <MoreMenu
              :open="moreMenuOpen"
              :anchor="footerRef?.querySelector<HTMLElement>('.settings-v2-more')"
              :actions="pinBottomMenuActions"
              @close="closeMoreMenu"
              @pick="runAction"
            />
          </div>
        </footer>
      </Teleport>
    </div>
  </Tabs>
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
