<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import ToggleGroup from '@comfyorg/design-system/toggle-group/ToggleGroup'
import ToggleGroupItem from '@comfyorg/design-system/toggle-group/ToggleGroupItem'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  Download,
  FolderOpen,
  Pause,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Trash2,
  X
} from '@lucide/vue'
import DownloadThumbnail from '../components/DownloadThumbnail.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { fileLabel, modalSubtitle, statusKindClass } from '../lib/downloadFormatters'
import { revealInFolderLabel } from '../composables/usePlatform'
import type {
  PopupDownloadAction,
  PopupDownloadEntry as DownloadEntry,
  PopupDownloadsState as DownloadsState
} from '../../../preload/comfyTitlePopupPreload'

const { t } = useI18n()

type StatusFilter = 'all' | 'active' | 'completed' | 'error'

interface PopupBridge {
  platform?: string
  downloadsAction(action: PopupDownloadAction): void
  getDownloadThumbnail(savePath: string): Promise<string | null>
  close(): void
}

const bridge = (window as unknown as { __comfyTitlePopup?: PopupBridge }).__comfyTitlePopup
const revealLabel = computed(() => revealInFolderLabel(bridge?.platform))

const props = defineProps<{ state: DownloadsState }>()

const filter = ref<StatusFilter>('all')

const pointerTick = ref(0)
function onPointerMove(): void {
  pointerTick.value = (pointerTick.value + 1) & 0xff
}

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 30_000)
})
onUnmounted(() => clock && clearInterval(clock))

const TERMINAL = new Set<DownloadEntry['status']>(['completed', 'error', 'cancelled'])
function isTerminal(status: DownloadEntry['status']): boolean {
  return TERMINAL.has(status)
}

const ordered = computed<DownloadEntry[]>(() =>
  [...props.state.active, ...props.state.recent].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
  )
)
const finished = computed(() => ordered.value.filter((d) => isTerminal(d.status)))
const activeCount = computed(() => ordered.value.filter((d) => !isTerminal(d.status)).length)
const completedCount = computed(() => finished.value.filter((d) => d.status === 'completed').length)
const errorCount = computed(
  () => finished.value.filter((d) => d.status === 'error' || d.status === 'cancelled').length
)
const finishedCount = computed(() => finished.value.length)

const filtered = computed<DownloadEntry[]>(() => {
  switch (filter.value) {
    case 'active':
      return ordered.value.filter((d) => !isTerminal(d.status))
    case 'completed':
      return finished.value.filter((d) => d.status === 'completed')
    case 'error':
      return finished.value.filter((d) => d.status === 'error' || d.status === 'cancelled')
    default:
      return ordered.value
  }
})

function pause(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'pause', ref: d.id, url: d.url })
}
function resume(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'resume', ref: d.id, url: d.url })
}
function cancel(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'cancel', ref: d.id, url: d.url })
}
function retry(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'retry', ref: d.id, url: d.url })
}
function showInFolder(d: DownloadEntry): void {
  if (d.savePath) {
    bridge?.downloadsAction({
      action: 'show-in-folder',
      ref: d.id,
      url: d.url,
      savePath: d.savePath
    })
  }
}
function dismissOne(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'dismiss', ref: d.id, url: d.url })
}
function clearFinished(): void {
  bridge?.downloadsAction({ action: 'clear-finished' })
}

const visibleFilters = computed<{ key: StatusFilter; label: string }[]>(() => {
  const present: { key: StatusFilter; label: string }[] = []
  if (activeCount.value > 0) {
    present.push({ key: 'active', label: t('downloadsTab.filterActive') })
  }
  if (completedCount.value > 0) {
    present.push({ key: 'completed', label: t('downloadsTab.filterCompleted') })
  }
  if (errorCount.value > 0) {
    present.push({ key: 'error', label: t('downloadsTab.filterErrored') })
  }
  if (present.length < 2) return []
  return [{ key: 'all', label: t('downloadsTab.filterAll') }, ...present]
})

const fetchThumbnail = (savePath: string): Promise<string | null> =>
  bridge?.getDownloadThumbnail(savePath) ?? Promise.resolve(null)

function isCompletedImage(download: DownloadEntry): boolean {
  return download.isImage === true && download.status === 'completed'
}

function progressPercent(d: DownloadEntry): number {
  return Math.round(d.progress * 100)
}

const INDETERMINATE_ARC = 25
function isIndeterminate(d: DownloadEntry): boolean {
  if (d.status === 'pending') return true
  return d.status === 'downloading' && !(d.totalBytes && d.totalBytes > 0) && d.progress <= 0
}
function ringValue(d: DownloadEntry): number {
  return isIndeterminate(d) ? INDETERMINATE_ARC : progressPercent(d)
}

const footerStats = computed<string[]>(() =>
  [
    activeCount.value > 0 && t('downloadsTab.footerActive', { n: activeCount.value }),
    completedCount.value > 0 && t('downloadsTab.footerCompleted', { n: completedCount.value }),
    errorCount.value > 0 && t('downloadsTab.footerFailed', { n: errorCount.value })
  ].filter((stat): stat is string => typeof stat === 'string')
)
</script>

<template>
  <div
    class="dlm-panel [--download-success:#22c55e] [--download-error:#ef4444] [--download-warning:#f59e0b] relative flex size-full pr-12 text-neutral-100"
    @mousemove="onPointerMove"
  >
    <Button
      type="button"
      variant="muted-textonly"
      size="icon"
      class="dlm-close absolute top-0 right-0 z-2 size-9 rounded-full bg-white/10 text-white hover:bg-white/18 hover:text-white"
      :aria-label="t('common.close')"
      @click="bridge?.close()"
    >
      <X :size="18" />
    </Button>
    <div
      class="dlm-card box-border flex min-w-0 flex-auto flex-col overflow-hidden rounded-panel border border-solid border-[var(--modal-surface-border)] bg-[var(--modal-surface-bg)] [box-shadow:var(--shadow-highlight)]"
    >
      <header class="dlm-modal-header flex items-center justify-between gap-3 px-6 pt-5">
        <h2 class="dlm-title m-0 text-title font-semibold text-foreground">
          {{ t('downloadsTab.title') }}
        </h2>
      </header>

      <div class="dlm-modal-body flex min-h-0 flex-auto flex-col overflow-y-auto px-6 py-4">
        <div class="dlm-body flex min-h-full flex-auto flex-col">
          <ToggleGroup
            v-if="visibleFilters.length > 0"
            v-model="filter"
            type="single"
            :allow-empty="false"
            roving-focus
            class="dlm-filterbar mb-3 inline-flex shrink-0 gap-0.5 self-start rounded-[10px] bg-secondary p-[3px]"
            :aria-label="t('downloadsTab.filterAriaLabel')"
          >
            <ToggleGroupItem
              v-for="f in visibleFilters"
              :key="f.key"
              :value="f.key"
              class="dlm-filter-chip h-[26px] rounded-[7px] px-[11px] text-[13px] whitespace-nowrap hover:bg-transparent hover:text-foreground data-[state=on]:bg-accent data-[state=on]:hover:bg-accent"
              :class="{ active: filter === f.key }"
              >{{ f.label }}</ToggleGroupItem
            >
          </ToggleGroup>
          <EmptyState
            v-if="filtered.length === 0"
            class="dlm-empty flex-auto justify-center p-6"
            :icon="Download"
            :title="t('downloadsTab.empty')"
            :text="t('downloadsTab.emptyHint')"
          />

          <ul
            v-else
            :key="filter"
            class="dlm-list m-0 grid list-none grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-1.5 overflow-hidden rounded-[14px] bg-card p-0"
          >
            <li
              v-for="d in filtered"
              :key="d.id ?? d.url"
              class="dlm-row col-span-full grid min-h-18 grid-cols-subgrid items-center border-t border-solid border-[var(--chooser-surface-border)] px-[18px] py-2.5 first:border-t-0"
              :class="statusKindClass(d)"
            >
              <span
                :class="[
                  'dlm-leading mr-1.5 inline-flex flex-none items-center justify-center',
                  isCompletedImage(d)
                    ? 'dlm-thumb size-10 overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)]'
                    : 'size-8'
                ]"
              >
                <DownloadThumbnail :entry="d" :fetcher="fetchThumbnail">
                  <template #fallback>
                    <span
                      v-if="d.status === 'completed'"
                      class="dlm-icon-circle ok bg-[color-mix(in_oklab,var(--download-success)_15%,transparent)] text-[#22c55e] inline-flex size-8 items-center justify-center rounded-[50%]"
                    >
                      <CheckCircle2 :size="16" />
                    </span>
                    <span
                      v-else-if="d.status === 'error'"
                      class="dlm-icon-circle error bg-[color-mix(in_oklab,var(--download-error)_15%,transparent)] text-[#ef4444] inline-flex size-8 items-center justify-center rounded-[50%]"
                    >
                      <CircleAlert :size="16" />
                    </span>
                    <span
                      v-else-if="d.status === 'cancelled'"
                      class="dlm-icon-circle muted bg-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] text-[var(--text-muted,#9ca0a8)] inline-flex size-8 items-center justify-center rounded-[50%]"
                    >
                      <Ban :size="16" />
                    </span>
                    <span
                      v-else
                      class="dlm-icon-circle dlm-ring active relative inline-flex size-8 items-center justify-center rounded-[50%] text-foreground"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      :aria-valuenow="isIndeterminate(d) ? undefined : progressPercent(d)"
                      :aria-label="t('downloadsTab.progressAriaLabel', { name: fileLabel(d) })"
                    >
                      <svg
                        class="dlm-ring-svg absolute inset-0 -rotate-90"
                        :class="{
                          'animate-spin [animation-duration:900ms] motion-reduce:animate-none':
                            isIndeterminate(d)
                        }"
                        width="32"
                        height="32"
                        viewBox="0 0 32 32"
                        aria-hidden="true"
                      >
                        <circle
                          class="dlm-ring-track stroke-[color-mix(in_oklab,var(--foreground)_22%,transparent)]"
                          cx="16"
                          cy="16"
                          r="15"
                          fill="none"
                          stroke-width="2"
                        />
                        <circle
                          class="dlm-ring-arc stroke-foreground transition-[stroke-dashoffset] duration-300 ease-[ease] motion-reduce:transition-none"
                          :class="{ 'opacity-0': ringValue(d) === 0 }"
                          cx="16"
                          cy="16"
                          r="15"
                          fill="none"
                          stroke-width="2"
                          stroke-linecap="round"
                          pathLength="100"
                          stroke-dasharray="100 100"
                          :stroke-dashoffset="100 - ringValue(d)"
                        />
                      </svg>
                      <Pause v-if="d.status === 'paused'" :size="14" class="dlm-ring-icon" />
                      <Download v-else :size="14" class="dlm-ring-icon" />
                    </span>
                  </template>
                </DownloadThumbnail>
              </span>

              <div class="dlm-content flex min-w-0 flex-col gap-[3px] pr-2.5">
                <span
                  class="dlm-name truncate text-[13px] font-medium text-neutral-100"
                  :title="fileLabel(d)"
                  >{{ fileLabel(d) }}</span
                >
                <span
                  class="dlm-sub truncate text-[12px] text-text-muted tabular-nums"
                  :title="d.savePath"
                  >{{ modalSubtitle(d, now) }}</span
                >
              </div>

              <div class="dlm-primary flex items-center justify-end">
                <Button
                  v-if="d.status === 'downloading' && d.canPause !== false"
                  type="button"
                  variant="secondary"
                  size="icon"
                  class="dlm-btn"
                  :title="t('downloadsPopup.pause')"
                  :aria-label="t('downloadsPopup.pause')"
                  @click="pause(d)"
                >
                  <PauseCircle :size="14" />
                </Button>
                <Button
                  v-else-if="d.status === 'paused'"
                  type="button"
                  variant="inverted"
                  size="md"
                  class="dlm-btn"
                  :title="t('downloadsPopup.resume')"
                  :aria-label="t('downloadsPopup.resume')"
                  @click="resume(d)"
                >
                  <PlayCircle :size="14" />
                  {{ t('downloadsPopup.resume') }}
                </Button>
                <Button
                  v-else-if="d.status === 'error' || d.status === 'cancelled'"
                  type="button"
                  variant="secondary"
                  size="md"
                  class="dlm-btn"
                  :title="t('downloadsTab.retry')"
                  :aria-label="t('downloadsTab.retry')"
                  @click="retry(d)"
                >
                  <RotateCcw :size="14" />
                  {{ t('downloadsTab.retry') }}
                </Button>
                <Button
                  v-else-if="d.status === 'completed' && d.savePath"
                  type="button"
                  variant="secondary"
                  size="md"
                  class="dlm-btn"
                  @click="showInFolder(d)"
                >
                  <FolderOpen :size="14" />
                  {{ revealLabel }}
                </Button>
              </div>

              <div class="dlm-trailing flex w-8 items-center justify-center">
                <Button
                  type="button"
                  variant="muted-textonly"
                  size="icon"
                  class="dlm-x opacity-50 hover:opacity-100 focus-visible:opacity-100"
                  :title="
                    isTerminal(d.status) ? t('downloadsPopup.remove') : t('downloadsPopup.cancel')
                  "
                  :aria-label="
                    isTerminal(d.status) ? t('downloadsPopup.remove') : t('downloadsPopup.cancel')
                  "
                  @click="isTerminal(d.status) ? dismissOne(d) : cancel(d)"
                >
                  <X :size="14" />
                </Button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <footer
        v-if="ordered.length > 0"
        class="dlm-modal-footer border-t border-solid border-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] px-6 pt-3 pb-4"
      >
        <div class="dlm-footer flex w-full items-center justify-between">
          <span class="dlm-footer-stats flex items-center gap-1.5 text-[12px] text-text-muted">
            <template v-for="(stat, i) in footerStats" :key="stat">
              <span v-if="i > 0" class="dlm-footer-sep opacity-40">&middot;</span>
              <span class="dlm-footer-stat tabular-nums">{{ stat }}</span>
            </template>
          </span>
          <Button
            v-if="finishedCount > 0"
            type="button"
            variant="secondary"
            size="md"
            class="dlm-clear-btn"
            @click="clearFinished"
          >
            <Trash2 :size="14" />
            {{ t('downloadsTab.clearFinished') }}
          </Button>
        </div>
      </footer>
    </div>
  </div>
</template>
