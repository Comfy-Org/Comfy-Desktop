<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  PauseCircle,
  // TODO(brand-cleanup): PlayCircle was the Resume action icon — redesign skips it; restore if Pause/Resume comes back.
  // PlayCircle,
  RotateCcw,
  X
} from 'lucide-vue-next'
import { fileLabel, statusKindClass, statusLine } from '../lib/downloadFormatters'
import { revealInFolderLabel } from '../composables/usePlatform'
import DownloadThumbnail from '../components/DownloadThumbnail.vue'

const { t } = useI18n()

/**
 * Live downloads tray view. Stateless; `TitlePopupApp` owns the subscription and passes
 * the `DownloadsState` as a prop, and per-entry actions dispatch back over IPC. Entry /
 * state / action shapes are mirrored inline from `comfyTitlePopupPreload.ts`.
 */

interface DownloadEntry {
  /** Stable per-job identifier; preferred over `url` for actions. */
  id?: string
  url: string
  filename: string
  directory?: string
  savePath?: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
  createdAt?: number
  isImage?: boolean
}

interface DownloadsState {
  active: DownloadEntry[]
  recent: DownloadEntry[]
}

type DownloadAction =
  | { action: 'pause'; ref?: string; url: string }
  | { action: 'resume'; ref?: string; url: string }
  | { action: 'cancel'; ref?: string; url: string }
  | { action: 'show-in-folder'; ref?: string; url: string; savePath: string }
  | { action: 'dismiss'; ref?: string; url: string }
  | { action: 'retry'; ref?: string; url: string }
  | { action: 'clear-finished' }

type PopupSettingsTab = 'comfy' | 'directories' | 'downloads' | 'global'

interface PopupBridge {
  platform?: string
  downloadsAction(action: DownloadAction): void
  openSettingsTab(tab: PopupSettingsTab): void
  openDownloadsModal(): void
  getDownloadThumbnail(savePath: string): Promise<string | null>
}

const bridge = (window as unknown as { __comfyTitlePopup?: PopupBridge }).__comfyTitlePopup
const revealLabel = computed(() => revealInFolderLabel(bridge?.platform))

const props = defineProps<{ state: DownloadsState }>()

const TERMINAL_STATUSES = new Set<DownloadEntry['status']>(['completed', 'error', 'cancelled'])

function isTerminal(d: DownloadEntry): boolean {
  return TERMINAL_STATUSES.has(d.status)
}

const fetchThumbnail = (savePath: string): Promise<string | null> =>
  bridge?.getDownloadThumbnail(savePath) ?? Promise.resolve(null)

/** A completed image asset reserves the enlarged rounded preview box (the
 *  thumbnail itself may still fail to load, falling back to the status icon). */
function isCompletedImage(download: DownloadEntry): boolean {
  return download.isImage === true && download.status === 'completed'
}

/** Combined list newest-first by `createdAt` so a download staying in place across
 *  active → terminal isn't split across the IPC's active/recent buckets. */
const orderedEntries = computed<DownloadEntry[]>(() =>
  [...props.state.active, ...props.state.recent].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
  )
)

// Actions address a row by stable job id (`ref`); the URL rides along as a
// compatibility fallback.
function cancel(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'cancel', ref: d.id, url: d.url })
}
// TODO(brand-cleanup): redesign skips pause/resume — keep handlers wired for an easy restore.
// function pause(d: DownloadEntry): void {
//   bridge?.downloadsAction({ action: 'pause', ref: d.id, url: d.url })
// }
// function resume(d: DownloadEntry): void {
//   bridge?.downloadsAction({ action: 'resume', ref: d.id, url: d.url })
// }
function showInFolder(d: DownloadEntry, savePath: string): void {
  bridge?.downloadsAction({ action: 'show-in-folder', ref: d.id, url: d.url, savePath })
}
function dismiss(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'dismiss', ref: d.id, url: d.url })
}
function retry(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'retry', ref: d.id, url: d.url })
}
function viewAllDownloads(): void {
  bridge?.openDownloadsModal()
}

/** Right-edge X cancels an in-flight entry or removes a terminal row. */
function handleClose(d: DownloadEntry): void {
  if (isTerminal(d)) dismiss(d)
  else cancel(d)
}

function closeLabel(d: DownloadEntry): string {
  return isTerminal(d) ? t('downloadsPopup.remove') : t('downloadsPopup.cancel')
}

/** Subtitle: full bytes/speed/ETA for active rows; "Show in Finder" for terminal rows with a path. */
function subtitle(d: DownloadEntry): string {
  if (d.status === 'downloading' || d.status === 'pending') {
    return statusLine(d)
  }
  if (d.status === 'paused') {
    return `${t('downloadsPopup.pause')} · ${statusLine(d)}`
  }
  if (d.status === 'completed' && d.savePath) {
    return revealLabel.value
  }
  if ((d.status === 'error' || d.status === 'cancelled') && d.savePath) {
    return revealLabel.value
  }
  return statusLine(d)
}

/** Whole-row click opens the file location for completed entries with a save path. */
function handleRowClick(d: DownloadEntry, event: MouseEvent): void {
  if ((event.target as HTMLElement).closest('.downloads-item-close, .downloads-item-retry')) return
  if (d.status === 'completed' && d.savePath) showInFolder(d, d.savePath)
}

function isRowClickable(d: DownloadEntry): boolean {
  return d.status === 'completed' && !!d.savePath
}

/** Inline progress-fill gradient where the card itself reads as the progress bar. */
function progressStyle(d: DownloadEntry): Record<string, string> | undefined {
  if (d.status !== 'downloading' && d.status !== 'pending') return undefined
  const pct = d.status === 'pending' ? 0 : Math.max(0, Math.min(1, d.progress)) * 100
  // ~1% transition so the leading edge reads as a crisp line; collapses to solid at 100%.
  const next = Math.min(100, pct + 0.91)
  return {
    background: `linear-gradient(90deg, var(--downloads-card) 0%, var(--downloads-card) ${pct}%, var(--downloads-bar-rest) ${next}%)`
  }
}

// TODO(brand-cleanup): redesign skips Pause/Resume in the popover. The
// bridge handlers + i18n strings remain so re-introducing them is just
// reinstating the buttons below.
</script>

<template>
  <div
    class="downloads flex size-full flex-col bg-neutral-800 [--downloads-card:var(--color-card-hover)] [--downloads-bar-rest:var(--color-card)]"
  >
    <header
      class="downloads-head flex flex-none items-center justify-between gap-2 border-b border-solid border-white/10 px-4 py-3"
    >
      <h2 class="downloads-title m-0 text-[14px] font-bold text-neutral-100">
        {{ t('downloadsPopup.title') }}
      </h2>
    </header>

    <div
      v-if="orderedEntries.length === 0"
      class="downloads-empty px-4 py-6 text-center text-[12px] text-text-muted"
    >
      {{ t('downloadsPopup.empty') }}
    </div>

    <ul
      v-else
      class="downloads-list m-0 flex min-h-0 flex-auto list-none flex-col gap-2 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <li
        v-for="d in orderedEntries"
        :key="d.id ?? d.url"
        class="downloads-item flex items-center gap-2 rounded-lg px-4 py-3 transition-[background] duration-[220ms] ease-[ease]"
        :class="[
          statusKindClass(d),
          d.status === 'error' || d.status === 'cancelled'
            ? 'bg-[color-mix(in_srgb,var(--downloads-card)_50%,transparent)]'
            : 'bg-[var(--downloads-card)]',
          {
            'is-finished': isTerminal(d),
            'is-clickable cursor-pointer hover:bg-[color-mix(in_srgb,var(--downloads-card)_85%,var(--neutral-500))]':
              isRowClickable(d)
          }
        ]"
        :style="progressStyle(d)"
        @click="(e) => handleRowClick(d, e)"
      >
        <span
          class="downloads-item-icon inline-flex grow-0 shrink-0 items-center justify-center text-neutral-100"
          :class="
            isCompletedImage(d)
              ? 'is-image size-9 basis-9 self-center overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--downloads-bar-rest)_60%,transparent)]'
              : 'mt-0.5 size-4 basis-4 self-start'
          "
        >
          <DownloadThumbnail :entry="d" :fetcher="fetchThumbnail">
            <template #fallback>
              <CircleCheck v-if="d.status === 'completed'" :size="16" class="ok text-neutral-100" />
              <CircleAlert
                v-else-if="d.status === 'error' || d.status === 'cancelled'"
                :size="16"
                class="bad text-[#ff5454]"
              />
              <PauseCircle v-else-if="d.status === 'paused'" :size="16" />
              <LoaderCircle
                v-else
                :size="16"
                class="spin animate-spin [animation-duration:900ms] motion-reduce:animate-none"
              />
            </template>
          </DownloadThumbnail>
        </span>
        <div class="downloads-item-text flex min-w-0 flex-auto flex-col gap-0">
          <span
            class="downloads-item-name truncate text-[14px] leading-5 text-neutral-100"
            :title="fileLabel(d)"
            >{{ fileLabel(d) }}</span
          >
          <span class="downloads-item-sub truncate text-[12px] leading-[1.2] text-text-muted">{{
            subtitle(d)
          }}</span>
        </div>
        <!-- TODO(brand-cleanup): redesign skips Pause/Resume — restore here if needed.
        <button
          v-if="d.status === 'downloading'"
          type="button"
          :aria-label="t('downloadsPopup.pause')"
          @click.stop="pause(d)"
        ><PauseCircle :size="14" /></button>
        <button
          v-if="d.status === 'paused'"
          type="button"
          :aria-label="t('downloadsPopup.resume')"
          @click.stop="resume(d)"
        ><PlayCircle :size="14" /></button>
        -->
        <button
          v-if="d.status === 'error' || d.status === 'cancelled'"
          type="button"
          class="downloads-item-retry ml-1 inline-flex size-6 flex-none items-center justify-center rounded-md border-none bg-transparent p-0 text-text-muted cursor-pointer transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_srgb,var(--neutral-500)_35%,transparent)] hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-50 focus-visible:[outline-style:solid]"
          :title="t('downloadsPopup.retry')"
          :aria-label="t('downloadsPopup.retry')"
          @click.stop="retry(d)"
        >
          <RotateCcw :size="16" />
        </button>
        <button
          type="button"
          class="downloads-item-close ml-1 inline-flex size-6 flex-none items-center justify-center rounded-md border-none bg-transparent p-0 text-text-muted cursor-pointer transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_srgb,var(--neutral-500)_35%,transparent)] hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-50 focus-visible:[outline-style:solid]"
          :title="closeLabel(d)"
          :aria-label="closeLabel(d)"
          @click.stop="handleClose(d)"
        >
          <X :size="16" />
        </button>
      </li>
    </ul>

    <footer
      class="downloads-foot flex flex-none items-center border-t border-solid border-white/10 p-2"
    >
      <button
        type="button"
        class="downloads-link flex flex-auto items-center rounded-md border-none bg-transparent p-2 text-left text-[14px] text-neutral-100 cursor-pointer transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_srgb,var(--neutral-500)_25%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-50 focus-visible:[outline-style:solid]"
        @click="viewAllDownloads"
      >
        {{ t('downloadsPopup.viewAllInSettings') }}
      </button>
    </footer>
  </div>
</template>
