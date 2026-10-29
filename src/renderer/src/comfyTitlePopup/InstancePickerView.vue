<script setup lang="ts">
import { computed, provide, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutDashboard, Plus, Search, X } from 'lucide-vue-next'
import BaseInput from '../components/ui/BaseInput.vue'
import { FILTER_CHIPS, useInstallList } from '../composables/useInstallList'
import { useDialogs } from '../composables/useDialogs'
import { useInstanceActions } from '../composables/useInstanceActions'
import type { NavDecision } from '../../../shared/navigation/navDecision'
import type { Category, ViewKind } from '../../../shared/viewKind'
import { useSessionStore } from '../stores/sessionStore'
import ComfyUISettingsContent from '../components/settings/ComfyUISettingsContent.vue'
import { SETTINGS_REOPEN_EPOCH } from '../views/comfyUISettings/settingsReopenEpoch'
import InfoTooltip from '../components/InfoTooltip.vue'
import Tooltip from '../components/ui/Tooltip.vue'
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

/** Must stay in sync with `PickerStorageSlice` in `src/main/popups/titlePopup.ts`. */
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
  /** Host view-kind + active-install category for the navigation matrix.
   *  Mirrors `InstancePickerSnapshot` in main; optional for older bundles. */
  currentView?: ViewKind
  currentCategory?: Category | null
  runningInstallationIds: string[]
  /** `startedAt` per running session; changes on a restart the id list cannot show. */
  runningSessionStartedAt?: Record<string, number>
  /** Installs launching but not yet started. Hydrated into
   *  sessionStore because the popup preload has no onInstanceLaunching. */
  launchingInstallationIds: string[]
  selectedInstallationId: string | null
  /** Bumped only when main intentionally retargets the selection. The view
   *  applies selectedInstallationId over a local pick only when this advances,
   *  so a stale rebroadcast can't snap the user back to a prior row. */
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

// The popup is hidden, not unmounted, between opens, and every open bumps this epoch.
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
      // A restart that landed between two snapshots: same id, new session. Replaced rather than
      // mutated so the settings view's session watch sees a new value.
      sessionStore.runningInstances.set(id, { ...current, startedAt: startedAt[id] })
    }
  }
  // The snapshot is the only path that brings launching state in (the
  // popup preload has no onInstanceLaunching).
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
  openInstallNewWindow: (installationId: string, opts?: { allowDuplicate?: boolean }) => void
  openNewInstall: () => void
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
const { searchQuery, activeFilter, visibleInstalls, showEmptyHint, lastLaunchedShortLabel } =
  useInstallList({ installations: installationsRef })

const visibleChips = computed(() => {
  return FILTER_CHIPS.filter((chip) => {
    if (chip.key === 'all') return true
    const count = installations.value.filter((i) => {
      if (chip.key === 'local') {
        return i.sourceCategory === 'local'
      }
      return i.sourceCategory === chip.key
    }).length
    return count > 0
  })
})

/** Default selection when the popup opens with no active/selected install. */
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
  if (explicit) return explicit
  return mostRecentInstallId(snapshot.installs)
}
const selectedId = ref<string | null>(resolveInitialSelection(props.snapshot))
// Largest pickerSelectionEpoch applied so far; only a strictly-greater
// snapshot epoch counts as a main-authoritative retarget.
const appliedSelectionEpoch = ref<number>(props.snapshot.pickerSelectionEpoch ?? 0)

watch(
  () => props.snapshot.pickerSelectionEpoch ?? 0,
  (nextEpoch) => {
    if (nextEpoch <= appliedSelectionEpoch.value) return
    // Main intentionally retargeted; a fresh open overrides any local pick.
    appliedSelectionEpoch.value = nextEpoch
    selectedId.value = resolveInitialSelection(props.snapshot)
  }
)

// Cold-start fallback: seed selectedId once installs land if the snapshot
// first arrived empty. Once a selection exists, live install-list updates
// must not touch it (would reintroduce the snap-back).
watch(
  () => props.snapshot.installs,
  (installs) => {
    if (selectedId.value) return
    const id = mostRecentInstallId(installs)
    if (id) {
      selectedId.value = id
    }
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

const runningSet = computed(() => new Set(props.snapshot.runningInstallationIds))
// Optimistic local state set on click so the progress view appears before
// the IPC round-trip + snapshot lands; cleared once the snapshot confirms.
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

/** Must mirror the `showUpdateBadge` check in `ComfyUISettingsContent.vue`. */
function isRowUpdateAvailable(inst: Installation): boolean {
  const tagged = inst as Installation & { statusTag?: { style?: string }; status?: string }
  return tagged.statusTag?.style === 'update' || tagged.status === 'update-available'
}

function handleSelect(inst: Installation): void {
  selectedId.value = inst.id
}

// FLIP: pin a leaving row's box so it fades out of flow while the survivors
// slide up into the gap (mirrors ChooserView's `lockLeavingTileSize`).
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

function handleNewInstall(): void {
  bridge?.openNewInstall()
}

function handleClose(): void {
  bridge?.close?.()
}

const isInstallHost = computed(() => !!props.snapshot.activeInstallationId)

/** Routes through `new-window` rather than `return-to-dashboard`: the latter
 *  detaches the install, which stops the running instance. */
function handleOpenDashboard(): void {
  bridge?.activate?.('new-window')
}

watch(
  () => selectedInstall.value?.id ?? null,
  (next) => {
    bridge?.setPickerSelectedInstall(next)
  }
)

// On an install-less host the initial fallback selection never reaches main
// via the change-only watcher above, so persist it once on mount.
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

// Both lifecycle id arrays must be watched: the snapshot is the sole source
// of truth for sessionStore, and watching only runningInstallationIds would
// miss launching-only transitions. NUL-joined to avoid comma collisions.
watch(
  [
    () => props.snapshot.runningInstallationIds.join('\0'),
    () => (props.snapshot.launchingInstallationIds ?? []).join('\0'),
    // A restart between two snapshots changes only this.
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

  // opts.actionData may be a Vue reactive proxy, which can't cross the
  // contextBridge structured-clone boundary; deep-clone to a plain object.
  const rawActionData = opts.actionData
    ? (JSON.parse(JSON.stringify(opts.actionData)) as Record<string, unknown>)
    : undefined
  const { routing, successChoice } = resolveProgressRouting(
    opts,
    props.snapshot.activeInstallationId
  )
  if (routing === 'inline-picker') {
    // Seed optimistic local state so the progress view appears before the
    // IPC round-trip lands. Seed main's first-tick status for snapshot
    // restore so the line doesn't flash the "Working…" fallback.
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

// Single funnel for navigation decisions (primary CTA + caret). The decision is
// computed in `ComfyUISettingsContent` via `decideNavigation`; this routes its
// verb onto the bridge, applying the renderer-side gates.
const instanceActions = useInstanceActions({
  bridge,
  // Local restarts/switches confirm in-drawer (cloud/remote have no local
  // process to kill); keeps the drawer open instead of a system-modal over the
  // host. Non-local installs short-circuit to confirmed.
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
  },
  // In-drawer 3-way prompt (popup stays open) when the CURRENT host is a local
  // install — swapping would stop its process. Cloud/remote hosts have no local
  // process to stop → switch straight away.
  confirmSwitch: async (inst) => {
    const hostIsLocalInstall =
      props.snapshot.currentView === 'instance' && props.snapshot.currentCategory === 'local'
    if (!hostIsLocalInstall) return 'switch'
    const result = await dialogs.confirm({
      title: t('instancePicker.switchConfirmTitle'),
      message: t('instancePicker.switchConfirmMessage', { name: inst.name }),
      confirmLabel: t('instancePicker.switchConfirmAction'),
      secondaryLabel: t('instancePicker.switchConfirmSecondary'),
      cancelLabel: t('common.cancel'),
      showCancel: true,
      messageDetails: [
        {
          label: t('instancePicker.confirmHeadsUp'),
          items: [t('instancePicker.switchConfirmItem1'), t('instancePicker.switchConfirmItem2')]
        }
      ]
    })
    return result === 'primary' ? 'switch' : result === 'secondary' ? 'new-window' : 'cancel'
  }
})

async function handleExpandedNav(decision: NavDecision): Promise<void> {
  const inst = selectedInstall.value
  if (!inst) return
  await instanceActions.dispatch(decision, inst)
}
</script>

<template>
  <div class="picker flex size-full box-border flex-col bg-[var(--modal-surface-bg)]">
    <div
      class="picker-search flex items-center gap-1 border-b border-solid border-[var(--brand-surface-border-hover,var(--chooser-surface-border))] pt-1.5 pr-2 pb-2 pl-3 [&_.ui-input]:gap-2 [&_.ui-input]:rounded-none [&_.ui-input]:border-none [&_.ui-input]:bg-transparent [&_.ui-input]:p-0 [&_.ui-input:focus-within]:border-transparent [&_.ui-input-leading]:text-text [&_.ui-input-control]:px-0 [&_.ui-input-control]:pt-0.5 [&_.ui-input-control]:pb-0 [&_.ui-input-control]:text-[14px] [&_.ui-input-control]:leading-5 [&_.ui-input-control]:text-text [&_.ui-input-control::placeholder]:text-text [&_.ui-input-control::placeholder]:opacity-60"
    >
      <BaseInput
        v-model="searchQuery"
        class="picker-search-input min-w-0 flex-auto"
        :placeholder="$t('chooser.searchPlaceholder')"
        :aria-label="$t('chooser.searchPlaceholder')"
      >
        <template #leading
          ><Search :size="20" class="picker-search-icon mt-0.5 text-[var(--accent-label)]"
        /></template>
      </BaseInput>
      <button
        type="button"
        class="picker-close inline-flex size-7 flex-none items-center justify-center rounded-md border border-solid border-transparent bg-transparent p-0 text-text-muted cursor-pointer transition-[background-color,color,border-color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] hover:text-neutral-100 hover:outline-none focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:text-neutral-100 focus-visible:outline-none"
        :aria-label="$t('common.close')"
        :title="$t('common.close')"
        @click="handleClose"
      >
        <X :size="18" />
      </button>
    </div>

    <div
      class="picker-chips-row flex items-center gap-2 border-b border-solid border-[var(--brand-surface-border-hover,var(--chooser-surface-border))] px-4 pt-2 pb-2.5"
    >
      <template v-if="isInstallHost">
        <Tooltip :text="$t('instancePicker.openDashboardHint')" side="bottom">
          <button
            type="button"
            class="picker-home inline-flex h-[22px] flex-none items-center justify-center gap-1.5 border-none bg-transparent py-0 pr-1.5 pl-0.5 text-neutral-100 cursor-pointer transition-[color] duration-100 ease-[ease] hover:text-text hover:outline-none focus-visible:text-text focus-visible:outline-none"
            :aria-label="$t('instancePicker.openDashboard')"
            @click="handleOpenDashboard"
          >
            <LayoutDashboard :size="14" />
            <span class="picker-home-label text-[11px] leading-4 font-medium whitespace-nowrap">{{
              $t('instancePicker.openDashboard')
            }}</span>
          </button>
        </Tooltip>
        <span
          class="picker-chips-divider inline-block h-4 w-px flex-none bg-[var(--brand-surface-border-hover,var(--chooser-surface-border))]"
          aria-hidden="true"
        ></span>
      </template>
      <div
        class="picker-chips flex min-w-0 flex-wrap items-center gap-1.5"
        role="tablist"
        :aria-label="$t('chooser.filterLabel', 'Source filter')"
      >
        <button
          v-for="chip in visibleChips"
          :key="chip.key"
          type="button"
          role="tab"
          class="picker-chip inline-flex h-[22px] items-center rounded-lg border border-solid px-2.5 py-0.5 text-[11px] leading-4 font-medium cursor-pointer transition-[background-color,border-color,color] duration-100 ease-[ease] hover:outline-none focus-visible:outline-none"
          :class="
            activeFilter === chip.key
              ? 'is-active border-transparent bg-accent text-text'
              : 'border-border bg-transparent text-neutral-100 hover:bg-secondary hover:text-text focus-visible:text-text'
          "
          :aria-selected="activeFilter === chip.key"
          @click="activeFilter = chip.key"
        >
          {{ $t(chip.labelKey) }}
        </button>
      </div>
    </div>

    <div class="picker-body grid min-h-0 flex-[1_1_0] grid-cols-[280px_minmax(0,1fr)]">
      <div
        class="picker-left flex min-h-0 min-w-0 flex-col border-r border-solid border-[var(--chooser-surface-border)] bg-[var(--modal-surface-bg)]"
      >
        <div class="picker-list-section flex min-h-0 flex-auto flex-col overflow-hidden">
          <div
            class="picker-list-section-title mb-3.5 flex flex-none items-center pt-3 pr-[18px] pb-0 pl-4 text-[14px] leading-5 font-medium text-neutral-100 opacity-70"
          >
            {{ $t('instancePicker.instances')
            }}<InfoTooltip :text="$t('tooltips.instances')" side="bottom" />
          </div>

          <TransitionGroup
            tag="div"
            name="picker-row"
            enter-active-class="picker-row-enter-active [transition:opacity_200ms_ease,transform_200ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:duration-[1ms]"
            enter-from-class="picker-row-enter-from opacity-0 [transform:translateY(8px)_scale(0.98)] motion-reduce:transform-none"
            leave-active-class="picker-row-leave-active absolute [transition:opacity_140ms_ease,transform_140ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
            leave-to-class="picker-row-leave-to opacity-0 [transform:scale(0.98)] motion-reduce:transform-none"
            move-class="picker-row-move [transition:transform_220ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
            class="picker-list relative flex min-h-0 flex-auto flex-col gap-1 overflow-y-auto"
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
              {{ $t('chooser.noMatches') }}
            </div>
          </TransitionGroup>
        </div>

        <footer
          class="picker-left-footer flex shrink-0 items-center border-t border-solid border-[var(--chooser-surface-border)] bg-[var(--modal-surface-bg)] px-4 py-3"
        >
          <button
            type="button"
            class="picker-new-install inline-flex h-8 w-fit flex-none items-center justify-center gap-1 rounded-lg border-none bg-[var(--chooser-surface-border-hover)] px-3.5 py-2 text-[12px] leading-4 font-medium text-neutral-100 cursor-pointer transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-[var(--brand-surface-border-hover)] hover:text-text hover:outline-none focus-visible:bg-[var(--brand-surface-border-hover)] focus-visible:text-text focus-visible:outline-none"
            @click="handleNewInstall"
          >
            <Plus :size="16" />
            <span>{{ $t('instancePicker.newInstance') }}</span>
          </button>
        </footer>
      </div>

      <div class="picker-detail-wrap is-expanded flex min-h-0 min-w-0 overflow-hidden p-0">
        <div class="picker-detail relative flex min-h-0 min-w-0 flex-[1_1_0] flex-col gap-0">
          <template v-if="selectedInstall">
            <ComfyUISettingsContent
              :installation="selectedInstall"
              :initial-tab="initialExpandedTab"
              :auto-action="snapshot.autoAction ?? null"
              :auto-action-nonce="snapshot.autoActionNonce ?? 0"
              :global-settings-snapshot="snapshot.storage"
              :active-operation="activeOperation"
              :active-installation-id="snapshot.activeInstallationId"
              :current-view="snapshot.currentView ?? 'dashboard'"
              :current-category="snapshot.currentCategory ?? null"
              class="picker-expanded-body min-h-0 flex-auto [--text-muted:var(--neutral-100)]"
              @show-progress="handleSettingsShowProgress"
              @navigate-list="handleSettingsNavigateList"
              @request-close="handleSettingsNavigateList"
              @request-dismiss="handleClose"
              @primary-action="handleExpandedNav"
              @open-new-window="handleExpandedNav"
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
</template>
