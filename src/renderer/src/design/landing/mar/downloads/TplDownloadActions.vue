<script setup lang="ts">
import { computed } from 'vue'
import { Ban, CircleAlert, CircleCheck, Pause, Play, RotateCcw, X } from 'lucide-vue-next'
import {
  DOWNLOAD_COPY,
  cancel,
  currentFile,
  detailLine,
  formatEta,
  formatGb,
  openAndRun,
  pause,
  percentOf,
  progressOf,
  resume,
  retry,
  secsLeft,
  statusLine,
  type TemplateDownload
} from './templateDownloads'
import { dlFooter } from './dlFooter'

const props = defineProps<{ download: TemplateDownload }>()

const live = computed(
  () => props.download.status === 'downloading' || props.download.status === 'paused'
)

const PRIMARY: Partial<
  Record<TemplateDownload['status'], { label: string; run: (id: string) => void }>
> = {
  paused: { label: DOWNLOAD_COPY.resume, run: resume },
  failed: { label: DOWNLOAD_COPY.retry, run: retry },
  cancelled: { label: DOWNLOAD_COPY.retry, run: retry },
  done: { label: DOWNLOAD_COPY.openAndRun, run: openAndRun }
}
const primary = computed(() => PRIMARY[props.download.status])

const file = computed(() => currentFile(props.download))
const fileLabel = computed(() =>
  file.value.count > 1
    ? `${file.value.name} (${file.value.index} of ${file.value.count})`
    : file.value.name
)

const fillLabel = computed(() => {
  const d = props.download
  const pct = `${percentOf(d)}%`
  switch (d.status) {
    case 'downloading':
      return d.mbps > 0 && isFinite(secsLeft(d)) ? `${pct} · ~${formatEta(secsLeft(d))} left` : pct
    case 'paused':
      return `${DOWNLOAD_COPY.resume} · ${pct}`
    default:
      return primary.value?.label ?? ''
  }
})

const title = computed(() => {
  const d = props.download
  switch (d.status) {
    case 'downloading':
      return fileLabel.value
    case 'paused':
      return `Paused · ${percentOf(d)}%`
    case 'failed':
      return DOWNLOAD_COPY.failed
    case 'cancelled':
      return DOWNLOAD_COPY.cancelled
    case 'done':
      return `${DOWNLOAD_COPY.downloaded} · ${formatGb(d.totalGb)}`
  }
})
const detail = computed(() => {
  const d = props.download
  if (d.status === 'failed') return d.error ?? ''
  if (d.status === 'cancelled' || d.status === 'done') return ''
  return detailLine(d)
})
const note = computed(() =>
  props.download.status === 'failed' || props.download.status === 'cancelled'
    ? statusLine(props.download)
    : ''
)
const ICON =
  'mad-btn mar-dl-icon inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:text-base-foreground'
</script>

<template>
  <div
    v-if="dlFooter.id === 'button'"
    class="flex flex-col gap-2 [order:-2]"
    :data-download="download.status"
    data-dl-footer="button"
    role="status"
    aria-live="polite"
  >
    <p
      v-if="note"
      class="mar-tpl-note m-0 flex items-center gap-1.5"
      :class="download.status === 'failed' && 'text-status-danger'"
    >
      <CircleAlert v-if="download.status === 'failed'" :size="13" class="shrink-0" />{{ note }}
    </p>
    <div class="flex items-center gap-2">
      <div
        v-if="download.status === 'downloading'"
        class="mad-btn is-primary mar-tpl-go mar-dl-fill"
        data-tpl-primary
        :data-download-action="download.status"
        :style="{ '--p': progressOf(download) }"
      >
        <span class="tabular-nums">{{ fillLabel }}</span>
      </div>
      <button
        v-else-if="primary"
        type="button"
        class="mad-btn is-primary mar-tpl-go mar-dl-fill"
        data-tpl-primary
        :data-download-action="download.status"
        :style="{ '--p': download.status === 'paused' ? progressOf(download) : 0 }"
        @click="primary.run(download.id)"
      >
        <RotateCcw
          v-if="download.status === 'failed' || download.status === 'cancelled'"
          :size="14"
          class="relative shrink-0"
        />
        <span class="tabular-nums">{{ fillLabel }}</span>
      </button>
      <button
        v-if="download.status === 'downloading'"
        type="button"
        :class="ICON"
        :aria-label="DOWNLOAD_COPY.pause"
        :title="DOWNLOAD_COPY.pause"
        @click="pause(download.id)"
      >
        <Pause :size="14" />
      </button>
      <button
        v-if="live || download.status === 'failed'"
        type="button"
        :class="ICON"
        :aria-label="DOWNLOAD_COPY.cancel"
        :title="DOWNLOAD_COPY.cancel"
        @click="cancel(download.id)"
      >
        <X :size="15" />
      </button>
    </div>
  </div>
  <div
    v-else
    class="mar-dl-joined flex flex-col overflow-hidden rounded-[10px] bg-secondary-background [order:-2]"
    :data-download="download.status"
    data-dl-footer="joined"
  >
    <div class="flex flex-col gap-2 px-3 py-2.5" role="status" aria-live="polite">
      <div class="flex min-h-6 items-center gap-2">
        <CircleAlert
          v-if="download.status === 'failed'"
          :size="14"
          class="shrink-0 text-status-danger"
        />
        <Ban
          v-else-if="download.status === 'cancelled'"
          :size="14"
          class="shrink-0 text-muted-foreground"
        />
        <CircleCheck
          v-else-if="download.status === 'done'"
          :size="14"
          class="shrink-0 text-status-running"
        />
        <span
          class="min-w-0 flex-auto truncate text-[13px] font-medium text-base-foreground tabular-nums"
          :title="title"
          >{{ title }}</span
        >
        <button
          v-if="live"
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-control text-muted-foreground hover:bg-secondary-background-hover hover:text-base-foreground"
          :aria-label="download.status === 'paused' ? DOWNLOAD_COPY.resume : DOWNLOAD_COPY.pause"
          :title="download.status === 'paused' ? DOWNLOAD_COPY.resume : DOWNLOAD_COPY.pause"
          @click="download.status === 'paused' ? resume(download.id) : pause(download.id)"
        >
          <Play v-if="download.status === 'paused'" :size="13" />
          <Pause v-else :size="13" />
        </button>
        <button
          v-if="live || download.status === 'failed'"
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-control text-muted-foreground hover:bg-secondary-background-hover hover:text-base-foreground"
          :aria-label="DOWNLOAD_COPY.cancel"
          :title="DOWNLOAD_COPY.cancel"
          @click="cancel(download.id)"
        >
          <X :size="14" />
        </button>
      </div>
      <div
        v-if="live"
        class="h-1 overflow-hidden rounded-full bg-secondary-background-hover"
        aria-hidden="true"
      >
        <div
          class="h-full origin-left rounded-full transition-transform duration-200 ease-linear motion-reduce:transition-none"
          :class="download.status === 'paused' ? 'bg-muted-foreground' : 'bg-base-foreground'"
          :style="{ transform: `scaleX(${progressOf(download)})` }"
        />
      </div>
      <p
        v-if="detail"
        class="m-0 text-[12px] leading-[18px] text-muted-foreground tabular-nums"
        :class="download.status === 'failed' && 'text-status-danger'"
      >
        {{ detail }}
      </p>
    </div>
    <button
      v-if="primary"
      type="button"
      class="mar-dl-row flex h-10 w-full items-center justify-center gap-1.5 text-[13px] font-medium text-base-foreground"
      data-tpl-primary
      :data-download-action="download.status"
      @click="primary.run(download.id)"
    >
      <RotateCcw
        v-if="download.status === 'failed' || download.status === 'cancelled'"
        :size="14"
      />{{ primary.label }}
    </button>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mad-actions .mad-btn.mar-dl-fill {
  min-width: 0;
  flex: 1 1 0;
}
:root .proto-ui.proto-ui.proto-ui .mad-actions .mad-btn.mar-dl-icon {
  width: 36px;
  padding: 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-dl-row {
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-dl-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
</style>
