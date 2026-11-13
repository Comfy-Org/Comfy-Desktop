<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import {
  Camera,
  ChevronRight,
  Download,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  Upload
} from 'lucide-vue-next'
import { TID } from '../../../../shared/testIds'
import { MSG_CANCELLED } from '../../../../shared/operationStatus'
import { useDialogs } from '../../composables/useDialogs'
import { useActionGuard } from '../../composables/useActionGuard'
import { emitTelemetryAction, toCountBucket } from '../../lib/telemetry'
import {
  diffHasChanges,
  formatDate,
  formatRelative as _formatRelative,
  getCachedSnapshotList,
  setCachedSnapshotList,
  triggerLabel
} from '../../lib/snapshots'
import type {
  ActionDef,
  CopyEvent,
  SnapshotDiffData,
  SnapshotListData,
  SnapshotSummary
} from '../../types/ipc'
import SnapshotRow from './SnapshotRow.vue'
import SnapshotDiffView from '../../components/SnapshotDiffView.vue'
import BaseAccordion from '../../components/ui/BaseAccordion.vue'
import OperationErrorDetail from '../../components/ui/OperationErrorDetail.vue'
import { humanizeOpStatus } from '../../lib/progressStatusLabel'

interface ActiveOperation {
  percent: number
  status: string
  done: boolean
  ok: boolean | null
  error: string | null
  actionId: string
  actionData?: Record<string, unknown>
}

interface Props {
  installationId: string
  activeOperation?: ActiveOperation | null
}

const props = withDefaults(defineProps<Props>(), { activeOperation: null })

const emit = defineEmits<{
  'run-action': [action: ActionDef]
  'refresh-all': []
  'op-cancel': []
  'op-retry': []
  'op-dismiss': []
}>()

const { t } = useI18n()
const dialogs = useDialogs()
const actionGuard = useActionGuard()

const listData = ref<SnapshotListData | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const snapshots = computed<SnapshotSummary[]>(() => listData.value?.snapshots ?? [])
const copyEvents = computed<CopyEvent[]>(() => listData.value?.copyEvents ?? [])

const restoreOp = computed<ActiveOperation | null>(() => {
  const op = props.activeOperation
  return op && op.actionId === 'snapshot-restore' ? op : null
})
const restoreOpFile = computed<string | null>(
  () => (restoreOp.value?.actionData as { file?: string } | undefined)?.file ?? null
)
const restoreOpIsImport = computed<boolean>(
  () => !!(restoreOp.value?.actionData as { restoreToken?: string } | undefined)?.restoreToken
)
const restoreInFlight = computed<boolean>(() => !!restoreOp.value && !restoreOp.value.done)
const restorePhase = computed<string>(() => {
  const op = restoreOp.value
  if (!op || op.done) return ''
  return humanizeOpStatus(op.status, t)
})
const restorePercent = computed<number | null>(() => {
  const p = restoreOp.value?.percent ?? -1
  return p < 0 ? null : Math.max(0, Math.min(100, p))
})
const restoreCancellable = computed<boolean>(
  () =>
    !!restoreOp.value &&
    !restoreOp.value.done &&
    ((restoreOp.value as ActiveOperation & { cancellable?: boolean }).cancellable ?? false)
)

const restoreFromLabel = computed<string>(() => {
  const file = restoreOpFile.value
  if (!file) return restoreOpIsImport.value ? t('snapshots.importedSnapshot') : ''
  const target = snapshots.value.find((s) => s.filename === file)
  if (target) {
    const trigger = triggerLabel(target.trigger, t)
    const when = _formatRelative(target.createdAt, t)
    return target.label ? `${target.label} · ${when}` : `${trigger} · ${when}`
  }
  return file
})

const restoreTerminal = ref<'ok' | 'error' | 'cancelled' | null>(null)
const restoreErrorMessage = ref<string>('')
let restoreOkTimer: ReturnType<typeof setTimeout> | null = null
function clearRestoreTerminal(): void {
  if (restoreOkTimer !== null) {
    clearTimeout(restoreOkTimer)
    restoreOkTimer = null
  }
  restoreTerminal.value = null
  restoreErrorMessage.value = ''
}
function dismissRestoreCard(): void {
  clearRestoreTerminal()
  emit('op-dismiss')
}
function cancelRestore(): void {
  emit('op-cancel')
}
function retryRestore(): void {
  clearRestoreTerminal()
  emit('op-retry')
}
watch(
  restoreOp,
  (op, prev) => {
    if (!op) return
    if (!op.done || (prev && prev.done)) return
    if (op.ok) {
      clearRestoreTerminal()
      restoreTerminal.value = 'ok'
      restoreOkTimer = setTimeout(() => {
        restoreTerminal.value = null
        restoreOkTimer = null
        void load()
        emit('refresh-all')
        emit('op-dismiss')
      }, 1800)
    } else if (op.error === MSG_CANCELLED) {
      clearRestoreTerminal()
      if (restoreOpIsImport.value) restoreTerminal.value = 'cancelled'
      else emit('op-dismiss')
    } else {
      clearRestoreTerminal()
      restoreTerminal.value = 'error'
      restoreErrorMessage.value = op.error ?? ''
    }
  },
  { immediate: true }
)
onUnmounted(() => {
  clearRestoreTerminal()
  unsubChanges?.()
  if (reloadTimer) clearTimeout(reloadTimer)
})

const showRestoreCard = computed<boolean>(
  () => restoreInFlight.value || restoreTerminal.value !== null
)

const topCardRef = ref<HTMLElement | null>(null)
watch(restoreInFlight, (yes) => {
  if (!yes) return
  closeRowMenu()
  void nextTick(() => {
    topCardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
})

type TimelineItem =
  | { kind: 'snapshot'; snapshot: SnapshotSummary; snapshotIndex: number }
  | { kind: 'copy'; event: CopyEvent }

const timeline = computed<TimelineItem[]>(() => {
  const out: TimelineItem[] = []
  let si = 0
  let ci = 0
  const snaps = snapshots.value
  const copies = [...copyEvents.value].sort(
    (a, b) => new Date(b.copiedAt).getTime() - new Date(a.copiedAt).getTime()
  )
  while (si < snaps.length || ci < copies.length) {
    const snapTime = si < snaps.length ? new Date(snaps[si]!.createdAt).getTime() : -Infinity
    const copyTime = ci < copies.length ? new Date(copies[ci]!.copiedAt).getTime() : -Infinity
    if (snapTime >= copyTime) {
      out.push({ kind: 'snapshot', snapshot: snaps[si]!, snapshotIndex: si })
      si++
    } else {
      out.push({ kind: 'copy', event: copies[ci]! })
      ci++
    }
  }
  return out
})

const latestRelative = computed<string | null>(() => {
  const newest = snapshots.value[0]
  if (!newest) return null
  return _formatRelative(newest.createdAt, t)
})

function autoExpandFirst(): void {
  if (expandedFilenames.value.size > 0) return
  const newest = snapshots.value[0]
  if (newest) {
    expandedFilenames.value = new Set([newest.filename])
  }
}

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  loadError.value = null
  try {
    const data = await window.api.getSnapshots(props.installationId)
    listData.value = data
    setCachedSnapshotList(props.installationId, data)
  } catch (err: unknown) {
    if (!silent) {
      loadError.value = (err as Error)?.message ?? String(err)
      listData.value = null
    }
    console.error('SnapshotsView.load failed', err)
  } finally {
    if (!silent) loading.value = false
    if (!silent) autoExpandFirst()
  }
}

let unsubChanges: (() => void) | undefined
let reloadTimer: ReturnType<typeof setTimeout> | null = null
function scheduleReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    void load(true)
  }, 250)
}
onMounted(() => {
  const onChanged = (window.api as { onInstallationsChanged?: (cb: () => void) => () => void })
    .onInstallationsChanged
  if (typeof onChanged === 'function') {
    unsubChanges = onChanged(() => scheduleReload())
  }
})

const expandedFilenames = ref<Set<string>>(new Set())
const openMenuFilename = ref<string | null>(null)
function closeRowMenu(): void {
  openMenuFilename.value = null
}
function onRowMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  closeRowMenu()
}
onMounted(() => window.addEventListener('blur', closeRowMenu))
onUnmounted(() => window.removeEventListener('blur', closeRowMenu))

type DiffMode = 'previous' | 'current'
const diffCache = ref<Map<string, SnapshotDiffData | null>>(new Map())
const openDiffs = ref<Set<string>>(new Set())
const diffLoading = ref<Set<string>>(new Set())
const dkey = (filename: string, mode: DiffMode): string => `${filename}|${mode}`

function isExpanded(filename: string): boolean {
  return expandedFilenames.value.has(filename)
}

function toggleExpand(filename: string): void {
  const next = new Set(expandedFilenames.value)
  if (next.has(filename)) {
    next.delete(filename)
  } else {
    next.add(filename)
  }
  expandedFilenames.value = next
}

function diffModesFor(snapshotIndex: number): DiffMode[] {
  const modes: DiffMode[] = []
  if (snapshotIndex < snapshots.value.length - 1) modes.push('previous')
  if (snapshotIndex !== 0) modes.push('current')
  return modes
}

function isDiffOpen(filename: string, mode: DiffMode): boolean {
  return openDiffs.value.has(dkey(filename, mode))
}
function isDiffLoading(filename: string, mode: DiffMode): boolean {
  return diffLoading.value.has(dkey(filename, mode))
}
function diffFor(filename: string, mode: DiffMode): SnapshotDiffData | null | undefined {
  return diffCache.value.get(dkey(filename, mode))
}

async function toggleDiff(filename: string, mode: DiffMode): Promise<void> {
  const key = dkey(filename, mode)
  if (openDiffs.value.has(key)) {
    const next = new Set(openDiffs.value)
    next.delete(key)
    openDiffs.value = next
    return
  }
  const opened = new Set(openDiffs.value)
  opened.add(key)
  openDiffs.value = opened
  if (diffCache.value.has(key)) return
  diffLoading.value = new Set(diffLoading.value).add(key)
  try {
    const d = await window.api.getSnapshotDiff(props.installationId, filename, mode)
    diffCache.value = new Map(diffCache.value).set(key, d)
    emitTelemetryAction('comfy.desktop.snapshot.flow', {
      action: 'view_diff',
      snapshot_count_bucket: toCountBucket(snapshots.value.length),
      has_diff: d ? diffHasChanges(d.diff) : undefined
    })
  } finally {
    const next = new Set(diffLoading.value)
    next.delete(key)
    diffLoading.value = next
  }
}

watch(
  () => props.installationId,
  (id) => {
    expandedFilenames.value = new Set()
    diffCache.value = new Map()
    openDiffs.value = new Set()
    diffLoading.value = new Set()
    const cached = getCachedSnapshotList(id)
    if (cached) {
      listData.value = cached
      loading.value = false
      loadError.value = null
      autoExpandFirst()
      void load(true)
    } else {
      void load()
    }
  },
  { immediate: true }
)

async function handleSave(): Promise<void> {
  const label = await dialogs.prompt({
    title: t('standalone.snapshotCreateTitle'),
    message: t('standalone.snapshotCreateMessage'),
    placeholder: t('standalone.snapshotLabelPlaceholder'),
    confirmLabel: t('snapshots.createSnapshot'),
    required: false
  })
  if (label === null) return
  try {
    await window.api.runAction(props.installationId, 'snapshot-save', {
      label: label || undefined
    })
  } catch (err: unknown) {
    await dialogs.alert({
      title: t('snapshots.saveErrorTitle'),
      message: (err as Error).message || String(err),
      tone: 'danger'
    })
    return
  }
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'save',
    snapshot_count_bucket: toCountBucket(snapshots.value.length)
  })
  expandedFilenames.value = new Set()
  await load()
  emit('refresh-all')
}

async function handleRestore(filename: string): Promise<void> {
  let diff: SnapshotDiffData | null
  try {
    diff = await window.api.getSnapshotDiff(props.installationId, filename, 'current')
  } catch {
    diff = null
  }
  const hasChanges = diff ? diffHasChanges(diff.diff) : undefined

  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'restore_complete',
    snapshot_count_bucket: toCountBucket(snapshots.value.length),
    has_diff: hasChanges
  })

  emit('run-action', {
    id: 'snapshot-restore',
    label: t('standalone.snapshotRestore'),
    data: { file: filename },
    showProgress: true,
    progressTitle: t('standalone.snapshotRestoringTitle'),
    cancellable: true,
    style: 'primary',
    confirm: {
      title: t('snapshots.restoreConfirmTitle'),
      message: t('snapshots.restoreConfirmMessage'),
      restoreDiff: diff?.diff ?? null,
      confirmLabel: t('standalone.snapshotRestore')
    }
  })
}

async function handleDelete(filename: string): Promise<void> {
  const target = snapshots.value.find((s) => s.filename === filename)
  const displayName = target?.label || target?.filename || ''
  const result = await dialogs.confirm({
    title: displayName
      ? t('snapshots.deleteConfirmNamed', { name: displayName })
      : t('snapshots.deleteConfirm'),
    message: t('snapshots.deleteConfirmMessage'),
    confirmLabel: t('snapshots.delete'),
    tone: 'danger'
  })
  if (result !== 'primary') return
  try {
    await window.api.runAction(props.installationId, 'snapshot-delete', { file: filename })
  } catch (err: unknown) {
    await dialogs.alert({
      title: t('snapshots.deleteErrorTitle'),
      message: (err as Error).message || String(err),
      tone: 'danger'
    })
    return
  }
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'delete',
    snapshot_count_bucket: toCountBucket(snapshots.value.length)
  })
  if (expandedFilenames.value.has(filename)) {
    const next = new Set(expandedFilenames.value)
    next.delete(filename)
    expandedFilenames.value = next
  }
  await load()
  emit('refresh-all')
}

async function handleExport(filename: string): Promise<void> {
  await window.api.exportSnapshot(props.installationId, filename)
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'export_one',
    snapshot_count_bucket: toCountBucket(snapshots.value.length)
  })
}

async function handleExportAll(): Promise<void> {
  await window.api.exportAllSnapshots(props.installationId)
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'export_all',
    snapshot_count_bucket: toCountBucket(snapshots.value.length)
  })
}

async function handleImport(): Promise<void> {
  const preview = await window.api.importSnapshotsPreview()
  if (!preview.ok) {
    if (preview.message) {
      await dialogs.alert({
        title: t('snapshots.importErrorTitle'),
        message: preview.message,
        tone: 'danger'
      })
    }
    return
  }
  const previewItems = preview.preview?.snapshots ?? []
  const previewLines = previewItems.map(
    (p) => `${p.label || p.filename} (${formatDate(p.createdAt)})`
  )
  const importChoice = await dialogs.confirm({
    title: t('snapshots.importConfirmTitle'),
    message: t('snapshots.importConfirmMessage'),
    messageDetails:
      previewLines.length > 0
        ? [{ label: t('snapshots.importPreviewLabel'), items: previewLines }]
        : undefined,
    confirmLabel: t('snapshots.importConfirmLabel'),
    tone: 'primary'
  })
  if (importChoice !== 'primary') return

  const diff = await window.api.importSnapshotsDiff(props.installationId)
  if (!diff.ok) {
    if (diff.message) {
      await dialogs.alert({
        title: t('snapshots.importErrorTitle'),
        message: diff.message,
        tone: 'danger'
      })
    }
    return
  }

  if (!(await actionGuard.checkBeforeAction(props.installationId, t('snapshots.importSnapshots'))))
    return
  const importResult = await window.api.importSnapshotsConfirm(props.installationId)
  if (!importResult.ok) {
    if (importResult.message) {
      await dialogs.alert({
        title: t('snapshots.importErrorTitle'),
        message: importResult.message,
        tone: 'danger'
      })
    }
    return
  }
  if (importResult.torchStackNotice) {
    const noticeChoice = await dialogs.confirm({
      title: t('snapshots.importTorchNoticeTitle'),
      message: importResult.torchStackNotice,
      confirmLabel: t('standalone.snapshotRestore'),
      tone: 'primary'
    })
    if (noticeChoice !== 'primary') return
  }

  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'import',
    snapshot_count_bucket: toCountBucket(snapshots.value.length),
    imported_bucket: toCountBucket(importResult.imported ?? 0)
  })

  if (importResult.restoreToken) {
    emit('run-action', {
      id: 'snapshot-restore',
      label: t('standalone.snapshotRestore'),
      data: { restoreToken: importResult.restoreToken },
      showProgress: true,
      progressTitle: t('standalone.snapshotRestoringTitle'),
      cancellable: true,
      style: 'primary'
    })
  }
}
</script>

<template>
  <div class="snapshots-view flex flex-col gap-3">
    <header class="snapshots-view-header flex items-center justify-between gap-3">
      <span
        class="snapshots-view-latest text-[13px] leading-4 text-[var(--color-subtle-foreground)]"
      >
        <template v-if="latestRelative">
          {{ t('snapshots.latestLabel') }}
          {{ latestRelative }}
        </template>
        <template v-else>
          {{ t('snapshots.noneYet') }}
        </template>
      </span>
      <div class="snapshots-view-toolbar inline-flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="textonly"
          size="md"
          class="snapshots-view-toolbtn gap-1.5 px-2.5"
          :aria-label="t('snapshots.importSnapshots')"
          :data-testid="TID.snapshotsImport"
          @click="handleImport"
        >
          <Upload :size="14" aria-hidden="true" />
          <span>{{ t('snapshots.importSnapshots') }}</span>
        </Button>
        <Button
          type="button"
          variant="textonly"
          size="md"
          class="snapshots-view-toolbtn gap-1.5 px-2.5"
          :disabled="snapshots.length === 0"
          :aria-label="t('snapshots.exportAllSnapshots')"
          :data-testid="TID.snapshotsExportAll"
          @click="handleExportAll"
        >
          <Download :size="14" aria-hidden="true" />
          <span>{{ t('snapshots.exportAllSnapshots') }}</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="snapshots-view-toolbtn gap-1.5 px-3"
          :disabled="showRestoreCard"
          :aria-label="t('snapshots.createSnapshot')"
          :data-testid="TID.snapshotsSaveCta"
          @click="handleSave"
        >
          <Camera :size="14" aria-hidden="true" />
          <span>{{ t('snapshots.createSnapshot') }}</span>
        </Button>
      </div>
    </header>

    <div class="snapshots-panel flex flex-col rounded-[14px] bg-card p-1.5">
      <div
        v-if="showRestoreCard"
        ref="topCardRef"
        class="snapshots-rail-node is-save mb-1"
        :class="{
          'is-op-inflight': restoreInFlight,
          'is-op-success': restoreTerminal === 'ok',
          'is-op-error': restoreTerminal === 'error'
        }"
      >
        <div
          class="snapshots-rail-save-box flex flex-col gap-3 rounded-[10px] px-4 py-3.5"
          :class="[
            restoreTerminal === 'ok'
              ? 'is-op-success bg-[color-mix(in_oklch,var(--success)_11%,transparent)]'
              : restoreTerminal === 'error'
                ? 'is-op-error bg-[color-mix(in_oklch,var(--danger)_11%,transparent)]'
                : 'bg-[color-mix(in_oklch,var(--color-foreground)_5%,transparent)]',
            { 'is-op-inflight': restoreInFlight }
          ]"
        >
          <div class="snapshots-rail-head flex items-center gap-2.5">
            <span
              class="snapshots-rail-dot size-3 shrink-0 rounded-full"
              :class="
                restoreInFlight
                  ? 'is-spinning border-2 border-solid border-[color-mix(in_oklch,var(--color-foreground)_14%,transparent)] bg-[conic-gradient(var(--neutral-100)_270deg,transparent_270deg)] animate-spin [animation-duration:0.8s]'
                  : restoreTerminal === 'ok'
                    ? 'is-restored bg-[var(--success)]'
                    : restoreTerminal === 'error'
                      ? 'is-error bg-[var(--danger)]'
                      : 'bg-text-muted'
              "
              :aria-hidden="true"
            ></span>
            <span class="snapshots-rail-label text-[13px] font-medium text-neutral-100">
              <template v-if="restoreInFlight">{{ t('snapshots.restoringStatus') }}</template>
              <template v-else-if="restoreTerminal === 'ok'">{{
                t('snapshots.restored')
              }}</template>
              <template v-else-if="restoreTerminal === 'error'">{{
                t('snapshots.restoreFailed')
              }}</template>
              <template v-else-if="restoreTerminal === 'cancelled'">{{
                t('snapshots.restoreCancelled')
              }}</template>
            </span>
          </div>

          <div
            v-if="restoreInFlight"
            class="snapshots-op-card flex flex-col gap-2.5"
            role="status"
            aria-live="polite"
            :data-testid="TID.snapshotsOpCard"
          >
            <p
              v-if="restoreFromLabel"
              class="snapshots-op-card-target m-0 text-[12px] text-text-muted"
            >
              {{ t('snapshots.restoringFrom', { label: restoreFromLabel }) }}
            </p>
            <div
              class="snapshots-op-bar-wrap flex flex-col gap-1.5"
              role="progressbar"
              :aria-valuenow="restorePercent ?? undefined"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div class="snapshots-op-bar-header flex items-center justify-between text-[12px]">
                <span class="snapshots-op-bar-status text-neutral-100">{{ restorePhase }}</span>
                <span
                  v-if="restorePercent !== null"
                  class="snapshots-op-bar-pct text-text-muted tabular-nums"
                >
                  {{ restorePercent }}%
                </span>
              </div>
              <div
                class="snapshots-op-bar-track relative h-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--color-foreground)_10%,transparent)]"
              >
                <div
                  class="snapshots-op-bar-fill h-full rounded-full bg-neutral-100 transition-[width] duration-[120ms] ease-[ease]"
                  :class="{
                    'is-indeterminate w-[40%] animate-[snapshots-op-bar-indet_1.2s_ease-in-out_infinite]':
                      restorePercent === null
                  }"
                  :style="restorePercent === null ? {} : { width: `${restorePercent}%` }"
                />
              </div>
            </div>
            <div v-if="restoreCancellable" class="snapshots-op-actions flex gap-2">
              <Button
                type="button"
                variant="textonly"
                size="md"
                class="snapshots-op-ghost-btn px-3"
                :data-testid="TID.snapshotsOpCardCancel"
                @click="cancelRestore"
              >
                {{ t('common.cancel') }}
              </Button>
            </div>
          </div>

          <div
            v-else-if="restoreTerminal === 'ok'"
            class="snapshots-op-card is-success flex flex-col gap-2.5"
            role="status"
            :data-testid="TID.snapshotsOpCard"
          >
            <p
              v-if="restoreOpIsImport"
              class="snapshots-op-card-target m-0 text-[12px] text-text-muted"
            >
              {{ t('snapshots.restoredImported') }}
            </p>
            <p
              v-else-if="restoreFromLabel"
              class="snapshots-op-card-target m-0 text-[12px] text-text-muted"
            >
              {{ t('snapshots.restoredFrom', { label: restoreFromLabel }) }}
            </p>
          </div>

          <div
            v-else-if="restoreTerminal === 'error' || restoreTerminal === 'cancelled'"
            class="snapshots-op-card flex flex-col gap-2.5"
            :class="{ 'is-error': restoreTerminal === 'error' }"
            :role="restoreTerminal === 'error' ? 'alert' : 'status'"
            :data-testid="TID.snapshotsOpCard"
          >
            <OperationErrorDetail
              v-if="restoreTerminal === 'error' && restoreErrorMessage"
              :error="restoreErrorMessage"
            />
            <p
              v-else-if="restoreTerminal === 'cancelled'"
              class="snapshots-op-card-target m-0 text-[12px] text-text-muted"
            >
              {{ t('snapshots.restoreCancelledBody') }}
            </p>
            <div class="snapshots-op-actions flex gap-2">
              <Button
                type="button"
                variant="inverted"
                size="md"
                class="snapshots-op-primary-btn px-3"
                :data-testid="TID.snapshotsOpCardRetry"
                @click="retryRestore"
              >
                {{ t('snapshots.tryAgain') }}
              </Button>
              <Button
                type="button"
                variant="textonly"
                size="md"
                class="snapshots-op-ghost-btn px-3"
                :data-testid="TID.snapshotsOpCardDismiss"
                @click="dismissRestoreCard"
              >
                {{ t('common.dismiss') }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <p
        v-if="loading && timeline.length === 0"
        class="snapshots-view-status m-0 px-3 py-3 text-[13px] text-text-muted"
      >
        {{ t('common.loading') }}
      </p>
      <div
        v-else-if="loadError"
        class="snapshots-view-status is-error m-0 flex flex-col items-start gap-2 px-3 py-3 text-[13px] text-danger [&_p]:m-0"
      >
        <p>{{ loadError }}</p>
        <Button type="button" variant="secondary" size="md" class="px-3" @click="load()">
          {{ t('common.retry') }}
        </Button>
      </div>
      <div
        v-else-if="timeline.length === 0 && !showRestoreCard"
        class="snapshots-view-empty flex flex-col items-center gap-3 px-6 py-10 text-center"
      >
        <span
          class="inline-flex size-10 items-center justify-center rounded-[10px] bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)] text-text-muted"
          aria-hidden="true"
        >
          <Camera :size="18" />
        </span>
        <p class="m-0 max-w-[340px] text-[13px] text-text-muted">{{ t('snapshots.empty') }}</p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="gap-1.5 px-3"
          @click="handleSave"
        >
          <Camera :size="14" aria-hidden="true" />
          <span>{{ t('snapshots.createSnapshot') }}</span>
        </Button>
      </div>

      <ul
        v-if="timeline.length > 0"
        class="snapshots-rail relative m-0 flex list-none flex-col p-0"
      >
        <li
          v-for="(item, i) in timeline"
          :key="item.kind === 'snapshot' ? `s-${item.snapshot.filename}` : `c-${i}`"
          class="snapshots-rail-node relative before:pointer-events-none before:absolute before:top-0 before:bottom-0 before:left-[106px] before:w-px before:bg-[color-mix(in_oklch,var(--color-foreground)_13%,transparent)] before:content-[''] first:before:top-[22px] last:before:bottom-[calc(100%-22px)]"
          :class="{
            'is-snapshot': item.kind === 'snapshot',
            'is-copy': item.kind === 'copy'
          }"
        >
          <span
            class="snapshots-rail-dot pointer-events-none absolute top-[22px] left-[106.5px] z-[1] -translate-x-1/2 -translate-y-1/2 rounded-full"
            :class="
              item.kind === 'copy'
                ? 'is-muted size-[7px] bg-[color-mix(in_oklch,var(--color-foreground)_28%,var(--color-content-background))]'
                : item.snapshotIndex === 0
                  ? [
                      'is-latest size-[11px]',
                      item.snapshot.trigger === 'post-update' ||
                      item.snapshot.trigger === 'post-restore'
                        ? 'is-state bg-neutral-100'
                        : 'bg-text-muted'
                    ]
                  : item.snapshot.trigger === 'post-update' ||
                      item.snapshot.trigger === 'post-restore'
                    ? 'is-state size-[9px] border-2 border-solid border-neutral-100 bg-[color-mix(in_oklch,var(--color-foreground)_3.5%,var(--color-content-background))]'
                    : 'size-[9px] border-2 border-solid border-[color-mix(in_oklch,var(--color-foreground)_32%,var(--color-content-background))] bg-[color-mix(in_oklch,var(--color-foreground)_3.5%,var(--color-content-background))]'
            "
            :aria-hidden="true"
          ></span>
          <SnapshotRow
            v-if="item.kind === 'snapshot'"
            :snapshot="item.snapshot"
            :expanded="isExpanded(item.snapshot.filename)"
            :is-latest="item.snapshotIndex === 0"
            :previous-comfyui-version="snapshots[item.snapshotIndex + 1]?.comfyuiVersion"
            :toggle-test-id="TID.snapshotRow(item.snapshot.filename)"
            @toggle="toggleExpand(item.snapshot.filename)"
          >
            <template #actions>
              <Button
                v-if="item.snapshotIndex !== 0"
                type="button"
                variant="textonly"
                size="md"
                class="snapshot-row-restore gap-1.5 px-2.5"
                :aria-label="t('snapshots.restore')"
                :data-testid="TID.snapshotRowRestore(item.snapshot.filename)"
                :disabled="restoreInFlight"
                @click="handleRestore(item.snapshot.filename)"
              >
                <RotateCcw :size="13" aria-hidden="true" />
                <span>{{ t('snapshots.restore') }}</span>
              </Button>
              <Menu
                :open="openMenuFilename === item.snapshot.filename"
                :modal="false"
                align="end"
                :side-offset="4"
                class="snapshot-row-menu z-[9999] min-w-[160px]"
                @update:open="
                  (isOpen: boolean) => (openMenuFilename = isOpen ? item.snapshot.filename : null)
                "
                @keydown.capture="onRowMenuKeydown"
              >
                <template #trigger>
                  <Button
                    type="button"
                    variant="textonly"
                    size="icon"
                    class="snapshot-row-more text-text-muted hover:text-neutral-100"
                    :aria-label="t('snapshots.moreActions')"
                    :disabled="restoreInFlight"
                    :data-testid="TID.snapshotRowMore(item.snapshot.filename)"
                  >
                    <MoreHorizontal :size="15" aria-hidden="true" />
                  </Button>
                </template>
                <MenuItem
                  as="button"
                  type="button"
                  class="w-full justify-start gap-2 text-left"
                  :disabled="restoreInFlight"
                  :data-testid="TID.snapshotRowExport(item.snapshot.filename)"
                  @select="handleExport(item.snapshot.filename)"
                >
                  <Download :size="14" aria-hidden="true" />
                  <span>{{ t('snapshots.exportSnapshot') }}</span>
                </MenuItem>
                <MenuItem
                  as="button"
                  type="button"
                  class="snapshot-row-delete w-full justify-start gap-2 text-left text-destructive"
                  :disabled="restoreInFlight"
                  :data-testid="TID.snapshotRowDelete(item.snapshot.filename)"
                  @select="handleDelete(item.snapshot.filename)"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                  <span>{{ t('snapshots.delete') }}</span>
                </MenuItem>
              </Menu>
            </template>

            <template v-if="item.snapshot.label" #meta>
              <span class="snapshot-row-meta-dot" aria-hidden="true">·</span>
              <span class="snapshots-view-label text-neutral-100">{{ item.snapshot.label }}</span>
            </template>

            <template #expanded>
              <div
                v-for="mode in diffModesFor(item.snapshotIndex)"
                :key="mode"
                class="snap-diff-accordion flex flex-col"
              >
                <Button
                  type="button"
                  variant="textonly"
                  size="unset"
                  class="snap-diff-trigger static inline-flex items-center justify-normal gap-1.5 self-start rounded-md border-none bg-transparent py-0.5 pr-1 pl-0 text-[12px] leading-[1.5] font-semibold text-neutral-100 whitespace-normal appearance-auto hover:bg-transparent hover:text-[var(--color-foreground)] focus-visible:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] focus-visible:ring-0"
                  :class="{ 'is-open': isDiffOpen(item.snapshot.filename, mode) }"
                  :aria-expanded="isDiffOpen(item.snapshot.filename, mode)"
                  @click="toggleDiff(item.snapshot.filename, mode)"
                >
                  <ChevronRight
                    :size="13"
                    class="snap-diff-chevron text-[var(--color-subtle-foreground)] transition-transform duration-150 ease-[ease]"
                    :class="{ 'rotate-90': isDiffOpen(item.snapshot.filename, mode) }"
                  />
                  <span>{{
                    mode === 'previous'
                      ? t('snapshots.changesInSnapshot')
                      : t('snapshots.ifYouRestore')
                  }}</span>
                </Button>
                <BaseAccordion :open="isDiffOpen(item.snapshot.filename, mode)">
                  <div
                    class="snapshots-view-diff mt-1.5 max-h-[280px] overflow-y-auto rounded-[10px] bg-[color-mix(in_oklch,var(--color-foreground)_4%,transparent)] px-3.5 py-3"
                  >
                    <div
                      v-if="isDiffLoading(item.snapshot.filename, mode)"
                      class="snapshots-view-diff-loading text-[12px] text-text-muted"
                    >
                      {{ t('common.loading') }}
                    </div>
                    <template v-else-if="diffFor(item.snapshot.filename, mode) !== undefined">
                      <div
                        v-if="
                          !diffFor(item.snapshot.filename, mode) ||
                          !diffHasChanges(diffFor(item.snapshot.filename, mode)!.diff)
                        "
                        class="snapshots-view-diff-empty text-[12px] text-text-muted"
                      >
                        {{
                          mode === 'previous'
                            ? t('snapshots.diffNoChanges')
                            : t('snapshots.restoreNoChanges')
                        }}
                      </div>
                      <SnapshotDiffView
                        v-else
                        :diff="diffFor(item.snapshot.filename, mode)!.diff"
                      />
                    </template>
                  </div>
                </BaseAccordion>
              </div>
            </template>
          </SnapshotRow>
          <div
            v-else
            class="snapshots-view-copy-event flex min-h-11 items-center gap-2.5 rounded-[10px] pr-1.5 pl-2.5 text-[12px] text-[var(--color-subtle-foreground)]"
          >
            <span
              class="snapshots-view-copy-time w-[76px] shrink-0 truncate"
              :title="formatDate(item.event.copiedAt)"
              >{{ _formatRelative(item.event.copiedAt, t) }}</span
            >
            <span class="w-5 shrink-0" aria-hidden="true"></span>
            <span class="snapshots-view-copy-icon w-3.5 shrink-0 text-center" :aria-hidden="true">{{
              item.event.direction === 'in' ? '←' : '→'
            }}</span>
            <span class="snapshots-view-copy-label min-w-0 flex-1 truncate">
              {{
                item.event.direction === 'in'
                  ? t('snapshots.copyEventLabelIncoming', {
                      source: item.event.installationName || item.event.installationId
                    })
                  : t('snapshots.copyEventLabel', {
                      destination: item.event.installationName || item.event.installationId
                    })
              }}
            </span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style>
@keyframes snapshots-op-bar-indet {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
</style>
