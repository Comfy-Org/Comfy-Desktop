<script setup lang="ts">
// TODO(stale-old-modal): delete after Settings drawer (v2,
// ComfyUISettingsPanel) reaches functional parity and ships everywhere.
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { useModal } from '../composables/useModal'
import { useActionGuard } from '../composables/useActionGuard'
import { ChevronDown } from 'lucide-vue-next'
import { emitTelemetryAction, toCountBucket } from '../lib/telemetry'
import SnapshotInspector from './SnapshotInspector.vue'
import RestoreModal from './RestoreModal.vue'
import ImportPreviewModal from './ImportPreviewModal.vue'
import {
  triggerLabel as _triggerLabel,
  triggerClass,
  formatDate,
  formatRelative as _formatRelative,
  copyReasonLabel as _copyReasonLabel,
  changeSummary as _changeSummary,
  diffHasChanges,
  isDisplayableLabel
} from '../lib/snapshots'
import type {
  ActionDef,
  CopyEvent,
  SnapshotSummary,
  SnapshotListData,
  SnapshotDetailData,
  SnapshotDiffData,
  SnapshotFilePreview
} from '../types/ipc'

interface Props {
  installationId: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'run-action': [action: ActionDef, button: HTMLButtonElement | null]
  'refresh-all': []
  'navigate-installation': [installationId: string]
}>()

const { t } = useI18n()
const modal = useModal()
const actionGuard = useActionGuard()

const listData = ref<SnapshotListData | null>(null)
const loading = ref(true)
const selectedFilename = ref<string | null>(null)
const detail = ref<SnapshotDetailData | null>(null)
const detailLoading = ref(false)
const diffData = ref<SnapshotDiffData | null>(null)
const diffLoading = ref(false)
const diffMode = ref<'previous' | 'current' | null>(null)
const restorePreviewFilename = ref<string | null>(null)
const restorePreviewDiff = ref<SnapshotDiffData | null>(null)
const restorePreviewLoading = ref(false)
const importPreview = ref<SnapshotFilePreview | null>(null)
const importPreviewLoading = ref(false)
// True when the restore modal is showing an import diff (no snapshots written yet).
const pendingImport = ref(false)

const snapshots = computed(() => listData.value?.snapshots ?? [])
const copyEvents = computed(() => listData.value?.copyEvents ?? [])
const context = computed(() => listData.value?.context ?? null)

type TimelineItem =
  | { kind: 'snapshot'; snapshot: SnapshotSummary; snapshotIndex: number }
  | { kind: 'copy'; event: CopyEvent }

const timelineItems = computed<TimelineItem[]>(() => {
  // Merge snapshots and copy events by timestamp, newest first.
  const items: TimelineItem[] = []
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
      items.push({ kind: 'snapshot', snapshot: snaps[si]!, snapshotIndex: si })
      si++
    } else {
      items.push({ kind: 'copy', event: copies[ci]! })
      ci++
    }
  }
  return items
})

async function load(): Promise<void> {
  loading.value = true
  try {
    listData.value = await window.api.getSnapshots(props.installationId)
  } catch (err) {
    console.error('SnapshotTab.load failed', err)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.installationId,
  () => {
    selectedFilename.value = null
    detail.value = null
    diffData.value = null
    diffMode.value = null
    restorePreviewFilename.value = null
    restorePreviewDiff.value = null
    importPreview.value = null
    importPreviewLoading.value = false
    pendingImport.value = false
    load()
  },
  { immediate: true }
)

function triggerTone(trigger: string, background = false): string {
  const colors = background
    ? {
        muted: 'bg-text-muted',
        success: 'bg-[var(--success)]',
        warning: 'bg-[var(--warning)]',
        info: 'bg-[var(--info)]',
        fallback: 'bg-[var(--text-faint)]'
      }
    : {
        muted: 'text-text-muted',
        success: 'text-[var(--success)]',
        warning: 'text-[var(--warning)]',
        info: 'text-[var(--info)]',
        fallback: ''
      }
  if (trigger === 'boot' || trigger === 'copy') return colors.muted
  if (trigger === 'manual' || trigger === 'pre-update') return colors.success
  if (trigger === 'post-update' || trigger === 'post-restore') return colors.warning
  if (trigger === 'restart') return colors.info
  return colors.fallback
}

const triggerLabel = (trigger: string): string => _triggerLabel(trigger, t)
const formatRelative = (iso: string): string => _formatRelative(iso, t)
const copyReasonLabel = (reason: string): string => _copyReasonLabel(reason, t)
const changeSummary = (s: SnapshotSummary): string[] => _changeSummary(s, t)

async function selectSnapshot(filename: string): Promise<void> {
  if (selectedFilename.value === filename) {
    selectedFilename.value = null
    detail.value = null
    diffData.value = null
    diffMode.value = null
    restorePreviewFilename.value = null
    restorePreviewDiff.value = null
    return
  }
  selectedFilename.value = filename
  diffData.value = null
  diffMode.value = null
  detailLoading.value = true
  try {
    detail.value = await window.api.getSnapshotDetail(props.installationId, filename)
  } finally {
    detailLoading.value = false
  }
}

async function loadDiff(mode: 'previous' | 'current'): Promise<void> {
  if (!selectedFilename.value) return
  if (diffMode.value === mode) {
    diffMode.value = null
    diffData.value = null
    return
  }
  diffMode.value = mode
  diffLoading.value = true
  try {
    diffData.value = await window.api.getSnapshotDiff(
      props.installationId,
      selectedFilename.value,
      mode
    )
  } finally {
    diffLoading.value = false
  }
}

async function saveSnapshot(): Promise<void> {
  const label = await modal.prompt({
    title: t('standalone.snapshotCreateTitle'),
    message: t('standalone.snapshotCreateMessage'),
    placeholder: t('standalone.snapshotLabelPlaceholder'),
    confirmLabel: t('snapshots.createSnapshot'),
    required: false
  })
  if (label === null) return
  try {
    await window.api.runAction(props.installationId, 'snapshot-save', { label: label || undefined })
  } catch (err: unknown) {
    await modal.alert({
      title: t('snapshots.createSnapshot'),
      message: (err as Error).message || String(err)
    })
    return
  }
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'save',
    snapshot_count_bucket: toCountBucket(snapshots.value.length)
  })
  selectedFilename.value = null
  detail.value = null
  diffData.value = null
  diffMode.value = null
  await load()
  emit('refresh-all')
}

async function handleRestore(filename: string): Promise<void> {
  if (selectedFilename.value !== filename) {
    await selectSnapshot(filename)
  }
  // Load restore preview diff (current state → target snapshot).
  restorePreviewFilename.value = filename
  restorePreviewLoading.value = true
  try {
    restorePreviewDiff.value = await window.api.getSnapshotDiff(
      props.installationId,
      filename,
      'current'
    )
  } finally {
    restorePreviewLoading.value = false
  }
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'restore_start',
    snapshot_count_bucket: toCountBucket(snapshots.value.length),
    has_diff: restorePreviewDiff.value ? diffHasChanges(restorePreviewDiff.value.diff) : undefined
  })
}

function cancelRestore(): void {
  restorePreviewFilename.value = null
  restorePreviewDiff.value = null
  pendingImport.value = false
}

async function confirmRestore(): Promise<void> {
  const hasDiff = restorePreviewDiff.value
    ? diffHasChanges(restorePreviewDiff.value.diff)
    : undefined
  let filename = restorePreviewFilename.value
  let restoreToken: string | null = null

  if (pendingImport.value) {
    // Import flow: stage the snapshots as a restore target, then restore. They
    // only become history once the restore succeeds (see the snapshot-restore
    // action), so a failed restore can't leave a never-applied snapshot on top.
    pendingImport.value = false
    restorePreviewFilename.value = null
    restorePreviewDiff.value = null

    // Gate the import-confirm step behind the busy guard — confirm stages the
    // snapshots and immediately auto-restores, so racing an in-flight op
    // (copy / release-update / migrate / running launch) would clobber
    // both surfaces.
    if (
      !(await actionGuard.checkBeforeAction(props.installationId, t('snapshots.importSnapshots')))
    )
      return
    const result = await window.api.importSnapshotsConfirm(props.installationId)
    if (!result.ok) {
      if (result.message) {
        await modal.alert({ title: t('snapshots.importSnapshots'), message: result.message })
      }
      return
    }
    // Kept-local PyTorch disclosure: the snapshot's recorded stack can't be
    // applied on this machine, so the restore will keep the local stack.
    // Surface that BEFORE running the restore; cancelling leaves only the
    // staged token behind (it self-prunes), nothing was mutated.
    if (result.torchStackNotice) {
      const proceed = await modal.confirm({
        title: t('snapshots.importTorchNoticeTitle', 'Snapshot uses a different PyTorch'),
        message: result.torchStackNotice,
        confirmLabel: t('standalone.snapshotRestore'),
        confirmStyle: 'primary'
      })
      if (!proceed) return
    }
    emitTelemetryAction('comfy.desktop.snapshot.flow', {
      action: 'import',
      snapshot_count_bucket: toCountBucket(snapshots.value.length),
      imported_bucket: toCountBucket(result.imported ?? 0)
    })
    // Nothing landed in the live history yet; don't reload until the restore
    // commits it on success.
    restoreToken = result.restoreToken ?? null
    filename = null
  } else {
    restorePreviewFilename.value = null
    restorePreviewDiff.value = null
  }

  if (!filename && !restoreToken) return

  const action: ActionDef = {
    id: 'snapshot-restore',
    label: t('standalone.snapshotRestore'),
    data: restoreToken ? { restoreToken } : { file: filename },
    showProgress: true,
    progressTitle: t('standalone.snapshotRestoringTitle'),
    cancellable: true
  }
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'restore_complete',
    snapshot_count_bucket: toCountBucket(snapshots.value.length),
    has_diff: hasDiff
  })
  emit('run-action', action, null)
}

async function handleDelete(filename: string): Promise<void> {
  const confirmed = await modal.confirm({
    title: t('standalone.snapshotDelete'),
    message: t('snapshots.deleteConfirm')
  })
  if (!confirmed) return
  await window.api.runAction(props.installationId, 'snapshot-delete', { file: filename })
  emitTelemetryAction('comfy.desktop.snapshot.flow', {
    action: 'delete',
    snapshot_count_bucket: toCountBucket(snapshots.value.length)
  })
  if (selectedFilename.value === filename) {
    selectedFilename.value = null
    detail.value = null
    diffData.value = null
    diffMode.value = null
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
  importPreview.value = null
  const result = await window.api.importSnapshotsPreview()
  if (!result.ok) {
    if (result.message) {
      await modal.alert({ title: t('snapshots.importSnapshots'), message: result.message })
    }
    return
  }
  importPreview.value = result.preview ?? null
}

function cancelImportPreview(): void {
  importPreview.value = null
  importPreviewLoading.value = false
}

async function confirmImportPreview(): Promise<void> {
  importPreviewLoading.value = true
  const result = await window.api.importSnapshotsDiff(props.installationId)
  cancelImportPreview()
  if (!result.ok) {
    if (result.message) {
      await modal.alert({ title: t('snapshots.importSnapshots'), message: result.message })
    }
    return
  }

  // Hand the diff straight to the restore modal; nothing on disk until confirm.
  selectedFilename.value = null
  detail.value = null
  diffData.value = null
  diffMode.value = null
  pendingImport.value = true
  restorePreviewDiff.value = result.diff ?? null
  restorePreviewFilename.value = '__pending_import__'
}
</script>

<template>
  <div class="snapshot-tab py-2">
    <div
      v-if="!loading && snapshots.length === 0"
      class="snapshot-empty px-5 py-10 text-center text-[14px] text-text-muted"
    >
      {{ t('snapshots.empty') }}
    </div>

    <div
      v-if="snapshots.length > 0 || !loading"
      class="snapshot-header flex justify-end gap-2 px-1 pt-0 pb-3"
    >
      <Button
        variant="textonly"
        size="unset"
        class="snapshot-save-btn static inline-block rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[13px] font-normal leading-[1.5] whitespace-normal appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] hover:bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-text"
        @click="saveSnapshot"
      >
        {{ t('snapshots.createSnapshot') }}
      </Button>
      <Button
        variant="textonly"
        size="unset"
        class="snapshot-header-btn static inline-block rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[13px] font-normal leading-[1.5] whitespace-normal appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] hover:bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-text-muted"
        @click="handleImport"
      >
        {{ t('snapshots.importSnapshots') }}
      </Button>
      <Button
        v-if="snapshots.length > 0"
        variant="textonly"
        size="unset"
        class="snapshot-header-btn static inline-block rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[13px] font-normal leading-[1.5] whitespace-normal appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] hover:bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-text-muted"
        @click="handleExportAll"
      >
        {{ t('snapshots.exportAllSnapshots') }}
      </Button>
    </div>

    <div
      v-if="loading"
      class="snapshot-loading flex items-center gap-2.5 py-4 text-[13px] text-text-muted before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-full before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
    >
      {{ t('common.loading') }}
    </div>

    <div v-if="!loading && snapshots.length > 0" class="snapshot-timeline flex flex-col">
      <template
        v-for="(item, index) in timelineItems"
        :key="
          item.kind === 'snapshot' ? item.snapshot.filename : `copy-${item.event.installationId}`
        "
      >
        <div
          v-if="item.kind === 'copy'"
          class="timeline-entry grid grid-cols-[24px_1fr] gap-x-2.5 gap-y-0"
        >
          <div class="timeline-gutter col-start-1 row-start-1 flex flex-col items-center">
            <div
              class="timeline-line w-0.5 bg-[var(--border)] timeline-line-top h-4 shrink-0"
              :class="{ invisible: index === 0 }"
            />
            <div
              class="timeline-dot box-content size-2.5 shrink-0 rounded-full border-2 border-solid border-[var(--surface)] trigger-copy bg-text-muted"
            />
            <div
              class="timeline-line-rest w-0.5 flex-1 bg-[var(--border)]"
              :class="{ invisible: index === timelineItems.length - 1 }"
            />
          </div>
          <div class="timeline-content col-start-2 row-start-1 min-w-0">
            <div
              class="timeline-copy-card mb-1.5 flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12px]"
            >
              <span
                class="timeline-trigger rounded-[3px] bg-[var(--bg)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-[0.3px] trigger-copy text-text-muted"
                >{{ copyReasonLabel(item.event.copyReason) }}</span
              >
              <Button
                v-if="item.event.exists"
                variant="textonly"
                size="unset"
                class="timeline-copy-name clickable static inline-block min-w-0 truncate rounded-lg border-none bg-transparent p-0 [font:inherit] text-[var(--accent)] appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] hover:bg-transparent hover:underline"
                @click="emit('navigate-installation', item.event.installationId)"
              >
                {{ item.event.installationName }}
              </Button>
              <span v-else class="timeline-copy-name min-w-0 truncate text-text-muted">{{
                item.event.installationName
              }}</span>
              <span
                class="timeline-time ml-auto text-[12px] text-text-muted"
                :title="formatDate(item.event.copiedAt)"
                >{{ formatRelative(item.event.copiedAt) }}</span
              >
            </div>
          </div>
        </div>

        <div
          v-else
          class="timeline-entry grid grid-cols-[24px_1fr] gap-x-2.5 gap-y-0"
          :class="{ selected: selectedFilename === item.snapshot.filename }"
        >
          <div class="timeline-gutter col-start-1 row-start-1 flex flex-col items-center">
            <div
              class="timeline-line w-0.5 bg-[var(--border)] timeline-line-top h-4 shrink-0"
              :class="{ invisible: index === 0 }"
            />
            <div
              class="timeline-dot box-content size-2.5 shrink-0 rounded-full border-2 border-solid border-[var(--surface)]"
              :class="[
                triggerClass(item.snapshot.trigger),
                triggerTone(item.snapshot.trigger, true)
              ]"
            />
            <div
              class="timeline-line-rest w-0.5 flex-1 bg-[var(--border)]"
              :class="{ invisible: index === timelineItems.length - 1 }"
            />
          </div>

          <div class="timeline-content col-start-2 row-start-1 min-w-0">
            <div
              :class="
                selectedFilename === item.snapshot.filename
                  ? 'selected mb-0 rounded-t-lg border-[var(--selected)] border-b-transparent'
                  : 'mb-1.5 rounded-lg border-[var(--border)] hover:border-[var(--border-hover)]'
              "
              class="timeline-card group/card cursor-pointer border border-solid bg-[var(--surface)] px-3.5 py-2.5 transition-[border-color] duration-150 ease-[ease]"
              @click="selectSnapshot(item.snapshot.filename)"
            >
              <div class="timeline-card-header mb-1 flex items-center gap-2">
                <span
                  class="timeline-trigger rounded-[3px] bg-[var(--bg)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-[0.3px]"
                  :class="[triggerClass(item.snapshot.trigger), triggerTone(item.snapshot.trigger)]"
                  >{{ triggerLabel(item.snapshot.trigger) }}</span
                >
                <span
                  v-if="item.snapshotIndex === 0"
                  class="timeline-current-tag rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--accent)]"
                  >{{ t('snapshots.current') }}</span
                >
                <span
                  class="timeline-time ml-auto text-[12px] text-text-muted"
                  :title="formatDate(item.snapshot.createdAt)"
                  >{{ formatRelative(item.snapshot.createdAt) }}</span
                >
              </div>
              <div
                v-if="isDisplayableLabel(item.snapshot.label)"
                class="timeline-label mb-1 text-[13px] font-medium text-text"
              >
                {{ item.snapshot.label }}
              </div>
              <div class="timeline-card-body flex items-center gap-2">
                <div
                  class="timeline-meta flex min-w-0 flex-1 items-center gap-1 text-[12px] text-text-muted"
                >
                  <span>{{ item.snapshot.comfyuiVersion }}</span>
                  <span class="timeline-meta-sep text-text-muted">·</span>
                  <span>{{ t('snapshots.nodesCount', { count: item.snapshot.nodeCount }) }}</span>
                  <span class="timeline-meta-sep text-text-muted">·</span>
                  <span>{{
                    t('snapshots.packagesCount', { count: item.snapshot.pipPackageCount })
                  }}</span>
                </div>
                <Button
                  v-if="item.snapshotIndex > 0"
                  variant="textonly"
                  size="unset"
                  class="timeline-action-btn timeline-restore-btn static inline-block shrink-0 rounded-[4px] border border-solid bg-transparent px-2.5 py-[3px] text-[11px] font-normal leading-[1.5] whitespace-normal text-text-muted appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] hover:bg-transparent group-hover/card:opacity-100 focus-visible:opacity-100 border-[var(--border)] hover:text-text hover:border-[var(--accent)]"
                  :class="selectedFilename === item.snapshot.filename ? 'opacity-100' : 'opacity-0'"
                  @click.stop="handleRestore(item.snapshot.filename)"
                >
                  {{ t('snapshots.restore') }}
                </Button>
                <Button
                  variant="textonly"
                  size="unset"
                  class="timeline-action-btn timeline-export-btn static inline-block shrink-0 rounded-[4px] border border-solid bg-transparent px-2.5 py-[3px] text-[11px] font-normal leading-[1.5] whitespace-normal text-text-muted appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] hover:bg-transparent group-hover/card:opacity-100 focus-visible:opacity-100 border-[var(--border)] hover:text-text hover:border-[var(--accent)]"
                  :class="selectedFilename === item.snapshot.filename ? 'opacity-100' : 'opacity-0'"
                  @click.stop="handleExport(item.snapshot.filename)"
                >
                  {{ t('snapshots.exportSnapshot') }}
                </Button>
                <Button
                  v-if="item.snapshot.trigger === 'manual'"
                  variant="textonly"
                  size="unset"
                  class="timeline-action-btn timeline-delete-btn static inline-block shrink-0 rounded-[4px] border border-solid bg-transparent px-1.5 py-[3px] text-[11px] font-normal leading-none whitespace-normal text-text-muted appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] hover:bg-transparent group-hover/card:opacity-100 focus-visible:opacity-100 border-transparent hover:text-danger hover:border-[var(--danger)]"
                  :class="selectedFilename === item.snapshot.filename ? 'opacity-100' : 'opacity-0'"
                  @click.stop="handleDelete(item.snapshot.filename)"
                >
                  ✕
                </Button>
                <ChevronDown
                  :size="14"
                  class="timeline-expand-icon ml-auto shrink-0 text-text-muted transition-transform duration-150 ease-[ease]"
                  :class="{
                    'expanded [transform:rotate(180deg)]':
                      selectedFilename === item.snapshot.filename
                  }"
                />
              </div>
              <div
                v-if="changeSummary(item.snapshot).length > 0"
                class="timeline-changes mt-1.5 flex flex-wrap gap-1.5"
              >
                <span
                  v-for="part in changeSummary(item.snapshot)"
                  :key="part"
                  class="timeline-change-badge rounded-[3px] bg-[var(--bg)] px-1.5 py-px text-[11px] text-text-muted"
                  >{{ part }}</span
                >
              </div>
            </div>

            <SnapshotInspector
              v-if="selectedFilename === item.snapshot.filename"
              :detail="detail"
              :detail-loading="detailLoading"
              :diff-mode="diffMode"
              :diff-data="diffData"
              :diff-loading="diffLoading"
              :snapshot-index="item.snapshotIndex"
              :total-snapshots="snapshots.length"
              :context="context"
              @toggle-diff="loadDiff"
            />
          </div>
        </div>
      </template>
    </div>

    <RestoreModal
      v-if="restorePreviewFilename"
      :diff-data="restorePreviewDiff"
      :loading="restorePreviewLoading"
      @cancel="cancelRestore"
      @confirm="confirmRestore"
    />

    <ImportPreviewModal
      v-if="importPreview || importPreviewLoading"
      :preview="importPreview"
      :loading="importPreviewLoading"
      @cancel="cancelImportPreview"
      @confirm="confirmImportPreview"
    />
  </div>
</template>
