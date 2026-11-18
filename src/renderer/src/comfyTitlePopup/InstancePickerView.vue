<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed, nextTick, provide, ref, toRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from '@lucide/vue'
import { useInstallList } from '../composables/useInstallList'
import { useDialogs } from '../composables/useDialogs'
import { useInstanceActions } from '../composables/useInstanceActions'
import type { NavDecision } from '../../../shared/navigation/navDecision'
import type { Category, ViewKind } from '../../../shared/viewKind'
import { useSessionStore } from '../stores/sessionStore'
import ComfyUISettingsContent from '../components/settings/ComfyUISettingsContent.vue'
import { SETTINGS_REOPEN_EPOCH } from '../views/comfyUISettings/settingsReopenEpoch'
import InfoTooltip from '../components/InfoTooltip.vue'
import StatusChip from '../components/ui/StatusChip.vue'
import InstanceRow from './instancePicker/InstanceRow.vue'
import { resolvePickerTab, type PickerTab } from '../lib/pickerTabs'
import { resolveProgressRouting } from '../lib/pickerProgressRouting'
import type {
  DetailSection,
  Installation,
  RunningInstance,
  ShowProgressOpts,
  SnapshotListData
} from '../types/ipc'

interface PickerInstall {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  version?: string
  lastLaunchedAt?: number
  installPath?: string
  status?: string
  statusTag?: { style: string; label: string; detail?: string }
}

interface PickerStorageDir {
  path: string
  isPrimary: boolean
}

interface PickerStorageSlice {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: PickerStorageDir[]
  modelsSystemDefault: string
}

interface PickerOperationStatus {
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

interface PickerSnapshot {
  installs: PickerInstall[]
  activeInstallationId: string | null
  currentView?: ViewKind
  currentCategory?: Category | null
  runningInstallationIds: string[]
  runningSessionStartedAt?: Record<string, number>
  launchingInstallationIds: string[]
  unhostedLaunchingInstallationIds?: string[]
  selectedInstallationId: string | null
  pickerSelectionEpoch?: number
  selectedSettings: DetailSection[] | null
  selectedSnapshots: SnapshotListData | null
  initialTab?: string | null
  autoAction?: string | null
  autoActionNonce?: number
  storage: PickerStorageSlice
  operatingInstallationIds?: string[]
  installOperationStatus?: Record<string, PickerOperationStatus>
}

const props = defineProps<{
  snapshot: PickerSnapshot
}>()

provide(
  SETTINGS_REOPEN_EPOCH,
  computed(() => props.snapshot.pickerSelectionEpoch ?? 0)
)

const sessionStore = useSessionStore()
function hydrateSessionStoreFromSnapshot(): void {
  const next = new Set(props.snapshot.runningInstallationIds)
  for (const id of Array.from(sessionStore.runningInstances.keys())) {
    if (!next.has(id)) sessionStore.runningInstances.delete(id)
  }
  const startedAt = props.snapshot.runningSessionStartedAt ?? {}
  for (const id of next) {
    const current = sessionStore.runningInstances.get(id)
    if (!current) {
      const placeholder: RunningInstance = {
        installationId: id,
        installationName: '',
        mode: '',
        startedAt: startedAt[id]
      }
      sessionStore.runningInstances.set(id, placeholder)
    } else if (startedAt[id] !== undefined && current.startedAt !== startedAt[id]) {
      sessionStore.runningInstances.set(id, { ...current, startedAt: startedAt[id] })
    }
  }
  const nextLaunching = new Set(props.snapshot.launchingInstallationIds ?? [])
  for (const id of Array.from(sessionStore.launchingInstances.keys())) {
    if (!nextLaunching.has(id)) sessionStore.launchingInstances.delete(id)
  }
  for (const id of nextLaunching) {
    if (!sessionStore.launchingInstances.has(id)) {
      sessionStore.launchingInstances.set(id, { installationName: '' })
    }
  }
}

interface PickerBridge {
  platform?: string
  activate?: (id: string) => void
  close?: () => void
  pickInstall: (installationId: string) => void
  restartInstall: (installationId: string, opts?: { confirmed?: boolean }) => void
  setPickerSelectedInstall: (installationId: string | null) => void
  pickerUpdateField: (
    installationId: string,
    fieldId: string,
    value: unknown
  ) => Promise<{ ok: boolean; message?: string }>
  pickerRunAction: (
    installationId: string,
    actionId: 'snapshot-save' | 'snapshot-restore' | 'snapshot-delete',
    actionData?: Record<string, unknown>
  ) => Promise<{ ok: boolean; message?: string }>
  openInstallAction: (installationId: string, actionId: string) => void
  pickerForwardShowProgress: (payload: {
    installationId: string
    actionId: string
    actionData?: Record<string, unknown>
    title: string
    cancellable?: boolean
    triggersInstanceStart?: boolean
    opKind?: 'launch' | 'install' | 'update' | 'destructive' | 'snapshot' | 'generic'
    isRestart?: boolean
    routing?: 'same-host' | 'target-host' | 'inline-picker'
    successChoice?: boolean
  }) => void
  pickerStartBackgroundOp: (payload: {
    installationId: string
    actionId: string
    actionData?: Record<string, unknown>
    title: string
    cancellable?: boolean
    opKind?: string
  }) => void
  pickerCancelBackgroundOp: (installationId: string) => void
  pickerDismissBackgroundOp: (installationId: string) => void
}
const bridge = (window as unknown as { __comfyTitlePopup?: PickerBridge }).__comfyTitlePopup

const installations = computed<Installation[]>(
  () => props.snapshot.installs as unknown as Installation[]
)
const installationsRef = toRef(() => installations.value)
const { searchQuery, visibleInstalls, showEmptyHint, lastLaunchedShortLabel } = useInstallList({
  installations: installationsRef
})

const searchOpen = ref(false)
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const searchButton = useTemplateRef<HTMLButtonElement>('searchButton')

async function openSearch(): Promise<void> {
  searchOpen.value = true
  await nextTick()
  searchInput.value?.focus()
}

function closeSearchIfEmpty(): void {
  if (searchQuery.value.trim()) return
  searchQuery.value = ''
  searchOpen.value = false
}

async function onSearchEscape(): Promise<void> {
  if (searchQuery.value) {
    searchQuery.value = ''
    return
  }
  searchOpen.value = false
  await nextTick()
  searchButton.value?.focus()
}

const headerTitle = useTemplateRef<HTMLElement>('headerTitle')
const headerActions = useTemplateRef<HTMLElement>('headerActions')

function mostRecentInstallId(installs: PickerInstall[]): string | null {
  let best: PickerInstall | undefined
  for (const inst of installs) {
    if (!best || (inst.lastLaunchedAt ?? 0) > (best.lastLaunchedAt ?? 0)) {
      best = inst
    }
  }
  return best?.id ?? null
}

function resolveInitialSelection(snapshot: PickerSnapshot): string | null {
  const explicit = snapshot.selectedInstallationId ?? snapshot.activeInstallationId
  if (explicit && snapshot.installs.some((install) => install.id === explicit)) return explicit
  return mostRecentInstallId(snapshot.installs)
}
const selectedId = ref<string | null>(resolveInitialSelection(props.snapshot))
const appliedSelectionEpoch = ref<number>(props.snapshot.pickerSelectionEpoch ?? 0)

watch(
  () => props.snapshot.pickerSelectionEpoch ?? 0,
  (nextEpoch) => {
    if (nextEpoch <= appliedSelectionEpoch.value) return
    appliedSelectionEpoch.value = nextEpoch
    selectedId.value = resolveInitialSelection(props.snapshot)
  }
)

watch(
  () => props.snapshot.installs,
  (installs) => {
    if (installs.some((install) => install.id === selectedId.value)) return
    selectedId.value = resolveInitialSelection(props.snapshot)
  }
)

const selectedInstall = computed<Installation | null>(() => {
  const id = selectedId.value
  if (id) {
    const found = installations.value.find((i) => i.id === id)
    if (found) return found
  }
  return null
})

const selectedStartsWithoutWindow = computed(() => {
  const id = selectedInstall.value?.id
  return id != null && (props.snapshot.unhostedLaunchingInstallationIds ?? []).includes(id)
})

const runningSet = computed(() => new Set(props.snapshot.runningInstallationIds))
const localOperationStatus = ref<Map<string, PickerOperationStatus>>(new Map())

watch(
  () => props.snapshot.installOperationStatus,
  (snapshotOps) => {
    for (const id of localOperationStatus.value.keys()) {
      if (snapshotOps?.[id]) {
        localOperationStatus.value.delete(id)
      }
    }
  },
  { deep: true }
)

const activeOperation = computed<PickerOperationStatus | null>(() => {
  const id = selectedId.value
  if (!id) return null
  return props.snapshot.installOperationStatus?.[id] ?? localOperationStatus.value.get(id) ?? null
})

const effectiveOperatingSet = computed(() => {
  const s = new Set(props.snapshot.operatingInstallationIds ?? [])
  for (const id of localOperationStatus.value.keys()) s.add(id)
  return s
})

function isRowRunning(inst: Installation): boolean {
  return runningSet.value.has(inst.id)
}

function isRowCurrent(inst: Installation): boolean {
  return !!props.snapshot.activeInstallationId && inst.id === props.snapshot.activeInstallationId
}

function isRowUpdateAvailable(inst: Installation): boolean {
  const tagged = inst as Installation & { statusTag?: { style?: string }; status?: string }
  return tagged.statusTag?.style === 'update' || tagged.status === 'update-available'
}

function handleSelect(inst: Installation): void {
  selectedId.value = inst.id
}

function lockLeavingRowSize(el: Element): void {
  const node = el as HTMLElement
  const list = node.parentElement
  if (!list) return
  const rect = node.getBoundingClientRect()
  const listRect = list.getBoundingClientRect()
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
  node.style.left = `${rect.left - listRect.left + list.scrollLeft}px`
  node.style.top = `${rect.top - listRect.top + list.scrollTop}px`
}

function handleClose(): void {
  bridge?.close?.()
}

watch(
  () => selectedInstall.value?.id ?? null,
  (next) => {
    bridge?.setPickerSelectedInstall(next)
  }
)

if (
  selectedId.value &&
  !props.snapshot.selectedInstallationId &&
  !props.snapshot.activeInstallationId
) {
  bridge?.setPickerSelectedInstall(selectedId.value)
}

const initialExpandedTab = computed<PickerTab>(() =>
  resolvePickerTab(props.snapshot.initialTab, 'update')
)

watch(
  [
    () => props.snapshot.runningInstallationIds.join('\0'),
    () => (props.snapshot.launchingInstallationIds ?? []).join('\0'),
    () => JSON.stringify(props.snapshot.runningSessionStartedAt ?? {})
  ],
  () => hydrateSessionStoreFromSnapshot(),
  { immediate: true }
)

function handleSettingsShowProgress(opts: ShowProgressOpts): void {
  if (!opts.actionId) return
  const existingOperation =
    props.snapshot.installOperationStatus?.[opts.installationId] ??
    localOperationStatus.value.get(opts.installationId)
  if (existingOperation && !existingOperation.done) return

  const rawActionData = opts.actionData
    ? (JSON.parse(JSON.stringify(opts.actionData)) as Record<string, unknown>)
    : undefined
  const { routing, successChoice } = resolveProgressRouting(
    opts,
    props.snapshot.activeInstallationId
  )
  if (routing === 'inline-picker') {
    localOperationStatus.value.set(opts.installationId, {
      percent: -1,
      status: opts.actionId === 'snapshot-restore' ? 'Loading snapshot…' : '',
      done: false,
      ok: null,
      error: null,
      cancellable: opts.cancellable ?? false,
      title: opts.title,
      actionId: opts.actionId,
      actionData: rawActionData
    })
    selectedId.value = opts.installationId
    bridge?.pickerStartBackgroundOp({
      installationId: opts.installationId,
      actionId: opts.actionId,
      actionData: rawActionData,
      title: opts.title,
      cancellable: opts.cancellable,
      opKind: opts.opKind
    })
    return
  }
  bridge?.pickerForwardShowProgress({
    installationId: opts.installationId,
    actionId: opts.actionId,
    actionData: rawActionData,
    title: opts.title,
    cancellable: opts.cancellable,
    triggersInstanceStart: opts.triggersInstanceStart,
    opKind: opts.opKind,
    isRestart: opts.actionId === 'restart',
    routing,
    successChoice
  })
}

function handleInlineProgressCancel(): void {
  const id = selectedId.value
  if (!id) return
  bridge?.pickerCancelBackgroundOp(id)
}

function handleInlineProgressRetry(): void {
  const id = selectedId.value
  if (!id || !activeOperation.value) return
  const op = activeOperation.value
  bridge?.pickerStartBackgroundOp({
    installationId: id,
    actionId: op.actionId,
    actionData: op.actionData,
    title: op.title,
    cancellable: op.cancellable
  })
}

function handleInlineProgressDismiss(): void {
  const id = selectedId.value
  if (!id) return
  bridge?.pickerDismissBackgroundOp(id)
}

function handleSettingsNavigateList(): void {
  selectedId.value = null
}

const dialogs = useDialogs()
const { t } = useI18n()

const instanceActions = useInstanceActions({
  bridge,
  confirmLocalKill: async (inst) => {
    if (inst.sourceCategory !== 'local') return true
    const result = await dialogs.confirm({
      title: t('instancePicker.restartConfirmHeading'),
      message: t('instancePicker.restartConfirmTitle'),
      confirmLabel: t('instancePicker.restartConfirmAction'),
      cancelLabel: t('common.cancel'),
      messageDetails: [
        {
          label: t('instancePicker.confirmHeadsUp'),
          items: [t('instancePicker.restartConfirmItem1'), t('instancePicker.restartConfirmItem2')]
        }
      ]
    })
    return result === 'primary'
  }
})

async function handleExpandedNav(decision: NavDecision): Promise<void> {
  const inst = selectedInstall.value
  if (!inst) return
  await instanceActions.dispatch(decision, inst)
}
</script>

<template>
  <div class="picker flex size-full box-border bg-transparent">
    <div
      class="picker-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-[var(--modal-surface-bg)] [box-shadow:inset_0_0_0_1px_rgb(255_255_255/0.06)]"
    >
      <div
        class="picker-body grid min-h-0 flex-[1_1_0] grid-cols-[clamp(200px,30%,280px)_minmax(0,1fr)]"
      >
        <div
          class="picker-left m-2 mr-0 flex min-h-0 min-w-0 flex-col gap-2 rounded-[14px] bg-[var(--picker-side-bg)] p-2 [--picker-row-hover:color-mix(in_oklch,var(--foreground)_11%,var(--modal-surface-bg))] [--picker-row-active:color-mix(in_oklch,var(--foreground)_15%,var(--modal-surface-bg))] [--picker-side-bg:color-mix(in_oklch,var(--foreground)_6%,var(--modal-surface-bg))]"
        >
          <div class="picker-list-section -mx-2 flex min-h-0 flex-auto flex-col overflow-hidden">
            <div class="picker-list-head relative mx-2 mb-2 h-8 flex-none">
              <div
                class="picker-list-section-title flex h-full items-center gap-1 pr-0.5 pl-3 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase transition-opacity duration-150 ease-out"
                :class="{ 'opacity-0': searchOpen }"
                :inert="searchOpen"
              >
                {{ $t('instancePicker.instances')
                }}<InfoTooltip :text="$t('tooltips.instances')" side="bottom" />
                <button
                  ref="searchButton"
                  type="button"
                  class="picker-search-toggle ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-[var(--picker-row-hover)] hover:text-foreground focus-visible:bg-[var(--picker-row-hover)] focus-visible:text-foreground focus-visible:outline-none"
                  :aria-label="$t('instancePicker.searchPlaceholder')"
                  :aria-expanded="searchOpen"
                  @click="openSearch"
                >
                  <Search :size="16" aria-hidden="true" />
                </button>
              </div>
              <Transition
                enter-active-class="transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
                enter-from-class="translate-x-2 opacity-0"
                leave-active-class="transition-[opacity,transform] duration-100 ease-in motion-reduce:transition-none"
                leave-to-class="translate-x-2 opacity-0"
              >
                <label
                  v-if="searchOpen"
                  class="picker-search absolute inset-0 grid cursor-text grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 rounded-lg bg-[var(--picker-row-hover)] px-3"
                >
                  <span
                    class="picker-search-icon flex size-4 items-center justify-center text-muted-foreground"
                    aria-hidden="true"
                    ><Search :size="16"
                  /></span>
                  <input
                    ref="searchInput"
                    v-model="searchQuery"
                    type="text"
                    class="picker-search-input m-0 min-w-0 border-0 bg-transparent p-0 text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground"
                    :placeholder="$t('instancePicker.searchPlaceholder')"
                    :aria-label="$t('instancePicker.searchPlaceholder')"
                    @keydown.esc.stop.prevent="onSearchEscape"
                    @blur="closeSearchIfEmpty"
                  />
                </label>
              </Transition>
            </div>

            <TransitionGroup
              tag="div"
              name="picker-row"
              enter-active-class="picker-row-enter-active [transition:opacity_200ms_ease,transform_200ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:duration-[1ms]"
              enter-from-class="picker-row-enter-from opacity-0 [transform:translateY(8px)_scale(0.98)] motion-reduce:transform-none"
              leave-active-class="picker-row-leave-active absolute [transition:opacity_140ms_ease,transform_140ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
              leave-to-class="picker-row-leave-to opacity-0 [transform:scale(0.98)] motion-reduce:transform-none"
              move-class="picker-row-move [transition:transform_220ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
              class="picker-list relative flex min-h-0 flex-auto flex-col gap-px overflow-y-auto"
              role="listbox"
              @before-leave="lockLeavingRowSize"
            >
              <InstanceRow
                v-for="inst in visibleInstalls"
                :key="inst.id"
                :installation="inst"
                :active="selectedId === inst.id"
                :running="isRowRunning(inst)"
                :is-current="isRowCurrent(inst)"
                :update-available="isRowUpdateAvailable(inst)"
                :operating="effectiveOperatingSet.has(inst.id)"
                :last-launched-short-label="lastLaunchedShortLabel(inst)"
                @select="handleSelect"
              />

              <div
                v-if="showEmptyHint"
                key="__empty"
                class="picker-list-empty px-[18px] py-2 text-[14px] text-neutral-100"
              >
                {{ $t('instancePicker.noMatches') }}
              </div>
            </TransitionGroup>
          </div>
        </div>

        <div class="picker-detail-wrap is-expanded flex min-h-0 min-w-0 overflow-hidden p-0">
          <div class="picker-detail relative flex min-h-0 min-w-0 flex-[1_1_0] flex-col gap-0">
            <template v-if="selectedInstall">
              <header class="picker-detail-header flex shrink-0 items-center gap-3 px-5 pt-5 pb-4">
                <h2
                  ref="headerTitle"
                  class="m-0 flex min-w-0 text-[20px]/7 font-semibold text-foreground"
                ></h2>
                <StatusChip v-if="isRowRunning(selectedInstall)" tone="go">{{
                  $t('chooser.statusRunning')
                }}</StatusChip>
                <div ref="headerActions" class="ml-auto flex shrink-0 items-center gap-2" />
              </header>
              <ComfyUISettingsContent
                :actions-target="headerActions"
                :page-title-target="headerTitle"
                :installation="selectedInstall"
                :initial-tab="initialExpandedTab"
                :auto-action="snapshot.autoAction ?? null"
                :auto-action-nonce="snapshot.autoActionNonce ?? 0"
                :global-settings-snapshot="snapshot.storage"
                :active-operation="activeOperation"
                :active-installation-id="snapshot.activeInstallationId"
                :current-view="snapshot.currentView ?? 'dashboard'"
                :current-category="snapshot.currentCategory ?? null"
                :starting-without-window="selectedStartsWithoutWindow"
                class="picker-expanded-body min-h-0 flex-auto [--text-muted:var(--neutral-100)]"
                @show-progress="handleSettingsShowProgress"
                @navigate-list="handleSettingsNavigateList"
                @request-close="handleSettingsNavigateList"
                @request-dismiss="handleClose"
                @primary-action="handleExpandedNav"
                @op-cancel="handleInlineProgressCancel"
                @op-retry="handleInlineProgressRetry"
                @op-dismiss="handleInlineProgressDismiss"
              />
            </template>
            <div v-else class="picker-detail-empty m-auto text-[14px] text-neutral-100 opacity-70">
              {{ $t('instancePicker.empty') }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="picker-close-lane flex w-12 shrink-0 justify-end" @mousedown.self="handleClose">
      <Button
        type="button"
        variant="muted-textonly"
        size="icon"
        class="picker-close size-9 rounded-full bg-[var(--modal-surface-bg)] text-white [box-shadow:inset_0_0_0_1px_rgb(255_255_255/0.06)] hover:bg-[color-mix(in_oklch,var(--foreground)_10%,var(--modal-surface-bg))] hover:text-white"
        :aria-label="$t('common.close')"
        :title="$t('common.close')"
        @click="handleClose"
      >
        <X :size="18" aria-hidden="true" />
      </Button>
    </div>
  </div>
</template>
