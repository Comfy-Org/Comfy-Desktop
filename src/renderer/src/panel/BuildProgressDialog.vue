<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Cloud, LoaderCircle, OctagonAlert, X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import { useCloudGate } from '../composables/useCloudGate'
import { useModal } from '../composables/useModal'
import { useProgressStore } from '../stores/progressStore'
import { useInstallationStore } from '../stores/installationStore'
import { emitTelemetryAction } from '../lib/telemetry'

type StepState = 'done' | 'active' | 'failed' | 'pending'

interface StepRow {
  phase: string
  label: string
  state: StepState
  percent: number | null
  detail: string
}

const BUILD_PROGRESS_VIDEOS = [
  'city_skyline',
  'crystal_shard',
  'dinosaur_eye',
  'driving',
  'earpods',
  'girl_riding_bike',
  'gundam',
  'man_sitting_on_roof',
  'milk_coffee',
  'moon_racer',
  'mow_the_lawn',
  'northern_lights',
  'puppy',
  'rubber_duck',
  'samurai_on_beach',
  'snow_leopard',
  'space_cowboy',
  'steak',
  'train',
  'waitress',
  'woman_smoking'
] as const
const LOG_TAIL_CHARS = 20_000

const { installationId } = defineProps<{ installationId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const progressStore = useProgressStore()
const installationStore = useInstallationStore()
const modal = useModal()
const cloudGate = useCloudGate()

const op = computed(() => progressStore.operations.get(installationId) ?? null)
const build = computed(() => installationStore.getById(installationId) ?? null)
const logsOpen = ref(true)
const logsRef = ref<HTMLElement | null>(null)
const video = `./build-progress/${
  BUILD_PROGRESS_VIDEOS[Math.floor(Math.random() * BUILD_PROGRESS_VIDEOS.length)]
}.webm`
const videoShape = ref<'tall' | 'wide' | null>(null)

function measureVideo(event: Event): void {
  const el = event.target as HTMLVideoElement
  videoShape.value = el.videoHeight > el.videoWidth ? 'tall' : 'wide'
}

const steps = computed<StepRow[]>(() => {
  const current = op.value
  if (!current) return []
  const failed = current.finished && !!current.error
  if (!current.steps?.length) {
    return [
      {
        phase: 'flat',
        label: current.flatStatus || current.title,
        state: failed ? 'failed' : 'active',
        percent: current.flatPercent >= 0 ? Math.round(current.flatPercent) : null,
        detail: failed ? (current.error ?? '') : ''
      }
    ]
  }
  const activeIndex = current.steps.findIndex((step) => step.phase === current.activePhase)
  return current.steps.map((step, index): StepRow => {
    const state: StepState =
      activeIndex < 0
        ? 'pending'
        : index < activeIndex
          ? 'done'
          : index > activeIndex
            ? 'pending'
            : failed || current.phaseErrors[step.phase]
              ? 'failed'
              : 'active'
    const status = current.lastStatus[step.phase]
    const detail =
      state === 'failed'
        ? (current.error ?? status ?? '')
        : state === 'active' && status && status !== step.phase && status !== step.label
          ? status
          : ''
    return {
      phase: step.phase,
      label: step.label,
      state,
      percent:
        state === 'active' && current.activePercent >= 0 ? Math.round(current.activePercent) : null,
      detail
    }
  })
})

const failed = computed(() => !!op.value?.finished && !!op.value.error)
const title = computed(() =>
  failed.value ? t('installProgress.failedTitle') : t('home.buildInstalling')
)
const cancelling = computed(() => !!op.value?.cancelRequested)
const logText = computed(() => {
  const output = op.value?.terminalOutput ?? ''
  return output.length > LOG_TAIL_CHARS ? output.slice(-LOG_TAIL_CHARS) : output
})

watch(
  () => op.value?.finished === true && !op.value.error,
  (succeeded) => {
    if (succeeded) emit('close')
  },
  { immediate: true }
)

watch(logText, async () => {
  const el = logsRef.value
  if (!el) return
  const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  await nextTick()
  if (pinned) el.scrollTop = el.scrollHeight
})

async function cancelInstall(): Promise<void> {
  const confirmed = await modal.confirm({
    title: t('installProgress.cancelTitle'),
    message: t('installProgress.cancelMessage', { name: build.value?.name ?? '' }),
    confirmLabel: t('installProgress.cancelConfirm'),
    confirmStyle: 'danger'
  })
  if (!confirmed) return
  progressStore.cancelOperation(installationId)
  emit('close')
}

async function tryCloud(): Promise<void> {
  emitTelemetryAction('comfy.desktop.install.showcase.cloud_open', {
    phase: op.value?.activePhase ?? null
  })
  if (await cloudGate.openCloud()) return
  await modal.alert({
    title: t('installShowcase.cloudFailedTitle'),
    message: t('installShowcase.cloudFailedMessage')
  })
}
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="title"
    overlay-class="fixed inset-0 z-50 bg-black/55 backdrop-blur-[10px]"
    content-class="fixed top-1/2 left-1/2 z-50 w-[760px] max-w-[calc(100vw-96px)] -translate-x-1/2 -translate-y-1/2 outline-none"
    data-testid="build-progress-dialog"
    @close="emit('close')"
  >
    <div class="relative">
      <div
        class="flex max-h-[calc(100vh-48px)] flex-col overflow-y-auto rounded-[20px] border border-[rgb(242_242_242/0.08)] bg-[rgb(37_37_37/0.9)] px-[33px] pt-[29px] pb-[15px] backdrop-blur-[16px]"
      >
        <div class="flex gap-10">
          <div class="flex min-w-0 flex-1 flex-col">
            <h2 class="m-0 text-lg/[22px] font-semibold text-foreground">
              {{ title }}
            </h2>
            <ol
              class="m-0 mt-[29px] flex list-none flex-col p-0"
              data-testid="build-progress-steps"
            >
              <li
                v-for="(step, index) in steps"
                :key="step.phase"
                class="relative flex gap-3 pb-[15px] last:pb-0"
                :data-state="step.state"
                data-testid="build-progress-step"
              >
                <span
                  v-if="index < steps.length - 1"
                  class="absolute top-[23px] bottom-0.5 left-[10px] w-px bg-[rgb(239_239_239/0.12)]"
                  aria-hidden="true"
                />
                <span class="relative flex size-[21px] shrink-0 items-center justify-center">
                  <LoaderCircle
                    v-if="step.state === 'active'"
                    :size="13"
                    :stroke-width="1.6"
                    class="animate-spin text-foreground [animation-duration:900ms] motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <OctagonAlert
                    v-else-if="step.state === 'failed'"
                    :size="14"
                    class="text-destructive"
                    aria-hidden="true"
                  />
                  <span
                    v-else
                    class="flex size-[21px] items-center justify-center rounded-full border border-[rgb(241_241_241/0.14)]"
                    aria-hidden="true"
                  >
                    <Check
                      v-if="step.state === 'done'"
                      :size="11"
                      :stroke-width="2"
                      class="text-muted-foreground"
                    />
                  </span>
                </span>
                <span class="flex min-w-0 flex-col pt-0.5">
                  <span
                    class="text-[13px]/4"
                    :class="{
                      'text-foreground': step.state === 'active',
                      'text-destructive': step.state === 'failed',
                      'text-muted-foreground': step.state === 'done',
                      'text-subtle-foreground': step.state === 'pending'
                    }"
                  >
                    {{ step.label
                    }}<span v-if="step.percent !== null" class="ml-[0.3em] text-muted-foreground">{{
                      t('installProgress.percent', { percent: step.percent })
                    }}</span>
                  </span>
                  <span
                    v-if="step.detail"
                    class="mt-[5px] text-xs/[15px] break-words"
                    :class="step.state === 'failed' ? 'text-destructive' : 'text-subtle-foreground'"
                    data-testid="build-progress-step-detail"
                  >
                    {{ step.detail }}
                  </span>
                </span>
              </li>
            </ol>

            <Button
              type="button"
              variant="muted-textonly"
              size="unset"
              class="mt-8 h-4 w-fit gap-2 px-[3px] text-[13px]/4 font-normal text-subtle-foreground hover:bg-transparent hover:text-foreground"
              :aria-expanded="logsOpen"
              aria-controls="build-progress-logs"
              data-testid="build-progress-logs-toggle"
              @click="logsOpen = !logsOpen"
            >
              <ChevronDown
                :size="12"
                class="transition-transform duration-150 motion-reduce:transition-none"
                :class="!logsOpen && '-rotate-90'"
                aria-hidden="true"
              />
              {{ t('installProgress.viewLogs') }}
            </Button>
            <pre
              v-show="logsOpen"
              id="build-progress-logs"
              ref="logsRef"
              class="m-0 mt-1 h-[82px] overflow-y-auto overscroll-contain rounded-[10px] bg-[rgb(235_235_235/0.05)] px-3 py-[13px] font-mono text-xs/4 break-words whitespace-pre-wrap text-muted-foreground select-text"
              tabindex="0"
              data-testid="build-progress-logs"
              >{{ logText || t('installProgress.starting') }}</pre
            >
          </div>

          <div class="flex h-[340px] w-[272px] shrink-0 items-center justify-center">
            <video
              class="w-[272px] transition-opacity duration-200 motion-reduce:transition-none"
              :class="[
                videoShape === 'tall'
                  ? 'h-[340px] rounded-[18px] border border-white/8 bg-[#161619] object-cover'
                  : 'h-auto max-h-[340px] rounded-xl',
                videoShape ? 'opacity-100' : 'opacity-0'
              ]"
              :src="video"
              autoplay
              muted
              loop
              playsinline
              aria-hidden="true"
              :data-shape="videoShape ?? undefined"
              data-testid="build-progress-video"
              @loadedmetadata="measureVideo"
            />
          </div>
        </div>

        <div class="mt-[60px] flex min-h-9 items-center gap-2">
          <template v-if="cloudGate.canOffer.value && !failed">
            <Cloud
              :size="13"
              class="mt-px shrink-0 self-start text-muted-foreground"
              aria-hidden="true"
            />
            <span class="ml-2 flex min-w-0 flex-col text-[13px]/[18px]">
              <span class="text-foreground">{{ t('installShowcase.cloud.title') }}</span>
              <span class="text-muted-foreground">{{ t('installShowcase.cloud.body') }}</span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="unset"
              class="ml-auto h-9 shrink-0 rounded-[10px] bg-[rgb(244_244_244/0.09)] px-[17px] text-[13px]/4 font-normal text-foreground"
              data-testid="build-progress-try-cloud"
              @click="tryCloud"
            >
              {{ t('installShowcase.cloudCta') }}
            </Button>
          </template>
          <Button
            v-if="failed"
            type="button"
            variant="secondary"
            size="unset"
            class="ml-auto h-9 shrink-0 rounded-[10px] px-[17px] text-[13px]/4 font-normal"
            data-testid="build-progress-close-failed"
            @click="emit('close')"
          >
            {{ t('common.close') }}
          </Button>
          <Button
            v-else
            type="button"
            variant="muted-textonly"
            size="unset"
            class="h-9 shrink-0 rounded-[10px] px-[17px] text-[13px]/4 font-normal text-muted-foreground hover:text-foreground"
            :class="!cloudGate.canOffer.value && 'ml-auto'"
            :disabled="cancelling"
            data-testid="build-progress-cancel"
            @click="cancelInstall"
          >
            {{ t('installProgress.cancelConfirm') }}
          </Button>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="unset"
        class="absolute top-px -right-[47px] size-9 rounded-full bg-white/10 p-0 text-white hover:bg-white/15"
        :aria-label="t('common.close')"
        data-testid="build-progress-close"
        @click="emit('close')"
      >
        <X :size="13" :stroke-width="1.6" />
      </Button>
    </div>
  </DesktopDialogSurface>
</template>
