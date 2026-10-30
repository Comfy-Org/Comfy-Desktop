<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Trash2,
  X,
  XCircle
} from 'lucide-vue-next'
import DownloadThumbnail from '../components/DownloadThumbnail.vue'
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

// Actions address a row by stable job id (`ref`), with the URL riding along
// as a compatibility fallback.
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

type StatusBadge = { label: string; cls: string }

const statusBadgeFor = computed<Partial<Record<DownloadEntry['status'], StatusBadge>>>(() => ({
  error: {
    label: t('downloadsTab.badgeFailed'),
    cls: 'dlm-badge-error bg-[color-mix(in_oklab,var(--download-error)_15%,transparent)] text-[#ef4444]'
  },
  cancelled: {
    label: t('downloadsTab.badgeCancelled'),
    cls: 'dlm-badge-muted bg-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] text-text-muted'
  }
}))
</script>

<template>
  <!-- Preserve runtime color mixing instead of build-time RGBA simplification. -->
  <div
    class="dlm-panel [--download-success:#22c55e] [--download-error:#ef4444] [--download-warning:#f59e0b] flex size-full flex-col text-neutral-100"
    @mousemove="onPointerMove"
  >
    <header
      class="dlm-modal-header flex items-center justify-between gap-3 border-b border-solid border-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] px-6 pt-5 pb-3"
    >
      <h2
        class="dlm-title m-0 font-display text-[length:var(--takeover-fs-h3,18px)] font-bold text-neutral-100"
      >
        {{ t('downloadsTab.title') }}
      </h2>
      <button
        type="button"
        class="dlm-close inline-flex size-8 flex-none items-center justify-center rounded-lg border border-solid border-transparent bg-[color-mix(in_oklab,var(--text)_4%,transparent)] p-0 text-neutral-100 opacity-70 cursor-pointer transition-[background,border-color,opacity] duration-[120ms] ease-[ease] hover:border-[color-mix(in_oklab,var(--neutral-100)_44%,transparent)] hover:bg-[color-mix(in_oklab,var(--neutral-950)_85%,transparent)] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid]"
        :aria-label="t('common.close')"
        @click="bridge?.close()"
      >
        <X :size="18" />
      </button>
    </header>

    <div class="dlm-modal-body flex min-h-0 flex-auto flex-col overflow-y-auto px-6 py-4">
      <div class="dlm-body flex min-h-full flex-auto flex-col">
        <div
          v-if="visibleFilters.length > 0"
          class="dlm-filterbar sticky -top-4 z-2 -mx-6 -mt-4 mb-2 flex gap-1.5 border-b border-solid border-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] bg-[var(--modal-surface-bg,#27202d)] px-6 pt-3 pb-2.5"
          role="tablist"
          :aria-label="t('downloadsTab.filterAriaLabel')"
        >
          <button
            v-for="f in visibleFilters"
            :key="f.key"
            type="button"
            class="dlm-filter-chip inline-flex flex-1 items-center justify-center rounded-md border border-solid px-2 py-[5px] text-[12px] text-inherit cursor-pointer transition-[opacity,background,border-color] duration-150 ease-[ease] hover:opacity-100"
            :class="
              filter === f.key
                ? 'active bg-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] border-[color-mix(in_oklab,var(--neutral-100)_22%,transparent)] opacity-100'
                : 'bg-transparent border-[color-mix(in_oklab,var(--neutral-100)_12%,transparent)] opacity-65'
            "
            role="tab"
            :aria-selected="filter === f.key"
            @click="filter = f.key"
          >
            {{ f.label }}
          </button>
        </div>

        <div
          v-if="filtered.length === 0"
          class="dlm-empty flex flex-auto flex-col items-center justify-center gap-2 p-6 text-center"
        >
          <div
            class="dlm-empty-icon mb-1 flex size-14 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--neutral-100)_5%,transparent)] text-text-muted"
          >
            <ArrowDownToLine :size="28" />
          </div>
          <span class="dlm-empty-title text-[14px] font-semibold text-neutral-100">{{
            t('downloadsTab.empty')
          }}</span>
          <span class="dlm-empty-hint text-[13px] text-text-muted">{{
            t('downloadsTab.emptyHint')
          }}</span>
        </div>

        <ul v-else :key="filter" class="dlm-list m-0 flex list-none flex-col gap-0.5 p-0">
          <li
            v-for="d in filtered"
            :key="d.id ?? d.url"
            class="dlm-row flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-[background] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_oklab,var(--neutral-100)_4%,transparent)]"
            :class="[
              statusKindClass(d),
              {
                '[--download-close-opacity:0] hover:[--download-close-opacity:0.5]':
                  d.status === 'pending' || d.status === 'downloading'
              }
            ]"
          >
            <span
              :class="[
                'dlm-leading inline-flex flex-none items-center justify-center',
                isCompletedImage(d)
                  ? 'dlm-thumb size-10 overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)]'
                  : 'size-9'
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
                    v-else-if="d.status === 'paused'"
                    class="dlm-icon-circle warn bg-[color-mix(in_oklab,var(--download-warning)_15%,transparent)] text-[#f59e0b] inline-flex size-8 items-center justify-center rounded-[50%]"
                  >
                    <PauseCircle :size="16" />
                  </span>
                  <span
                    v-else
                    class="dlm-icon-circle active bg-[color-mix(in_oklab,var(--accent,#60a5fa)_15%,transparent)] text-[var(--accent,#60a5fa)] inline-flex size-8 items-center justify-center rounded-[50%]"
                  >
                    <LoaderCircle
                      :size="16"
                      class="dlm-spin animate-spin [animation-duration:900ms] motion-reduce:animate-none"
                    />
                  </span>
                </template>
              </DownloadThumbnail>
            </span>

            <div class="dlm-content flex min-w-0 flex-auto flex-col gap-[3px]">
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
              <div
                v-if="d.status === 'downloading' || d.status === 'paused' || d.status === 'pending'"
                class="dlm-bar mt-0.5 h-[3px] overflow-hidden rounded-[2px] bg-[color-mix(in_oklab,var(--neutral-100)_10%,transparent)]"
              >
                <div
                  class="dlm-bar-fill h-full rounded-[2px] transition-[width] duration-300 ease-[ease]"
                  :class="
                    d.status === 'pending'
                      ? 'indeterminate bg-[repeating-linear-gradient(90deg,var(--accent,#60a5fa),var(--accent,#60a5fa)_8px,color-mix(in_oklab,var(--accent,#60a5fa)_50%,transparent)_8px,color-mix(in_oklab,var(--accent,#60a5fa)_50%,transparent)_16px)] animate-[dlm-shimmer_1.2s_linear_infinite]'
                      : d.status === 'paused'
                        ? 'paused bg-[#f59e0b]'
                        : 'bg-[var(--accent,#60a5fa)]'
                  "
                  :style="
                    d.status === 'pending' ? { width: '100%' } : { width: `${progressPercent(d)}%` }
                  "
                />
              </div>
            </div>

            <div class="dlm-actions flex flex-none items-center gap-1.5">
              <span
                v-if="statusBadgeFor[d.status]"
                class="dlm-badge flex-none rounded px-[7px] py-[3px] text-[11px] leading-none font-semibold whitespace-nowrap"
                :class="statusBadgeFor[d.status]!.cls"
              >
                {{ statusBadgeFor[d.status]!.label }}
              </span>

              <span
                v-if="d.status === 'downloading'"
                class="dlm-pct min-w-9 text-right text-[13px] font-bold text-[var(--accent,#60a5fa)] tabular-nums"
              >
                {{ progressPercent(d) }}%
              </span>
              <button
                v-if="d.status === 'downloading'"
                type="button"
                class="dlm-btn border-[color-mix(in_oklab,var(--neutral-100)_12%,transparent)] bg-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)] text-inherit hover:border-[color-mix(in_oklab,var(--neutral-100)_20%,transparent)] hover:bg-[color-mix(in_oklab,var(--neutral-100)_10%,transparent)] inline-flex items-center gap-1 rounded-md border border-solid px-2.5 py-1 text-[12px] whitespace-nowrap cursor-pointer transition-[background,border-color] duration-[120ms] ease-[ease]"
                :title="t('downloadsPopup.pause')"
                :aria-label="t('downloadsPopup.pause')"
                @click="pause(d)"
              >
                <PauseCircle :size="14" />
              </button>
              <button
                v-if="d.status === 'paused'"
                type="button"
                class="dlm-btn dlm-btn-primary border-transparent bg-[var(--accent,#3b82f6)] text-background hover:border-transparent hover:bg-[var(--accent-hover,#2563eb)] inline-flex items-center gap-1 rounded-md border border-solid px-2.5 py-1 text-[12px] whitespace-nowrap cursor-pointer transition-[background,border-color] duration-[120ms] ease-[ease]"
                :title="t('downloadsPopup.resume')"
                :aria-label="t('downloadsPopup.resume')"
                @click="resume(d)"
              >
                <PlayCircle :size="14" />
                {{ t('downloadsPopup.resume') }}
              </button>
              <button
                v-if="d.status === 'error' || d.status === 'cancelled'"
                type="button"
                class="dlm-btn border-[color-mix(in_oklab,var(--neutral-100)_12%,transparent)] bg-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)] text-inherit hover:border-[color-mix(in_oklab,var(--neutral-100)_20%,transparent)] hover:bg-[color-mix(in_oklab,var(--neutral-100)_10%,transparent)] inline-flex items-center gap-1 rounded-md border border-solid px-2.5 py-1 text-[12px] whitespace-nowrap cursor-pointer transition-[background,border-color] duration-[120ms] ease-[ease]"
                :title="t('downloadsTab.retry')"
                :aria-label="t('downloadsTab.retry')"
                @click="retry(d)"
              >
                <RotateCcw :size="14" />
                {{ t('downloadsTab.retry') }}
              </button>
              <button
                v-if="d.status === 'completed' && d.savePath"
                type="button"
                class="dlm-btn border-[color-mix(in_oklab,var(--neutral-100)_12%,transparent)] bg-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)] text-inherit hover:border-[color-mix(in_oklab,var(--neutral-100)_20%,transparent)] hover:bg-[color-mix(in_oklab,var(--neutral-100)_10%,transparent)] inline-flex items-center gap-1 rounded-md border border-solid px-2.5 py-1 text-[12px] whitespace-nowrap cursor-pointer transition-[background,border-color] duration-[120ms] ease-[ease]"
                @click="showInFolder(d)"
              >
                <FolderOpen :size="14" />
                {{ revealLabel }}
              </button>

              <button
                v-if="!isTerminal(d.status)"
                type="button"
                class="dlm-x inline-flex size-6 items-center justify-center rounded-md border-none bg-transparent p-0 text-text-muted opacity-[var(--download-close-opacity,0.5)] cursor-pointer transition-[opacity,background,color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_oklab,var(--neutral-100)_10%,transparent)] hover:text-neutral-100 hover:opacity-100"
                :title="t('downloadsPopup.cancel')"
                :aria-label="t('downloadsPopup.cancel')"
                @click="cancel(d)"
              >
                <XCircle :size="14" />
              </button>
              <button
                v-if="isTerminal(d.status)"
                type="button"
                class="dlm-x inline-flex size-6 items-center justify-center rounded-md border-none bg-transparent p-0 text-text-muted opacity-[var(--download-close-opacity,0.5)] cursor-pointer transition-[opacity,background,color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_oklab,var(--neutral-100)_10%,transparent)] hover:text-neutral-100 hover:opacity-100"
                :title="t('downloadsPopup.remove')"
                :aria-label="t('downloadsPopup.remove')"
                @click="dismissOne(d)"
              >
                <X :size="14" />
              </button>
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
          <span v-if="activeCount > 0" class="dlm-footer-stat tabular-nums">
            {{ t('downloadsTab.footerActive', { n: activeCount }) }}
          </span>
          <span v-if="activeCount > 0 && completedCount > 0" class="dlm-footer-sep opacity-40"
            >&middot;</span
          >
          <span v-if="completedCount > 0" class="dlm-footer-stat tabular-nums">
            {{ t('downloadsTab.footerCompleted', { n: completedCount }) }}
          </span>
        </span>
        <button
          v-if="finishedCount > 0"
          type="button"
          class="dlm-clear-btn inline-flex items-center gap-1 rounded-md border border-solid border-[color-mix(in_oklab,var(--neutral-100)_10%,transparent)] bg-transparent px-2.5 py-[5px] text-[12px] text-text-muted cursor-pointer transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)] hover:text-neutral-100"
          @click="clearFinished"
        >
          <Trash2 :size="13" />
          {{ t('downloadsTab.clearFinished') }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style>
/* The pending download fills the entire bar with moving stripes. */
@keyframes dlm-shimmer {
  to {
    background-position: 32px 0;
  }
}
</style>
