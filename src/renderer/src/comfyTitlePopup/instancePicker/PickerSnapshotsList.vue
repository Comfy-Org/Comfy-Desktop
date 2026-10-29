<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Camera, RotateCcw, Trash2 } from 'lucide-vue-next'
import SnapshotRow from '../../views/comfyUISettings/SnapshotRow.vue'
import { changeSummary } from '../../lib/snapshots'
import type { SnapshotListData, SnapshotSummary } from '../../types/ipc'

// Snapshots list for the picker's right-pane accordion. Reuses the drawer's
// SnapshotRow so the two surfaces stay byte-identical. Destructive flows use
// window.confirm because the popup process has no useModal primitive.

interface Props {
  data: SnapshotListData | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  save: []
  restore: [filename: string]
  delete: [filename: string]
}>()

const { t } = useI18n()

const snapshots = computed<SnapshotSummary[]>(() => props.data?.snapshots ?? [])
const hasSnapshots = computed(() => snapshots.value.length > 0)

const expanded = ref<string | null>(null)
function toggleExpand(filename: string): void {
  expanded.value = expanded.value === filename ? null : filename
}

function summaryFor(snapshot: SnapshotSummary): string[] {
  return changeSummary(snapshot, t)
}

function handleRestore(snapshot: SnapshotSummary): void {
  const ok = window.confirm(
    t(
      'snapshots.restoreConfirm',
      'Are you sure you want to restore this snapshot? Your current install state will be replaced.'
    )
  )
  if (!ok) return
  emit('restore', snapshot.filename)
}

function handleDelete(snapshot: SnapshotSummary): void {
  const ok = window.confirm(t('snapshots.deleteConfirm', 'Delete this snapshot?'))
  if (!ok) return
  emit('delete', snapshot.filename)
}
</script>

<template>
  <div class="picker-snapshots flex flex-col gap-2.5">
    <button
      type="button"
      class="picker-snapshots-save inline-flex items-center gap-1.5 self-start rounded-md border border-solid border-[rgba(255,255,255,0.12)] bg-[var(--chooser-surface-bg)] px-2.5 py-1.5 text-[12px] leading-4 text-neutral-100 cursor-pointer transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[rgba(255,255,255,0.08)] hover:outline-none focus-visible:bg-[rgba(255,255,255,0.08)] focus-visible:outline-none"
      @click="emit('save')"
    >
      <Camera :size="14" aria-hidden="true" />
      <span>{{ t('snapshots.createSnapshot', 'Create Snapshot') }}</span>
    </button>

    <div v-if="hasSnapshots" class="picker-snapshots-list flex flex-col gap-2.5">
      <SnapshotRow
        v-for="(snap, idx) in snapshots"
        :key="snap.filename"
        :snapshot="snap"
        :expanded="expanded === snap.filename"
        :is-current="idx === 0"
        @toggle="toggleExpand(snap.filename)"
      >
        <template #expanded>
          <div class="picker-snapshot-summary flex flex-col gap-2">
            <p
              v-for="(line, i) in summaryFor(snap)"
              :key="`l-${i}`"
              class="picker-snapshot-summary-line m-0 text-[12px] leading-4 text-text-muted"
            >
              {{ line }}
            </p>
            <div class="picker-snapshot-actions mt-0.5 flex gap-1.5">
              <button
                type="button"
                class="picker-snapshot-action is-primary inline-flex items-center gap-1 rounded-md border border-solid border-[rgba(255,255,255,0.1)] bg-[var(--chooser-surface-bg)] px-2.5 py-[5px] text-[12px] leading-4 cursor-pointer transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[rgba(255,255,255,0.1)] hover:outline-none focus-visible:bg-[rgba(255,255,255,0.1)] focus-visible:outline-none text-[var(--accent-primary,#60a5fa)]"
                @click="handleRestore(snap)"
              >
                <RotateCcw :size="12" aria-hidden="true" />
                <span>{{ t('snapshots.restore', 'Restore') }}</span>
              </button>
              <button
                type="button"
                class="picker-snapshot-action is-danger inline-flex items-center gap-1 rounded-md border border-solid border-[rgba(255,255,255,0.1)] bg-[var(--chooser-surface-bg)] px-2.5 py-[5px] text-[12px] leading-4 cursor-pointer transition-[background-color] duration-[120ms] ease-[ease] hover:outline-none focus-visible:outline-none text-danger hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] hover:text-danger-hover focus-visible:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] focus-visible:text-danger-hover"
                @click="handleDelete(snap)"
              >
                <Trash2 :size="12" aria-hidden="true" />
                <span>{{ t('snapshots.delete', 'Delete') }}</span>
              </button>
            </div>
          </div>
        </template>
      </SnapshotRow>
    </div>

    <div
      v-else
      class="picker-snapshots-empty py-1 text-[12px] leading-4 text-neutral-100 opacity-60"
    >
      {{
        t(
          'snapshots.empty',
          'No snapshots yet. Snapshots are captured automatically when ComfyUI starts.'
        )
      }}
    </div>
  </div>
</template>
