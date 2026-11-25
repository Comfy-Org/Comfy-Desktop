<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, HardDrive, Pause, Play, TriangleAlert, X } from 'lucide-vue-next'
import {
  cancel,
  copyFor,
  freeUpSpace,
  openAndRun,
  pause,
  progressOf,
  resume,
  retry,
  secsLeft,
  type TemplateDownload
} from './templateDownloads'
import { fmtGb } from '../templateModal/templateData'
import { fmtDuration } from '../templateModal/firstResult'
import { dlFooter } from './dlFooter'

const props = defineProps<{ download: TemplateDownload }>()
const emit = defineEmits<{ close: [] }>()

const copy = computed(() => copyFor(props.download))
const live = computed(
  () => props.download.status === 'downloading' || props.download.status === 'paused'
)

const PRIMARY: Record<
  Exclude<TemplateDownload['status'], 'cancelled'>,
  { label: string; run: (id: string) => void }
> = {
  downloading: { label: 'Keep browsing', run: () => emit('close') },
  paused: { label: 'Resume download', run: resume },
  failed: { label: 'Retry', run: retry },
  disk: { label: 'Free up space', run: freeUpSpace },
  done: { label: 'Open and run', run: openAndRun }
}
const primary = computed(() =>
  props.download.status === 'cancelled' ? undefined : PRIMARY[props.download.status]
)
const pct = computed(() => Math.floor(progressOf(props.download) * 100))
const fillLabel = computed(() => {
  const d = props.download
  switch (d.status) {
    case 'downloading':
      return `Downloading ${pct.value}% · ~${fmtDuration(secsLeft(d))} left`
    case 'paused':
      return `Resume · ${pct.value}%`
    case 'failed':
      return `Retry · stopped at ${pct.value}%`
    case 'disk':
      return `Free up space · needs ${fmtGb(d.totalGb - d.doneGb)} more`
    default:
      return primary.value?.label ?? ''
  }
})
const ICON =
  'mad-btn mar-dl-icon inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:text-base-foreground'
</script>

<template>
  <div
    v-if="dlFooter.id === 'button'"
    class="flex items-center gap-2 [order:-2]"
    :data-download="download.status"
    data-dl-footer="button"
    role="status"
    aria-live="polite"
  >
    <button
      v-if="primary"
      type="button"
      class="mad-btn is-primary mar-tpl-go mar-dl-fill"
      data-tpl-primary
      :data-download-action="download.status"
      :style="{ '--p': download.status === 'done' ? 0 : progressOf(download) }"
      @click="primary.run(download.id)"
    >
      <TriangleAlert v-if="download.status === 'failed'" :size="14" class="relative shrink-0" />
      <HardDrive v-else-if="download.status === 'disk'" :size="14" class="relative shrink-0" />
      <span>{{ fillLabel }}</span>
    </button>
    <button
      v-if="download.status === 'downloading'"
      type="button"
      :class="ICON"
      aria-label="Pause"
      title="Pause"
      @click="pause(download.id)"
    >
      <Pause :size="14" />
    </button>
    <button
      v-if="download.status !== 'done'"
      type="button"
      :class="ICON"
      aria-label="Cancel download"
      title="Cancel download"
      @click="cancel(download.id)"
    >
      <X :size="15" />
    </button>
  </div>
  <div
    v-else
    class="mar-dl-joined flex flex-col overflow-hidden rounded-[10px] bg-secondary-background [order:-2]"
    :data-download="download.status"
    data-dl-footer="joined"
  >
    <div class="flex flex-col gap-2 px-3 py-2.5" role="status" aria-live="polite">
      <div class="flex min-h-6 items-center gap-2">
        <TriangleAlert
          v-if="download.status === 'failed'"
          :size="14"
          class="shrink-0 text-status-danger"
        />
        <HardDrive
          v-else-if="download.status === 'disk'"
          :size="14"
          class="shrink-0 text-comfy-yellow"
        />
        <CircleCheck
          v-else-if="download.status === 'done'"
          :size="14"
          class="shrink-0 text-status-running"
        />
        <span class="flex-auto text-[13px] font-medium text-base-foreground tabular-nums">{{
          copy.title
        }}</span>
        <button
          v-if="live"
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-control text-muted-foreground hover:bg-secondary-background-hover hover:text-base-foreground"
          :aria-label="download.status === 'paused' ? 'Resume' : 'Pause'"
          :title="download.status === 'paused' ? 'Resume' : 'Pause'"
          @click="download.status === 'paused' ? resume(download.id) : pause(download.id)"
        >
          <Play v-if="download.status === 'paused'" :size="13" />
          <Pause v-else :size="13" />
        </button>
        <button
          v-if="download.status !== 'done'"
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-control text-muted-foreground hover:bg-secondary-background-hover hover:text-base-foreground"
          aria-label="Cancel download"
          title="Cancel download"
          @click="cancel(download.id)"
        >
          <X :size="14" />
        </button>
      </div>
      <div
        v-if="download.status !== 'done'"
        class="h-1 overflow-hidden rounded-full bg-secondary-background-hover"
        aria-hidden="true"
      >
        <div
          class="h-full origin-left rounded-full transition-transform duration-200 ease-linear motion-reduce:transition-none"
          :class="
            download.status === 'failed'
              ? 'bg-status-danger'
              : download.status === 'disk'
                ? 'bg-comfy-yellow'
                : download.status === 'paused'
                  ? 'bg-muted-foreground'
                  : 'bg-base-foreground'
          "
          :style="{ transform: `scaleX(${progressOf(download)})` }"
        />
      </div>
      <p class="m-0 text-[12px] leading-[18px] text-muted-foreground tabular-nums">
        {{ copy.detail }}
      </p>
    </div>
    <button
      v-if="primary"
      type="button"
      class="mar-dl-row flex h-10 w-full items-center justify-center text-[13px] font-medium text-base-foreground"
      data-tpl-primary
      :data-download-action="download.status"
      @click="primary.run(download.id)"
    >
      {{ primary.label }}
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
