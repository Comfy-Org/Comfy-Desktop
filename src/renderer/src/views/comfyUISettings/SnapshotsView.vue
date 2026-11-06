<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ChevronDown, Download, RotateCcw, Trash2, Upload } from 'lucide-vue-next'
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

const railNodeClass =
  "relative min-h-3 pl-6 before:absolute before:top-3 before:left-[5px] before:z-0 before:h-[calc(100%+12px)] before:w-0.5 before:rounded-[1px] before:bg-[var(--border)] before:content-[''] last:before:hidden"
const toolButtonClass =
  'snapshots-view-toolbtn static inline-flex min-h-7 items-center justify-normal gap-[5px] rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-3 py-1.5 text-[12px] leading-[1.5] font-medium text-neutral-100 whitespace-normal appearance-auto transition-[background-color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--brand-surface-bg)]'
const detailButtonClass =
  'snapshots-view-detail-btn static inline-flex min-h-8 items-center justify-normal gap-[5px] rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-4 py-2 text-[12px] leading-[1.5] font-medium whitespace-normal appearance-auto transition-[background-color,border-color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50'

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
    label: t('standalone.snapshotRestore', 'Restore'),
    data: { file: filename },
    showProgress: true,
    progressTitle: t('standalone.snapshotRestoringTitle', 'Restoring snapshot'),
    cancellable: true,
    style: 'primary',
    confirm: {
      title: t('snapshots.restoreConfirmTitle'),
      message: t('snapshots.restoreConfirmMessage'),
      restoreDiff: diff?.diff ?? null,
      confirmLabel: t('standalone.snapshotRestore', 'Restore')
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

  if (
    !(await actionGuard.checkBeforeAction(
      props.installationId,
      t('snapshots.importSnapshots', 'Import Snapshots')
    ))
  )
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
      title: t('snapshots.importTorchNoticeTitle', 'Snapshot uses a different PyTorch'),
      message: importResult.torchStackNotice,
      confirmLabel: t('standalone.snapshotRestore', 'Restore'),
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
      label: t('standalone.snapshotRestore', 'Restore'),
      data: { restoreToken: importResult.restoreToken },
      showProgress: true,
      progressTitle: t('standalone.snapshotRestoringTitle', 'Restoring snapshot'),
      cancellable: true,
      style: 'primary'
    })
  }
}
</script>

<template>
  <div class="snapshots-view flex flex-col gap-4">
    <header class="snapshots-view-header flex items-center justify-between gap-3">
      <span class="snapshots-view-latest text-[12px] leading-4 text-text-muted">
        <template v-if="latestRelative">
          {{ t('snapshots.latestLabel') }}
          {{ latestRelative }}
        </template>
        <template v-else>
          {{ t('snapshots.noneYet') }}
        </template>
      </span>
      <div class="snapshots-view-toolbar inline-flex flex-wrap gap-2">
        <Button
          type="button"
          variant="textonly"
          size="unset"
          :class="toolButtonClass"
          :aria-label="t('snapshots.importSnapshots', 'Import')"
          :data-testid="TID.snapshotsImport"
          @click="handleImport"
        >
          <Upload :size="14" aria-hidden="true" />
          <span>{{ t('snapshots.importSnapshots', 'Import') }}</span>
        </Button>
        <Button
          type="button"
          variant="textonly"
          size="unset"
          :class="toolButtonClass"
          :disabled="snapshots.length === 0"
          :aria-label="t('snapshots.exportAllSnapshots')"
          :data-testid="TID.snapshotsExportAll"
          @click="handleExportAll"
        >
          <Download :size="14" aria-hidden="true" />
          <span>{{ t('snapshots.exportAllSnapshots') }}</span>
        </Button>
      </div>
    </header>

    <p
      v-if="loading"
      class="snapshots-view-status m-0 text-[length:var(--takeover-fs-body)] text-text-muted"
    >
      {{ t('common.loading', 'Loading…') }}
    </p>
    <div
      v-else-if="loadError"
      class="snapshots-view-status is-error m-0 flex flex-col items-start gap-2 text-[length:var(--takeover-fs-body)] text-danger [&_p]:m-0"
    >
      <p>{{ loadError }}</p>
      <Button
        type="button"
        variant="textonly"
        size="unset"
        :class="toolButtonClass"
        @click="load()"
      >
        {{ t('common.retry') }}
      </Button>
    </div>

    <ul
      class="snapshots-rail relative m-0 flex list-none flex-col gap-3 p-0"
      :class="{ 'is-empty': timeline.length === 0 }"
    >
      <li
        ref="topCardRef"
        class="snapshots-rail-node is-save"
        :class="[
          railNodeClass,
          {
            'is-op-inflight': restoreInFlight,
            'is-op-success': restoreTerminal === 'ok',
            'is-op-error': restoreTerminal === 'error'
          }
        ]"
      >
        <span
          class="snapshots-rail-dot absolute top-1 left-0 z-[1] size-[14px] rounded-[7px] border-2"
          :class="
            !showRestoreCard
              ? 'is-pending border-dashed border-neutral-400 bg-[var(--titlebar-bg)]'
              : restoreInFlight
                ? 'is-spinning border-solid border-snapshot-ring bg-[conic-gradient(var(--brand-accent,#f5c518)_270deg,transparent_270deg)] animate-spin [animation-duration:0.8s]'
                : restoreTerminal === 'ok'
                  ? 'is-restored border-solid border-snapshot-ring bg-[var(--success,#34c759)]'
                  : restoreTerminal === 'error'
                    ? 'is-error border-solid border-snapshot-ring bg-[var(--danger,#ef4444)]'
                    : 'border-solid border-snapshot-ring [background:linear-gradient(0deg,#8a8a8a_0%,#8a8a8a_100%),#fd9903]'
          "
          :aria-hidden="true"
        ></span>
        <div class="snapshots-rail-content flex flex-col gap-1.5">
          <span class="snapshots-rail-label text-[12px] text-neutral-100">
            <template v-if="restoreInFlight">{{
              t('snapshots.restoringStatus', 'Restoring snapshot')
            }}</template>
            <template v-else-if="restoreTerminal === 'ok'">{{
              t('snapshots.restored', 'Snapshot restored')
            }}</template>
            <template v-else-if="restoreTerminal === 'error'">{{
              t('snapshots.restoreFailed', 'Restore failed')
            }}</template>
            <template v-else-if="restoreTerminal === 'cancelled'">{{
              t('snapshots.restoreCancelled')
            }}</template>
            <template v-else>{{ t('snapshots.createLabel', 'Create Snapshot') }}</template>
          </span>
          <div
            class="snapshots-rail-save-box flex flex-col rounded-lg border"
            :class="[
              restoreInFlight || restoreTerminal === 'ok' || restoreTerminal === 'error'
                ? 'border-solid p-3.5'
                : 'border-dashed p-3',
              restoreTerminal === 'ok'
                ? 'is-op-success border-[var(--success,#34c759)] bg-[color-mix(in_srgb,var(--success,#34c759)_8%,transparent)]'
                : restoreTerminal === 'error'
                  ? 'is-op-error border-[var(--danger,#ef4444)] bg-[color-mix(in_srgb,var(--danger,#ef4444)_8%,transparent)]'
                  : 'border-[var(--chooser-surface-border)]',
              { 'is-op-inflight': restoreInFlight }
            ]"
          >
            <div
              v-if="restoreInFlight"
              class="snapshots-op-card flex flex-col gap-2.5"
              role="status"
              aria-live="polite"
              :data-testid="TID.snapshotsOpCard"
            >
              <p
                v-if="restoreFromLabel"
                class="snapshots-op-card-target m-0 text-[length:var(--takeover-fs-caption)] text-text-muted"
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
                <div
                  class="snapshots-op-bar-header flex items-center justify-between text-[length:var(--takeover-fs-caption)]"
                >
                  <span class="snapshots-op-bar-status text-neutral-100">{{ restorePhase }}</span>
                  <span
                    v-if="restorePercent !== null"
                    class="snapshots-op-bar-pct text-text-muted tabular-nums"
                  >
                    {{ restorePercent }}%
                  </span>
                </div>
                <div
                  class="snapshots-op-bar-track relative h-1 overflow-hidden rounded-[2px] bg-[color-mix(in_srgb,var(--neutral-100)_8%,transparent)]"
                >
                  <div
                    class="snapshots-op-bar-fill h-full bg-[var(--brand-accent,#f5c518)] transition-[width] duration-[120ms] ease-[ease]"
                    :class="{
                      'is-indeterminate w-[40%] animate-[snapshots-op-bar-indet_1.2s_ease-in-out_infinite]':
                        restorePercent === null
                    }"
                    :style="restorePercent === null ? {} : { width: `${restorePercent}%` }"
                  />
                </div>
              </div>
              <Button
                v-if="restoreCancellable"
                type="button"
                variant="textonly"
                size="unset"
                class="snapshots-op-ghost-btn static inline-flex min-h-7 items-center justify-center rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-3 py-1.5 text-[12px] leading-[1.5] font-medium text-neutral-100 whitespace-normal appearance-auto transition-[background-color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none focus-visible:ring-0"
                :data-testid="TID.snapshotsOpCardCancel"
                @click="cancelRestore"
              >
                {{ t('common.cancel', 'Cancel') }}
              </Button>
            </div>

            <div
              v-else-if="restoreTerminal === 'ok'"
              class="snapshots-op-card is-success flex flex-col gap-2.5"
              role="status"
              :data-testid="TID.snapshotsOpCard"
            >
              <p
                v-if="restoreOpIsImport"
                class="snapshots-op-card-target m-0 text-[length:var(--takeover-fs-caption)] text-text-muted"
              >
                {{ t('snapshots.restoredImported', 'Applied imported snapshot') }}
              </p>
              <p
                v-else-if="restoreFromLabel"
                class="snapshots-op-card-target m-0 text-[length:var(--takeover-fs-caption)] text-text-muted"
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
                class="snapshots-op-card-target m-0 text-[length:var(--takeover-fs-caption)] text-text-muted"
              >
                {{ t('snapshots.restoreCancelledBody') }}
              </p>
              <div class="snapshots-op-actions flex gap-2">
                <Button
                  type="button"
                  variant="textonly"
                  size="unset"
                  class="snapshots-op-primary-btn static inline-flex min-h-7 items-center justify-center rounded-lg border border-solid border-[var(--brand-accent,#f5c518)] bg-[var(--brand-accent,#f5c518)] px-3 py-1.5 text-[12px] leading-[1.5] font-medium text-[#1a1a1a] whitespace-normal appearance-auto transition-[background-color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--brand-accent,#f5c518)_88%,white)] focus-visible:bg-[color-mix(in_srgb,var(--brand-accent,#f5c518)_88%,white)] focus-visible:outline-none focus-visible:ring-0"
                  :data-testid="TID.snapshotsOpCardRetry"
                  @click="retryRestore"
                >
                  {{ t('snapshots.tryAgain', 'Try again') }}
                </Button>
                <Button
                  type="button"
                  variant="textonly"
                  size="unset"
                  class="snapshots-op-ghost-btn static inline-flex min-h-7 items-center justify-center rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-3 py-1.5 text-[12px] leading-[1.5] font-medium text-neutral-100 whitespace-normal appearance-auto transition-[background-color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none focus-visible:ring-0"
                  :data-testid="TID.snapshotsOpCardDismiss"
                  @click="dismissRestoreCard"
                >
                  {{ t('common.dismiss', 'Dismiss') }}
                </Button>
              </div>
            </div>

            <Button
              v-else
              type="button"
              variant="textonly"
              size="unset"
              class="snapshots-rail-cta static inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-3.5 py-2.5 text-[length:var(--takeover-fs-body)] leading-[1.5] font-medium text-neutral-100 whitespace-normal appearance-auto transition-[background-color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none focus-visible:ring-0"
              :aria-label="t('snapshots.createSnapshot', 'Create Snapshot')"
              :data-testid="TID.snapshotsSaveCta"
              @click="handleSave"
            >
              <span>{{ t('snapshots.createNew', 'Create Snapshot') }}</span>
            </Button>
          </div>
        </div>
      </li>

      <li
        v-for="(item, i) in timeline"
        :key="item.kind === 'snapshot' ? `s-${item.snapshot.filename}` : `c-${i}`"
        class="snapshots-rail-node"
        :class="[
          railNodeClass,
          {
            'is-snapshot': item.kind === 'snapshot',
            'is-copy': item.kind === 'copy'
          }
        ]"
      >
        <span
          class="snapshots-rail-dot absolute top-1 left-0 z-[1] size-[14px] rounded-[7px] border-2"
          :class="
            item.kind === 'copy'
              ? 'is-muted border-solid border-snapshot-ring bg-[color-mix(in_srgb,var(--text-muted)_55%,transparent)]'
              : item.snapshot.trigger === 'post-update' || item.snapshot.trigger === 'post-restore'
                ? 'is-state border-solid border-snapshot-ring bg-[var(--warning)]'
                : 'border-solid border-snapshot-ring [background:linear-gradient(0deg,#8a8a8a_0%,#8a8a8a_100%),#fd9903]'
          "
          :aria-hidden="true"
        ></span>
        <div class="snapshots-rail-content flex flex-col gap-1.5">
          <template v-if="item.kind === 'snapshot'">
            <SnapshotRow
              :snapshot="item.snapshot"
              :expanded="isExpanded(item.snapshot.filename)"
              :is-latest="item.snapshotIndex === 0"
              :previous-comfyui-version="snapshots[item.snapshotIndex + 1]?.comfyuiVersion"
              :toggle-test-id="TID.snapshotRow(item.snapshot.filename)"
              @toggle="toggleExpand(item.snapshot.filename)"
            >
              <template #expanded>
                <p
                  v-if="item.snapshot.label"
                  class="snapshots-view-label mt-0 mr-0 mb-1.5 ml-0 text-[length:var(--takeover-fs-caption)] font-medium text-text"
                >
                  {{ item.snapshot.label }}
                </p>

                <div
                  v-if="item.snapshotIndex < snapshots.length - 1"
                  class="snap-diff-accordion mt-2 flex flex-col"
                >
                  <Button
                    type="button"
                    variant="textonly"
                    size="unset"
                    class="snap-diff-trigger static inline-flex items-center justify-normal gap-1.5 self-start rounded-lg border-none bg-transparent pt-0.5 pr-1 pb-0.5 pl-0 text-[12px] leading-[1.5] font-medium text-neutral-100 whitespace-normal appearance-auto hover:bg-transparent hover:text-text focus-visible:bg-transparent focus-visible:text-text focus-visible:outline-none focus-visible:ring-0"
                    :class="{ 'is-open': isDiffOpen(item.snapshot.filename, 'previous') }"
                    :aria-expanded="isDiffOpen(item.snapshot.filename, 'previous')"
                    @click="toggleDiff(item.snapshot.filename, 'previous')"
                  >
                    <ChevronDown
                      :size="13"
                      class="snap-diff-chevron text-text-muted transition-transform duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                      :class="{
                        '[transform:rotate(180deg)]': isDiffOpen(item.snapshot.filename, 'previous')
                      }"
                    />
                    <span>{{
                      t('snapshots.changesInSnapshot', 'What changed in this snapshot')
                    }}</span>
                  </Button>
                  <BaseAccordion :open="isDiffOpen(item.snapshot.filename, 'previous')">
                    <div
                      class="snapshots-view-diff mt-1.5 max-h-[280px] overflow-y-auto rounded-lg border border-solid border-border-hover bg-transparent px-3 py-2.5"
                    >
                      <div
                        v-if="isDiffLoading(item.snapshot.filename, 'previous')"
                        class="snapshots-view-diff-loading px-3 py-2 text-[length:var(--takeover-fs-caption)] text-text-muted"
                      >
                        {{ t('common.loading', 'Loading…') }}
                      </div>
                      <template
                        v-else-if="diffFor(item.snapshot.filename, 'previous') !== undefined"
                      >
                        <div
                          v-if="
                            !diffFor(item.snapshot.filename, 'previous') ||
                            !diffHasChanges(diffFor(item.snapshot.filename, 'previous')!.diff)
                          "
                          class="snapshots-view-diff-empty text-[length:var(--takeover-fs-caption)] text-text-muted italic"
                        >
                          {{
                            t('snapshots.diffNoChanges', 'No changes from the previous snapshot.')
                          }}
                        </div>
                        <SnapshotDiffView
                          v-else
                          :diff="diffFor(item.snapshot.filename, 'previous')!.diff"
                        />
                      </template>
                    </div>
                  </BaseAccordion>
                </div>

                <div v-if="item.snapshotIndex !== 0" class="snap-diff-accordion mt-2 flex flex-col">
                  <Button
                    type="button"
                    variant="textonly"
                    size="unset"
                    class="snap-diff-trigger static inline-flex items-center justify-normal gap-1.5 self-start rounded-lg border-none bg-transparent pt-0.5 pr-1 pb-0.5 pl-0 text-[12px] leading-[1.5] font-medium text-neutral-100 whitespace-normal appearance-auto hover:bg-transparent hover:text-text focus-visible:bg-transparent focus-visible:text-text focus-visible:outline-none focus-visible:ring-0"
                    :class="{ 'is-open': isDiffOpen(item.snapshot.filename, 'current') }"
                    :aria-expanded="isDiffOpen(item.snapshot.filename, 'current')"
                    @click="toggleDiff(item.snapshot.filename, 'current')"
                  >
                    <ChevronDown
                      :size="13"
                      class="snap-diff-chevron text-text-muted transition-transform duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                      :class="{
                        '[transform:rotate(180deg)]': isDiffOpen(item.snapshot.filename, 'current')
                      }"
                    />
                    <span>{{
                      t('snapshots.ifYouRestore', 'What restoring this would change')
                    }}</span>
                  </Button>
                  <BaseAccordion :open="isDiffOpen(item.snapshot.filename, 'current')">
                    <div
                      class="snapshots-view-diff mt-1.5 max-h-[280px] overflow-y-auto rounded-lg border border-solid border-border-hover bg-transparent px-3 py-2.5"
                    >
                      <div
                        v-if="isDiffLoading(item.snapshot.filename, 'current')"
                        class="snapshots-view-diff-loading px-3 py-2 text-[length:var(--takeover-fs-caption)] text-text-muted"
                      >
                        {{ t('common.loading', 'Loading…') }}
                      </div>
                      <template
                        v-else-if="diffFor(item.snapshot.filename, 'current') !== undefined"
                      >
                        <div
                          v-if="
                            !diffFor(item.snapshot.filename, 'current') ||
                            !diffHasChanges(diffFor(item.snapshot.filename, 'current')!.diff)
                          "
                          class="snapshots-view-diff-empty text-[length:var(--takeover-fs-caption)] text-text-muted italic"
                        >
                          {{
                            t(
                              'snapshots.restoreNoChanges',
                              'Restoring this would make no changes — it matches your current state.'
                            )
                          }}
                        </div>
                        <SnapshotDiffView
                          v-else
                          :diff="diffFor(item.snapshot.filename, 'current')!.diff"
                        />
                      </template>
                    </div>
                  </BaseAccordion>
                </div>

                <div
                  class="snapshots-view-detail-actions mt-1 flex flex-wrap justify-end gap-2 border-t border-solid border-border-hover pt-3"
                >
                  <Button
                    v-if="item.snapshotIndex !== 0"
                    type="button"
                    variant="textonly"
                    size="unset"
                    :class="[detailButtonClass, 'text-neutral-100']"
                    :aria-label="t('snapshots.restore', 'Restore')"
                    :data-testid="TID.snapshotRowRestore(item.snapshot.filename)"
                    :disabled="restoreInFlight"
                    @click="handleRestore(item.snapshot.filename)"
                  >
                    <RotateCcw :size="13" />
                    <span>{{ t('snapshots.restore', 'Restore') }}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="textonly"
                    size="unset"
                    :class="[detailButtonClass, 'text-neutral-100']"
                    :aria-label="t('snapshots.exportSnapshot', 'Export')"
                    :data-testid="TID.snapshotRowExport(item.snapshot.filename)"
                    :disabled="restoreInFlight"
                    @click="handleExport(item.snapshot.filename)"
                  >
                    <Download :size="13" />
                    <span>{{ t('snapshots.exportSnapshot', 'Export') }}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="destructive-textonly"
                    size="unset"
                    :class="[
                      detailButtonClass,
                      'snapshots-view-detail-btn-danger text-danger hover:text-danger hover:border-[var(--danger)] focus-visible:text-danger focus-visible:border-[var(--danger)]'
                    ]"
                    :aria-label="t('snapshots.delete', 'Delete')"
                    :disabled="restoreInFlight"
                    @click="handleDelete(item.snapshot.filename)"
                  >
                    <Trash2 :size="13" />
                    <span>{{ t('snapshots.delete', 'Delete') }}</span>
                  </Button>
                </div>
              </template>
            </SnapshotRow>
          </template>
          <div
            v-else
            class="snapshots-view-copy-event flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] bg-transparent px-3 py-2 text-[length:var(--takeover-fs-caption)] text-text-muted"
          >
            <span
              class="snapshots-view-copy-icon text-[var(--accent-primary)]"
              :aria-hidden="true"
              >{{ item.event.direction === 'in' ? '←' : '→' }}</span
            >
            <span class="snapshots-view-copy-label min-w-0 flex-1">
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
            <span class="snapshots-view-copy-time text-[11px] opacity-70">{{
              formatDate(item.event.copiedAt)
            }}</span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style>
/* The indeterminate progress fill travels beyond both ends of its track. */
@keyframes snapshots-op-bar-indet {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
</style>
