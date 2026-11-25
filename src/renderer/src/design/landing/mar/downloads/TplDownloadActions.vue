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
  type TemplateDownload
} from './templateDownloads'

const props = defineProps<{ download: TemplateDownload; leaveNote?: string }>()
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
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-[10px] bg-secondary-background px-3 py-2.5 [order:-3]"
    :data-download="download.status"
    role="status"
    aria-live="polite"
  >
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
  <p
    v-if="download.status === 'downloading'"
    class="m-0 px-0.5 text-[12px] leading-[18px] text-muted-foreground [order:-3]"
  >
    {{
      leaveNote ?? 'It keeps downloading if you leave. Follow it under Downloads in the title bar.'
    }}
  </p>
  <button
    v-if="primary"
    type="button"
    class="mad-btn is-primary mar-tpl-go"
    data-tpl-primary
    :data-download-action="download.status"
    @click="primary.run(download.id)"
  >
    <span>{{ primary.label }}</span>
  </button>
</template>
