<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Ban,
  CircleAlert,
  CircleCheck,
  FolderOpen,
  LoaderCircle,
  PauseCircle,
  RotateCcw,
  X
} from '@lucide/vue'
import { fileLabel, statusKindClass, statusLine } from '../lib/downloadFormatters'
import { revealInFolderLabel } from '../composables/usePlatform'
import DownloadThumbnail from '../components/DownloadThumbnail.vue'

const { t } = useI18n()

interface DownloadEntry {
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

function isCompletedImage(download: DownloadEntry): boolean {
  return download.isImage === true && download.status === 'completed'
}

const orderedEntries = computed<DownloadEntry[]>(() =>
  [...props.state.active, ...props.state.recent].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
  )
)

function cancel(d: DownloadEntry): void {
  bridge?.downloadsAction({ action: 'cancel', ref: d.id, url: d.url })
}
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

function handleClose(d: DownloadEntry): void {
  if (isTerminal(d)) dismiss(d)
  else cancel(d)
}

function closeLabel(d: DownloadEntry): string {
  return isTerminal(d) ? t('downloadsPopup.remove') : t('downloadsPopup.cancel')
}

function subtitle(d: DownloadEntry): string {
  if (d.status === 'paused') {
    return `${t('downloadsPopup.pause')} · ${statusLine(d)}`
  }
  return statusLine(d, { completedShowsSize: true })
}

function canRetry(d: DownloadEntry): boolean {
  return d.status === 'error' || d.status === 'cancelled'
}

function handleRowClick(d: DownloadEntry, event: MouseEvent): void {
  if ((event.target as HTMLElement).closest('.downloads-item-action, .downloads-item-close')) return
  if (d.status === 'completed' && d.savePath) showInFolder(d, d.savePath)
}

function isRowClickable(d: DownloadEntry): boolean {
  return d.status === 'completed' && !!d.savePath
}

const list = useTemplateRef<HTMLElement>('list')

function onRowKeydown(d: DownloadEntry, event: KeyboardEvent): void {
  const row = event.currentTarget as HTMLElement
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const rows = [...(list.value?.querySelectorAll<HTMLElement>('.downloads-item') ?? [])]
    const next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    return
  }
  if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return
  if (!isRowClickable(d) || !d.savePath) return
  event.preventDefault()
  showInFolder(d, d.savePath)
}

function progressStyle(d: DownloadEntry): Record<string, string> | undefined {
  if (d.status !== 'downloading' && d.status !== 'pending') return undefined
  const pct = d.status === 'pending' ? 0 : Math.max(0, Math.min(1, d.progress)) * 100
  const next = Math.min(100, pct + 0.91)
  return {
    background: `linear-gradient(90deg, var(--downloads-card) 0%, var(--downloads-card) ${pct}%, var(--downloads-bar-rest) ${next}%)`
  }
}
</script>

<template>
  <div
    class="downloads flex size-full flex-col bg-neutral-800 [--downloads-bar-rest:var(--color-card)] [--downloads-card:var(--color-card-hover)] [--downloads-row-hover:var(--color-card-hover)]"
  >
    <header
      class="downloads-head flex flex-none items-baseline justify-between gap-2 px-4 pt-4 pb-3"
    >
      <h2
        class="downloads-title m-0 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase"
      >
        {{ t('downloadsPopup.title') }}
      </h2>
      <Button
        type="button"
        variant="link"
        size="unset"
        class="downloads-link rounded-sm text-[12px] font-normal"
        :aria-label="t('downloadsPopup.viewAllLabel')"
        @click="viewAllDownloads"
      >
        {{ t('downloadsPopup.viewAll') }}
      </Button>
    </header>

    <div
      v-if="orderedEntries.length === 0"
      class="downloads-empty px-4 pt-4 pb-6 text-center text-[12px] text-text-muted"
    >
      {{ t('downloadsPopup.empty') }}
    </div>

    <ul
      v-else
      ref="list"
      class="downloads-list mx-4 mt-0 mb-4 flex min-h-0 flex-auto list-none flex-col overflow-y-auto rounded-[14px] bg-card p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <li
        v-for="d in orderedEntries"
        :key="d.id ?? d.url"
        class="downloads-item group relative flex flex-none items-center gap-2 border-t border-solid border-[var(--chooser-surface-border)] py-3 pr-2.5 pl-[18px] outline-none first:rounded-t-[14px] first:border-t-0 last:rounded-b-[14px] focus-within:bg-[var(--downloads-row-hover)] hover:bg-[var(--downloads-row-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        :class="[
          statusKindClass(d),
          {
            'is-finished': isTerminal(d),
            'is-clickable cursor-pointer': isRowClickable(d)
          }
        ]"
        :style="progressStyle(d)"
        tabindex="0"
        @click="(e) => handleRowClick(d, e)"
        @keydown="(e) => onRowKeydown(d, e)"
      >
        <span
          class="downloads-item-icon inline-flex shrink-0 grow-0 items-center justify-center text-neutral-100"
          :class="
            isCompletedImage(d)
              ? 'is-image size-9 basis-9 self-center overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--downloads-bar-rest)_60%,transparent)]'
              : 'mt-0.5 size-4 basis-4 self-start'
          "
        >
          <DownloadThumbnail :entry="d" :fetcher="fetchThumbnail">
            <template #fallback>
              <CircleCheck v-if="d.status === 'completed'" :size="16" class="ok text-neutral-100" />
              <CircleAlert v-else-if="d.status === 'error'" :size="16" class="bad text-[#ff5454]" />
              <Ban v-else-if="d.status === 'cancelled'" :size="16" class="muted text-text-muted" />
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
        <div
          v-if="canRetry(d) || isRowClickable(d)"
          class="downloads-item-action hidden shrink-0 items-center group-focus-within:flex group-hover:flex"
        >
          <Button
            v-if="canRetry(d)"
            type="button"
            variant="secondary"
            size="md"
            class="downloads-item-retry"
            @click.stop="retry(d)"
          >
            <RotateCcw :size="14" />
            {{ t('downloadsPopup.retry') }}
          </Button>
          <Button
            v-else-if="d.savePath"
            type="button"
            variant="secondary"
            size="icon"
            class="downloads-item-reveal"
            :title="revealLabel"
            :aria-label="revealLabel"
            @click.stop="showInFolder(d, d.savePath)"
          >
            <FolderOpen :size="16" aria-hidden="true" />
          </Button>
        </div>
        <Button
          type="button"
          variant="muted-textonly"
          size="icon"
          class="downloads-item-close shrink-0"
          :title="closeLabel(d)"
          :aria-label="closeLabel(d)"
          @click.stop="handleClose(d)"
        >
          <X :size="16" />
        </Button>
      </li>
    </ul>
  </div>
</template>
