<script setup lang="ts">
// TODO(stale-old-modal): delete after Settings drawer (v2,
// ComfyUISettingsPanel) reaches functional parity and ships everywhere.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import SnapshotDiffView from './SnapshotDiffView.vue'
import InfoTooltip from './InfoTooltip.vue'
import { diffHasChanges, formatDate, formatNodeVersion } from '../lib/snapshots'
import type { SnapshotDetailData, SnapshotDiffData, SnapshotListData } from '../types/ipc'

interface Props {
  detail: SnapshotDetailData | null
  detailLoading: boolean
  diffMode: 'previous' | 'current' | null
  diffData: SnapshotDiffData | null
  diffLoading: boolean
  snapshotIndex: number
  totalSnapshots: number
  context: SnapshotListData['context'] | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-diff': [mode: 'previous' | 'current']
}>()

const { t } = useI18n()

const nodeSearch = ref('')
const nodesExpanded = ref(true)
const pipSearch = ref('')
const pipExpanded = ref(false)

watch(
  () => props.detail,
  () => {
    nodeSearch.value = ''
    nodesExpanded.value = true
    pipSearch.value = ''
    pipExpanded.value = false
  }
)

const filteredCustomNodes = computed(() => {
  if (!props.detail) return []
  if (!nodeSearch.value) return props.detail.customNodes
  const q = nodeSearch.value.toLowerCase()
  return props.detail.customNodes.filter((n) => n.id.toLowerCase().includes(q))
})

const filteredPipPackages = computed(() => {
  if (!props.detail) return []
  const entries = Object.entries(props.detail.pipPackages)
  if (!pipSearch.value) return entries
  const q = pipSearch.value.toLowerCase()
  return entries.filter(([name]) => name.toLowerCase().includes(q))
})
</script>

<template>
  <div
    class="snapshot-inspector mb-1.5 rounded-b-lg border border-solid border-[var(--selected)] border-t-0 bg-[var(--surface)] px-3.5 py-3"
    @click.stop
  >
    <div
      v-if="detailLoading"
      class="snapshot-loading flex items-center gap-2.5 py-4 text-[13px] text-text-muted before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-full before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
    >
      {{ t('common.loading') }}
    </div>
    <template v-else-if="detail">
      <div class="diff-toggle mb-3 flex gap-1">
        <Button
          variant="textonly"
          size="unset"
          class="static inline-block flex-1 rounded-[5px] border border-solid px-2.5 py-[5px] text-[12px] font-normal leading-[1.5] whitespace-normal appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40"
          :class="
            diffMode === 'previous'
              ? 'active bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] border-[var(--accent)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)]'
              : 'bg-[var(--bg)] border-[var(--border)] text-text-muted hover:bg-[var(--bg)] enabled:hover:text-text enabled:hover:border-[var(--border-hover)]'
          "
          :disabled="snapshotIndex === totalSnapshots - 1"
          @click="emit('toggle-diff', 'previous')"
        >
          {{ t('snapshots.diffPrevious') }}
        </Button>
        <Button
          variant="textonly"
          size="unset"
          class="static inline-block flex-1 rounded-[5px] border border-solid px-2.5 py-[5px] text-[12px] font-normal leading-[1.5] whitespace-normal appearance-auto focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] transition-all duration-150 ease-[ease] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40"
          :class="
            diffMode === 'current'
              ? 'active bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] border-[var(--accent)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)]'
              : 'bg-[var(--bg)] border-[var(--border)] text-text-muted hover:bg-[var(--bg)] enabled:hover:text-text enabled:hover:border-[var(--border-hover)]'
          "
          :disabled="snapshotIndex === 0"
          @click="emit('toggle-diff', 'current')"
        >
          {{ t('snapshots.diffCurrent') }}
        </Button>
      </div>

      <div
        v-if="diffMode && !diffLoading && diffData"
        class="diff-view mb-3 rounded-md bg-[var(--bg)] px-3 py-2.5"
      >
        <div
          v-if="!diffHasChanges(diffData.diff)"
          class="diff-empty py-2 text-center text-[13px] text-text-muted"
        >
          {{ t('snapshots.diffNoChanges') }}
        </div>
        <SnapshotDiffView v-else :diff="diffData.diff" />
      </div>
      <div
        v-else-if="diffMode && diffLoading"
        class="snapshot-loading flex items-center gap-2.5 py-4 text-[13px] text-text-muted before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-full before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
      >
        {{ t('common.loading') }}
      </div>

      <div class="inspector-section mb-3 last:mb-0">
        <div
          class="inspector-section-title mb-2 text-[12px] font-semibold text-text-muted uppercase tracking-[0.3px]"
        >
          {{ t('snapshots.environment') }}
        </div>
        <div class="inspector-grid grid grid-cols-[1fr_1fr] gap-x-4 gap-y-1">
          <div class="inspector-field flex flex-col gap-px">
            <span class="inspector-field-label text-[13px] text-text-muted">{{
              t('snapshots.comfyuiVersion')
            }}</span>
            <span class="inspector-field-value truncate text-[14px] text-text select-text">{{
              detail.comfyuiVersion
            }}</span>
          </div>
          <div class="inspector-field flex flex-col gap-px">
            <span class="inspector-field-label text-[13px] text-text-muted">{{
              t('snapshots.releaseTag')
            }}</span>
            <span class="inspector-field-value truncate text-[14px] text-text select-text">{{
              detail.comfyui.releaseTag || '—'
            }}</span>
          </div>
          <div class="inspector-field flex flex-col gap-px">
            <span class="inspector-field-label text-[13px] text-text-muted">{{
              t('snapshots.variant')
            }}</span>
            <span class="inspector-field-value truncate text-[14px] text-text select-text">{{
              context?.variantLabel || detail.comfyui.variant || '—'
            }}</span>
          </div>
          <div class="inspector-field flex flex-col gap-px">
            <span class="inspector-field-label text-[13px] text-text-muted">{{
              t('snapshots.updateChannel')
            }}</span>
            <span class="inspector-field-value truncate text-[14px] text-text select-text">{{
              detail.updateChannel || context?.updateChannel || '—'
            }}</span>
          </div>
          <div class="inspector-field flex flex-col gap-px">
            <span class="inspector-field-label text-[13px] text-text-muted">{{
              t('snapshots.pythonVersion')
            }}</span>
            <span class="inspector-field-value truncate text-[14px] text-text select-text">{{
              detail.pythonVersion || context?.pythonVersion || '—'
            }}</span>
          </div>
          <div class="inspector-field flex flex-col gap-px">
            <span class="inspector-field-label text-[13px] text-text-muted">{{
              t('snapshots.capturedAt')
            }}</span>
            <span class="inspector-field-value truncate text-[14px] text-text select-text">{{
              formatDate(detail.createdAt)
            }}</span>
          </div>
        </div>
      </div>

      <div class="inspector-section mb-3 last:mb-0">
        <div
          class="inspector-section-title mb-2 text-[12px] font-semibold text-text-muted uppercase tracking-[0.3px] collapsible flex cursor-pointer items-center justify-between select-none"
          @click="nodesExpanded = !nodesExpanded"
        >
          <span
            >{{ t('snapshots.customNodes') }} ({{ detail.customNodes.length }})<InfoTooltip
              :text="t('tooltips.customNodes')"
              side="bottom"
          /></span>
          <span class="collapse-indicator text-[14px]">{{ nodesExpanded ? '▾' : '▸' }}</span>
        </div>
        <template v-if="nodesExpanded">
          <div
            v-if="detail.customNodes.length === 0"
            class="inspector-empty text-[14px] text-text-muted"
          >
            —
          </div>
          <div
            v-else
            class="node-list flex flex-col gap-[3px] max-h-60 overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
          >
            <input
              v-if="detail.customNodes.length > 5"
              v-model="nodeSearch"
              class="inspector-search mb-1.5 box-border w-full rounded-[5px] border border-solid border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-text focus:border-[var(--accent)] focus:outline-none"
              type="text"
              :placeholder="t('snapshots.searchNodes')"
            />
            <div
              v-if="filteredCustomNodes.length === 0 && nodeSearch"
              class="inspector-empty text-[14px] text-text-muted"
            >
              {{ t('snapshots.searchNoResults') }}
            </div>
            <template v-else>
              <div
                v-for="node in filteredCustomNodes"
                :key="node.id"
                class="inspector-node-row flex items-center gap-2 py-0.5 text-[13px]"
              >
                <span
                  class="inspector-node-status size-[7px] shrink-0 rounded-full"
                  :class="node.enabled ? 'bg-[var(--info)]' : 'bg-[var(--text-faint)]'"
                />
                <span class="inspector-node-name min-w-0 flex-1 truncate text-text select-text">{{
                  node.id
                }}</span>
                <span
                  class="inspector-node-type shrink-0 rounded-[3px] border border-solid border-[var(--border)] px-[5px] py-px text-[11px] font-semibold text-text-muted uppercase"
                  >{{ node.type }}</span
                >
                <span
                  class="inspector-node-version shrink-0 text-[13px] [font-family:monospace] text-text-muted select-text"
                  :title="formatNodeVersion(node)"
                  >{{ formatNodeVersion(node) }}</span
                >
              </div>
            </template>
          </div>
        </template>
      </div>

      <div class="inspector-section mb-3 last:mb-0">
        <div
          class="inspector-section-title mb-2 text-[12px] font-semibold text-text-muted uppercase tracking-[0.3px] collapsible flex cursor-pointer items-center justify-between select-none"
          @click="pipExpanded = !pipExpanded"
        >
          <span
            >{{ t('snapshots.pipPackages') }} ({{ detail.pipPackageCount }})<InfoTooltip
              :text="t('tooltips.pipPackages')"
              side="bottom"
          /></span>
          <span class="collapse-indicator text-[14px]">{{ pipExpanded ? '▾' : '▸' }}</span>
        </div>
        <template v-if="pipExpanded">
          <div
            class="pip-list flex flex-col gap-[3px] max-h-[300px] overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
          >
            <input
              v-model="pipSearch"
              class="inspector-search mb-1.5 box-border w-full rounded-[5px] border border-solid border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-text focus:border-[var(--accent)] focus:outline-none"
              type="text"
              :placeholder="t('snapshots.searchPackages')"
            />
            <div
              v-if="filteredPipPackages.length === 0 && pipSearch"
              class="inspector-empty text-[14px] text-text-muted"
            >
              {{ t('snapshots.searchNoResults') }}
            </div>
            <template v-else>
              <div
                v-for="[name, version] in filteredPipPackages"
                :key="name"
                class="inspector-pip-row flex items-center justify-between py-0.5 text-[13px]"
              >
                <span class="inspector-pip-name min-w-0 flex-1 truncate text-text select-text">{{
                  name
                }}</span>
                <span
                  class="inspector-pip-version ml-3 max-w-[50%] truncate [font-family:monospace] text-text-muted select-text"
                  :title="version"
                  >{{ version }}</span
                >
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
