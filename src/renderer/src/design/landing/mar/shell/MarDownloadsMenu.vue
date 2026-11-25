<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowDownToLine,
  Ban,
  CircleAlert,
  CircleCheck,
  FolderSearch,
  LoaderCircle,
  Pause,
  PauseCircle,
  Play,
  RotateCcw,
  X
} from 'lucide-vue-next'
import { PopoverRoot, PopoverTrigger } from 'reka-ui'
import PopoverContent from '../../ui/PopoverContent.vue'
import { toast } from '../../useProto'
import {
  DOWNLOAD_COPY,
  cancel,
  fileRowsOf,
  markSeen,
  needsAttention,
  overallProgress,
  pause,
  remove as removeDownload,
  resume,
  retry,
  templateDownloads,
  trayLabel,
  unseenDone,
  type DownloadFileRow
} from '../downloads/templateDownloads'
import DownloadRing from '../downloads/DownloadRing.vue'

type RowStatus = DownloadFileRow['status']

interface Row {
  key: string
  name: string
  status: RowStatus
  progress: number
  line: string
  act?: (action: 'pause' | 'resume' | 'retry' | 'close') => void
}

const extras = ref<Row[]>([
  {
    key: 'flux',
    name: 'flux1-dev-fp8.safetensors',
    status: 'downloading',
    progress: 0.52,
    line: '52% · 48.0 MB/s · 2 min left'
  },
  {
    key: 'vae',
    name: 'ae.safetensors',
    status: 'done',
    progress: 1,
    line: 'Downloaded · 319.4 MB'
  }
])
const open = ref(false)
watch(open, (v) => v && markSeen())
watch(unseenDone, (v) => v && open.value && markSeen())

const tplRows = computed<Row[]>(() =>
  templateDownloads.list.flatMap(fileRowsOf).map((r) => ({
    key: r.key,
    name: r.name,
    status: r.status,
    progress: r.progress,
    line: r.line,
    act: (action) => {
      const id = r.download.id
      if (action === 'pause') pause(id)
      else if (action === 'resume') resume(id)
      else if (action === 'retry') retry(id)
      else if (terminal(r.status)) removeDownload(id)
      else cancel(id)
    }
  }))
)
const rows = computed(() => [...tplRows.value, ...extras.value])
const live = computed(() =>
  templateDownloads.list.filter((d) => d.status === 'downloading' || d.status === 'paused')
)
const percent = computed(() => Math.floor(overallProgress.value * 100))

const terminal = (s: RowStatus): boolean => s === 'done' || s === 'failed' || s === 'cancelled'
const canRetry = (s: RowStatus): boolean => s === 'failed' || s === 'cancelled'
const hasPauseToggle = (s: RowStatus): boolean => s === 'downloading' || s === 'paused'
const keepsActionInView = (s: RowStatus): boolean => hasPauseToggle(s) || s === 'failed'
const closeLabel = (s: RowStatus): string =>
  terminal(s) ? DOWNLOAD_COPY.remove : DOWNLOAD_COPY.cancel

function act(r: Row, action: 'pause' | 'resume' | 'retry' | 'close'): void {
  if (r.act) return r.act(action)
  if (action === 'close') extras.value = extras.value.filter((x) => x.key !== r.key)
}
function reveal(): void {
  toast(DOWNLOAD_COPY.showInFolder)
}
function fill(r: Row): Record<string, string> | undefined {
  if (r.status !== 'downloading' && r.status !== 'pending') return undefined
  const pct = r.status === 'pending' ? 0 : r.progress * 100
  return {
    background: `linear-gradient(90deg, var(--mar-dl-card) 0%, var(--mar-dl-card) ${pct}%, var(--mar-dl-rest) ${Math.min(100, pct + 0.91)}%)`
  }
}
function viewAll(): void {
  open.value = false
  toast(DOWNLOAD_COPY.viewAllLabel)
}
const ICON_BTN =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-secondary-background text-base-foreground hover:bg-secondary-background-hover'
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        :aria-label="trayLabel"
        :title="trayLabel"
        data-testid="downloads-trigger"
        :class="[
          'relative inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          live.length && 'pr-2 pl-1.5',
          open
            ? 'bg-secondary-background-hover text-base-foreground'
            : live.length || needsAttention || unseenDone
              ? 'text-base-foreground hover:bg-secondary-background'
              : 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground'
        ]"
      >
        <DownloadRing v-if="live.length" :progress="overallProgress" :size="18">
          <ArrowDownToLine :size="10" :stroke-width="2.4" />
        </DownloadRing>
        <ArrowDownToLine v-else :size="15" />
        <span v-if="live.length" class="text-[12px] font-medium tabular-nums">{{ percent }}%</span>
        <span
          v-if="needsAttention || unseenDone"
          aria-hidden="true"
          class="absolute top-1 right-1 size-1.5 rounded-full ring-2 ring-titlebar-background"
          :class="needsAttention ? 'bg-status-danger' : 'bg-status-running'"
        />
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      class="flex max-h-[520px] w-[380px] flex-col p-0 [--mar-dl-card:var(--color-secondary-background-hover)] [--mar-dl-rest:var(--color-secondary-background)]"
    >
      <header class="flex flex-none items-baseline justify-between gap-2 px-4 pt-4 pb-3">
        <h2 class="m-0 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          {{ DOWNLOAD_COPY.title }}
        </h2>
        <button
          type="button"
          class="rounded-sm text-[12px] text-base-foreground hover:underline"
          :aria-label="DOWNLOAD_COPY.viewAllLabel"
          @click="viewAll"
        >
          {{ DOWNLOAD_COPY.viewAll }}
        </button>
      </header>
      <div v-if="!rows.length" class="px-4 pt-4 pb-6 text-center text-[12px] text-muted-foreground">
        {{ DOWNLOAD_COPY.empty }}
      </div>
      <ul
        v-else
        class="mx-4 mt-0 mb-4 flex min-h-0 list-none flex-col overflow-y-auto rounded-[14px] bg-(--mar-dl-rest) p-0 [scrollbar-width:none]"
      >
        <li
          v-for="r in rows"
          :key="r.key"
          class="group relative flex flex-none items-center gap-2 border-t border-border-default py-3 pr-2.5 pl-[18px] outline-none first:rounded-t-[14px] first:border-t-0 last:rounded-b-[14px] focus-within:bg-(--mar-dl-card) hover:bg-(--mar-dl-card)"
          :class="r.status === 'done' && 'cursor-pointer'"
          :style="fill(r)"
          :data-download="r.status"
          tabindex="0"
          @click="r.status === 'done' && reveal()"
        >
          <span class="mt-0.5 inline-flex size-4 shrink-0 self-start text-base-foreground">
            <CircleCheck v-if="r.status === 'done'" :size="16" />
            <CircleAlert v-else-if="r.status === 'failed'" :size="16" class="text-status-danger" />
            <Ban v-else-if="r.status === 'cancelled'" :size="16" class="text-muted-foreground" />
            <PauseCircle v-else-if="r.status === 'paused'" :size="16" />
            <LoaderCircle
              v-else
              :size="16"
              class="animate-spin [animation-duration:900ms] motion-reduce:animate-none"
            />
          </span>
          <span class="flex min-w-0 flex-auto flex-col">
            <span class="truncate text-[14px] leading-5 text-base-foreground" :title="r.name">{{
              r.name
            }}</span>
            <span class="truncate text-[12px] leading-[1.2] text-muted-foreground tabular-nums">{{
              r.line
            }}</span>
          </span>
          <span
            v-if="hasPauseToggle(r.status) || canRetry(r.status) || r.status === 'done'"
            class="shrink-0 items-center"
            :class="
              keepsActionInView(r.status)
                ? 'flex'
                : 'hidden group-focus-within:flex group-hover:flex'
            "
          >
            <button
              v-if="hasPauseToggle(r.status)"
              type="button"
              :class="ICON_BTN"
              :title="r.status === 'paused' ? DOWNLOAD_COPY.resume : DOWNLOAD_COPY.pause"
              :aria-label="r.status === 'paused' ? DOWNLOAD_COPY.resume : DOWNLOAD_COPY.pause"
              @click.stop="act(r, r.status === 'paused' ? 'resume' : 'pause')"
            >
              <Play v-if="r.status === 'paused'" :size="16" />
              <Pause v-else :size="16" />
            </button>
            <button
              v-else-if="canRetry(r.status)"
              type="button"
              :class="ICON_BTN"
              :title="DOWNLOAD_COPY.retry"
              :aria-label="DOWNLOAD_COPY.retry"
              data-download-retry
              @click.stop="act(r, 'retry')"
            >
              <RotateCcw :size="16" />
            </button>
            <button
              v-else
              type="button"
              :class="ICON_BTN"
              :title="DOWNLOAD_COPY.showInFolder"
              :aria-label="DOWNLOAD_COPY.showInFolder"
              @click.stop="reveal"
            >
              <FolderSearch :size="16" />
            </button>
          </span>
          <button
            type="button"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:text-base-foreground"
            :title="closeLabel(r.status)"
            :aria-label="closeLabel(r.status)"
            @click.stop="act(r, 'close')"
          >
            <X :size="16" />
          </button>
        </li>
      </ul>
    </PopoverContent>
  </PopoverRoot>
</template>
