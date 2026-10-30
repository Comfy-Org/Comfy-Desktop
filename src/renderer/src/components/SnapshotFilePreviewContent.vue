<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SnapshotFilePreview } from '../types/ipc'
import { triggerLabel as _triggerLabel, formatDate, formatNodeVersion } from '../lib/snapshots'

defineProps<{
  preview: SnapshotFilePreview
}>()

const { t } = useI18n()

const nodesExpanded = ref(true)
const pipExpanded = ref(false)

function triggerColor(trigger: string): string {
  if (trigger === 'restart') return 'text-[var(--info)]'
  if (trigger === 'manual' || trigger === 'pre-update') return 'text-[var(--success)]'
  if (trigger === 'post-update' || trigger === 'post-restore') return 'text-[var(--warning)]'
  return 'text-text-muted'
}

function triggerLabel(trigger: string): string {
  return _triggerLabel(trigger, t)
}
</script>

<template>
  <div class="snapshot-preview-section mb-4 last:mb-0">
    <div class="snapshot-preview-field mb-1 flex flex-col gap-0.5">
      <span class="snapshot-preview-label text-[13px] text-text-muted">{{
        t('list.snapshotSourceName')
      }}</span>
      <span class="snapshot-preview-value text-[14px] text-text select-text">{{
        preview.installationName
      }}</span>
    </div>
    <div class="snapshot-preview-field mb-1 flex flex-col gap-0.5">
      <span class="snapshot-preview-label text-[13px] text-text-muted">{{
        t('list.snapshotCount')
      }}</span>
      <span class="snapshot-preview-value text-[14px] text-text select-text">{{
        preview.snapshotCount
      }}</span>
    </div>
  </div>

  <div class="snapshot-preview-section mb-4 last:mb-0">
    <div
      class="snapshot-preview-section-title mb-2 text-[12px] font-semibold text-text-muted uppercase tracking-[0.3px]"
    >
      {{ t('list.snapshotTimeline') }}
    </div>
    <div
      class="snapshot-preview-timeline flex max-h-[200px] flex-col gap-1 overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
    >
      <div
        v-for="(snap, i) in preview.snapshots"
        :key="snap.filename"
        class="snapshot-preview-timeline-item flex items-center gap-2 rounded-[5px] bg-[var(--bg)] px-2.5 py-1.5 text-[13px]"
      >
        <span
          class="snapshot-preview-trigger shrink-0 rounded-[3px] bg-[var(--surface)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-[0.3px]"
          :class="triggerColor(snap.trigger)"
          >{{ triggerLabel(snap.trigger) }}</span
        >
        <span
          v-if="i === 0"
          class="snapshot-preview-current-tag shrink-0 text-[11px] font-semibold text-[var(--accent)]"
          >{{ t('snapshots.current') }}</span
        >
        <span class="snapshot-preview-meta min-w-0 flex-1 truncate text-text-muted"
          >{{ snap.comfyuiVersion }} · {{ t('snapshots.nodesCount', { count: snap.nodeCount }) }} ·
          {{ t('snapshots.packagesCount', { count: snap.pipPackageCount }) }}</span
        >
        <span class="snapshot-preview-time shrink-0 text-[13px] text-text-muted">{{
          formatDate(snap.createdAt)
        }}</span>
      </div>
    </div>
  </div>

  <div class="snapshot-preview-section mb-4 last:mb-0">
    <div
      class="snapshot-preview-section-title mb-2 text-[12px] font-semibold text-text-muted uppercase tracking-[0.3px]"
    >
      {{ t('list.snapshotNewestDetail') }}
    </div>

    <div class="snapshot-preview-grid mb-2.5 grid grid-cols-[1fr_1fr] gap-x-4 gap-y-1.5">
      <div class="snapshot-preview-field mb-1 flex flex-col gap-0.5">
        <span class="snapshot-preview-label text-[13px] text-text-muted">{{
          t('snapshots.comfyuiVersion')
        }}</span>
        <span class="snapshot-preview-value text-[14px] text-text select-text">{{
          preview.newestSnapshot.comfyuiVersion
        }}</span>
      </div>
      <div class="snapshot-preview-field mb-1 flex flex-col gap-0.5">
        <span class="snapshot-preview-label text-[13px] text-text-muted">{{
          t('snapshots.variant')
        }}</span>
        <span class="snapshot-preview-value text-[14px] text-text select-text">{{
          preview.newestSnapshot.comfyui.variant || '—'
        }}</span>
      </div>
      <div class="snapshot-preview-field mb-1 flex flex-col gap-0.5">
        <span class="snapshot-preview-label text-[13px] text-text-muted">{{
          t('snapshots.pythonVersion')
        }}</span>
        <span class="snapshot-preview-value text-[14px] text-text select-text">{{
          preview.newestSnapshot.pythonVersion || '—'
        }}</span>
      </div>
      <div class="snapshot-preview-field mb-1 flex flex-col gap-0.5">
        <span class="snapshot-preview-label text-[13px] text-text-muted">{{
          t('snapshots.capturedAt')
        }}</span>
        <span class="snapshot-preview-value text-[14px] text-text select-text">{{
          formatDate(preview.newestSnapshot.createdAt)
        }}</span>
      </div>
    </div>

    <div class="snapshot-preview-subsection mt-2.5">
      <div
        class="snapshot-preview-subsection-title mb-1.5 flex cursor-pointer items-center justify-between text-[13px] font-semibold text-text-muted select-none"
        @click="nodesExpanded = !nodesExpanded"
      >
        <span
          >{{ t('snapshots.customNodes') }} ({{ preview.newestSnapshot.customNodes.length }})</span
        >
        <span class="snapshot-preview-collapse text-[14px]">{{ nodesExpanded ? '▾' : '▸' }}</span>
      </div>
      <template v-if="nodesExpanded">
        <div
          v-if="preview.newestSnapshot.customNodes.length > 0"
          class="snapshot-preview-list flex flex-col gap-[3px] max-h-60 overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
        >
          <div
            v-for="node in preview.newestSnapshot.customNodes"
            :key="node.id"
            class="snapshot-preview-node-row flex items-center gap-2 py-0.5 text-[13px]"
          >
            <span
              class="snapshot-preview-node-status size-[7px] shrink-0 rounded-full"
              :class="node.enabled ? 'bg-[var(--info)]' : 'bg-text-muted'"
            />
            <span
              class="snapshot-preview-node-name min-w-0 flex-1 truncate text-text select-text"
              >{{ node.id }}</span
            >
            <span
              class="snapshot-preview-node-type shrink-0 rounded-[3px] border border-solid border-[var(--border)] px-[5px] py-px text-[11px] font-semibold text-text-muted uppercase"
              >{{ node.type }}</span
            >
            <span
              class="snapshot-preview-node-version shrink-0 text-[13px] [font-family:monospace] text-text-muted select-text"
              :title="formatNodeVersion(node)"
              >{{ formatNodeVersion(node) }}</span
            >
          </div>
        </div>
        <div v-else class="snapshot-preview-empty text-[14px] text-text-muted">—</div>
      </template>
    </div>

    <div class="snapshot-preview-subsection mt-2.5">
      <div
        class="snapshot-preview-subsection-title mb-1.5 flex cursor-pointer items-center justify-between text-[13px] font-semibold text-text-muted select-none"
        @click="pipExpanded = !pipExpanded"
      >
        <span>{{ t('snapshots.pipPackages') }} ({{ preview.newestSnapshot.pipPackageCount }})</span>
        <span class="snapshot-preview-collapse text-[14px]">{{ pipExpanded ? '▾' : '▸' }}</span>
      </div>
      <template v-if="pipExpanded">
        <div
          v-if="preview.newestSnapshot.pipPackageCount > 0"
          class="snapshot-preview-list flex flex-col gap-[3px] max-h-60 overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
        >
          <div
            v-for="(version, name) in preview.newestSnapshot.pipPackages"
            :key="name"
            class="snapshot-preview-pip-row flex items-center justify-between py-0.5 text-[13px]"
          >
            <span class="snapshot-preview-pip-name min-w-0 flex-1 truncate text-text select-text">{{
              name
            }}</span>
            <span
              class="snapshot-preview-pip-version ml-3 max-w-[50%] truncate [font-family:monospace] text-text-muted select-text"
              :title="version"
              >{{ version }}</span
            >
          </div>
        </div>
        <div v-else class="snapshot-preview-empty text-[14px] text-text-muted">—</div>
      </template>
    </div>
  </div>
</template>
