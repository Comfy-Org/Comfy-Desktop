<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowDownToLine,
  CircleCheck,
  CirclePause,
  HardDrive,
  LoaderCircle,
  Pause,
  Play,
  TriangleAlert,
  Undo2,
  X
} from 'lucide-vue-next'
import { PopoverRoot, PopoverTrigger } from 'reka-ui'
import PopoverContent from '../../ui/PopoverContent.vue'
import { openDetail, toast } from '../../useProto'
import {
  cancel,
  freeUpSpace,
  markSeen,
  menuLine,
  needsAttention,
  openAndRun,
  overallProgress,
  pause,
  progressOf,
  remove as removeDownload,
  resume,
  retry,
  templateDownloads,
  unseenDone,
  type TemplateDownload
} from '../downloads/templateDownloads'
import DownloadRing from '../downloads/DownloadRing.vue'

/**
 * The title bar's downloads popup, as Desktop ships it (Comfy-Desktop#2017,
 * comfyTitlePopup/DownloadsView.vue): an uppercase label on top, no divider
 * lines, rows on a card fill with the progress drawn through them, and
 * View All Downloads as a menu-style row at the foot.
 */
interface Download {
  id: string
  name: string
  sub: string
  progress?: number
}

const items = ref<Download[]>([
  {
    id: 'flux',
    name: 'flux1-dev-fp8.safetensors',
    sub: '6.2 of 11.9 GB · 48 MB/s · 2 min left',
    progress: 0.52
  },
  { id: 'vae', name: 'ae.safetensors', sub: 'Show in Finder' }
])
const open = ref(false)
watch(open, (v) => v && markSeen())
watch(unseenDone, (v) => v && open.value && markSeen())

const tpl = computed(() => templateDownloads.list)
const live = computed(() =>
  tpl.value.filter((d) => d.status === 'downloading' || d.status === 'paused')
)
const percent = computed(() => Math.floor(overallProgress.value * 100))
const triggerLabel = computed(() => {
  if (needsAttention.value) return 'Downloads, one needs you'
  if (live.value.length) return `Downloads, ${percent.value}%`
  if (unseenDone.value) return 'Downloads, ready to run'
  return 'Downloads'
})

function remove(d: Download): void {
  items.value = items.value.filter((x) => x.id !== d.id)
}
function fill(pct: number): Record<string, string> {
  return {
    background: `linear-gradient(90deg, var(--mar-dl-card) 0%, var(--mar-dl-card) ${pct}%, var(--mar-dl-rest) ${pct + 0.9}%)`
  }
}
function rowStyle(d: Download): Record<string, string> | undefined {
  if (d.progress === undefined) return undefined
  return fill(d.progress * 100)
}
function tplStyle(d: TemplateDownload): Record<string, string> | undefined {
  if (d.status === 'done' || d.status === 'cancelled') return undefined
  return fill(progressOf(d) * 100)
}
function show(d: TemplateDownload): void {
  open.value = false
  openDetail('template', d.id)
}
function act(fn: (id: string) => void, d: TemplateDownload): void {
  open.value = false
  fn(d.id)
}
const TEXT_ACTION: Partial<
  Record<TemplateDownload['status'], { label: string; run: (id: string) => void; leave?: boolean }>
> = {
  failed: { label: 'Retry', run: retry },
  disk: { label: 'Free up space', run: freeUpSpace, leave: true },
  cancelled: { label: 'Resume', run: resume },
  done: { label: 'Open and run', run: openAndRun, leave: true }
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        :aria-label="triggerLabel"
        :title="triggerLabel"
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
      class="flex w-[380px] flex-col p-0 [--mar-dl-card:var(--color-secondary-background-hover)] [--mar-dl-rest:var(--color-secondary-background)]"
    >
      <header class="px-4 pt-3.5 pb-1">
        <h2 class="m-0 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          Downloads
        </h2>
      </header>
      <div
        v-if="!items.length && !tpl.length"
        class="px-4 py-6 text-center text-[12px] text-muted-foreground"
      >
        No downloads yet
      </div>
      <ul v-else class="m-0 flex list-none flex-col gap-2 p-4">
        <li
          v-for="d in tpl"
          :key="`tpl-${d.id}`"
          class="flex cursor-pointer items-center gap-2 rounded-lg bg-(--mar-dl-card) py-3 pr-2 pl-4"
          :style="tplStyle(d)"
          :data-download="d.status"
          @click="show(d)"
        >
          <LoaderCircle
            v-if="d.status === 'downloading'"
            :size="16"
            class="mt-0.5 shrink-0 self-start animate-spin [animation-duration:900ms] motion-reduce:animate-none"
          />
          <CirclePause
            v-else-if="d.status === 'paused'"
            :size="16"
            class="mt-0.5 shrink-0 self-start text-muted-foreground"
          />
          <TriangleAlert
            v-else-if="d.status === 'failed'"
            :size="16"
            class="mt-0.5 shrink-0 self-start text-status-danger"
          />
          <HardDrive
            v-else-if="d.status === 'disk'"
            :size="16"
            class="mt-0.5 shrink-0 self-start text-comfy-yellow"
          />
          <Undo2
            v-else-if="d.status === 'cancelled'"
            :size="16"
            class="mt-0.5 shrink-0 self-start text-muted-foreground"
          />
          <CircleCheck v-else :size="16" class="mt-0.5 shrink-0 self-start text-status-running" />
          <span class="flex min-w-0 flex-auto flex-col">
            <span class="truncate text-[14px] leading-5 text-base-foreground" :title="d.title">{{
              d.title
            }}</span>
            <span
              class="line-clamp-2 text-[12px] leading-[1.3] text-muted-foreground tabular-nums"
              >{{ menuLine(d) }}</span
            >
          </span>
          <button
            v-if="TEXT_ACTION[d.status]"
            type="button"
            class="ml-1 h-7 shrink-0 rounded-control bg-secondary-background px-2.5 text-[12px] font-medium text-base-foreground hover:bg-secondary-background-hover"
            @click.stop="
              TEXT_ACTION[d.status]!.leave
                ? act(TEXT_ACTION[d.status]!.run, d)
                : TEXT_ACTION[d.status]!.run(d.id)
            "
          >
            {{ TEXT_ACTION[d.status]!.label }}
          </button>
          <button
            v-else-if="d.status === 'downloading' || d.status === 'paused'"
            type="button"
            class="ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:text-base-foreground"
            :aria-label="d.status === 'paused' ? 'Resume' : 'Pause'"
            :title="d.status === 'paused' ? 'Resume' : 'Pause'"
            @click.stop="d.status === 'paused' ? resume(d.id) : pause(d.id)"
          >
            <Play v-if="d.status === 'paused'" :size="15" />
            <Pause v-else :size="15" />
          </button>
          <button
            type="button"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:text-base-foreground"
            :aria-label="
              d.status === 'done' || d.status === 'cancelled' ? 'Remove from list' : 'Cancel'
            "
            :title="d.status === 'done' || d.status === 'cancelled' ? 'Remove from list' : 'Cancel'"
            @click.stop="
              d.status === 'done' || d.status === 'cancelled' ? removeDownload(d.id) : cancel(d.id)
            "
          >
            <X :size="16" />
          </button>
        </li>
        <li
          v-for="d in items"
          :key="d.id"
          class="flex items-center gap-2 rounded-lg bg-(--mar-dl-card) px-4 py-3"
          :class="d.progress === undefined && 'cursor-pointer'"
          :style="rowStyle(d)"
          @click="d.progress === undefined && toast('Show in Finder')"
        >
          <LoaderCircle
            v-if="d.progress !== undefined"
            :size="16"
            class="mt-0.5 shrink-0 self-start animate-spin [animation-duration:900ms] motion-reduce:animate-none"
          />
          <CircleCheck v-else :size="16" class="mt-0.5 shrink-0 self-start" />
          <span class="flex min-w-0 flex-auto flex-col">
            <span class="truncate text-[14px] leading-5 text-base-foreground" :title="d.name">{{
              d.name
            }}</span>
            <span class="truncate text-[12px] leading-[1.2] text-muted-foreground">{{
              d.sub
            }}</span>
          </span>
          <button
            type="button"
            class="ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:text-base-foreground"
            :aria-label="d.progress === undefined ? 'Remove from list' : 'Cancel'"
            :title="d.progress === undefined ? 'Remove from list' : 'Cancel'"
            @click.stop="remove(d)"
          >
            <X :size="16" />
          </button>
        </li>
      </ul>
      <footer class="flex p-1">
        <button
          type="button"
          class="h-8 flex-auto rounded-control px-3 text-left text-[13px] text-base-foreground outline-none hover:bg-[oklch(1_0_0/0.07)] focus-visible:bg-[oklch(1_0_0/0.07)]"
          @click="toast('View All Downloads')"
        >
          View All Downloads
        </button>
      </footer>
    </PopoverContent>
  </PopoverRoot>
</template>
