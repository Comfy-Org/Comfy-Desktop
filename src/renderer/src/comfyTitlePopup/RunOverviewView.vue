<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AppWindow,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Cloud,
  Laptop,
  LoaderCircle,
  Square
} from '@lucide/vue'
import RunOverviewRow from './RunOverviewRow.vue'
import type { TitleBarRun, TitleBarRunOverview } from '../types/ipc'
import { formatPlaybackTime, formatRelativeFromMs } from '../lib/datetime'

const props = defineProps<{ overview: TitleBarRunOverview }>()
const emit = defineEmits<{
  open: [appId: string]
  stop: [appId: string, runId: string]
  resize: [height: number]
}>()

const { t } = useI18n()

interface Place {
  key: string
  where: TitleBarRun['where']
  name: string
  runs: TitleBarRun[]
}

const isGoing = (run: TitleBarRun): boolean => run.state === 'running' || run.state === 'queued'

const places = computed<Place[]>(() => {
  const byKey = new Map<string, Place>()
  for (const run of props.overview.runs.filter(isGoing)) {
    const key = run.where === 'cloud' ? 'cloud' : `local:${run.buildId ?? ''}`
    const name =
      run.where === 'cloud'
        ? t('runOverview.cloud')
        : (run.buildName ?? t('runOverview.thisComputer'))
    const place = byKey.get(key) ?? { key, where: run.where, name, runs: [] }
    place.runs.push(run)
    byKey.set(key, place)
  }
  const inQueueOrder = (a: TitleBarRun, b: TitleBarRun): number =>
    Number(b.state === 'running') - Number(a.state === 'running') ||
    (a.ahead ?? Infinity) - (b.ahead ?? Infinity)
  return [...byKey.values()]
    .sort((a, b) => Number(b.where === 'cloud') - Number(a.where === 'cloud'))
    .map((place) => ({ ...place, runs: [...place.runs].sort(inQueueOrder) }))
})

const finished = computed(() =>
  props.overview.runs
    .filter((run) => !isGoing(run))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
)

const showFinished = ref(false)

const runKey = (run: TitleBarRun): string => `${run.appId}:${run.id}`
const STOP_ANSWER_MS = 5000
const stopping = ref(new Map<string, ReturnType<typeof setTimeout> | null>())
const stopFailed = ref(new Set<string>())

function goingRun(key: string): TitleBarRun | undefined {
  return props.overview.runs.find((run) => runKey(run) === key && isGoing(run))
}

function setStopping(key: string, timer: ReturnType<typeof setTimeout> | null): void {
  const current = stopping.value.get(key)
  if (current) clearTimeout(current)
  stopping.value = new Map(stopping.value).set(key, timer)
}

function endStopping(key: string): void {
  const current = stopping.value.get(key)
  if (current) clearTimeout(current)
  const next = new Map(stopping.value)
  next.delete(key)
  stopping.value = next
}

function markStopFailed(key: string): void {
  endStopping(key)
  stopFailed.value = new Set(stopFailed.value).add(key)
}

function answerStop(key: string): void {
  const run = goingRun(key)
  if (!run) endStopping(key)
  else if (run.canStop) markStopFailed(key)
  else setStopping(key, null)
}

watch(
  () => props.overview.runs,
  () => {
    for (const [key, timer] of stopping.value) {
      const run = goingRun(key)
      if (!run) endStopping(key)
      else if (!run.canStop && timer) setStopping(key, null)
      else if (run.canStop && !timer) markStopFailed(key)
    }
    stopFailed.value = new Set([...stopFailed.value].filter((key) => goingRun(key)?.canStop))
  }
)

function stop(run: TitleBarRun): void {
  const key = runKey(run)
  if (stopping.value.has(key)) return
  const failed = new Set(stopFailed.value)
  failed.delete(key)
  stopFailed.value = failed
  setStopping(
    key,
    setTimeout(() => answerStop(key), STOP_ANSWER_MS)
  )
  emit('stop', run.appId, run.id)
}

const isStopping = (run: TitleBarRun): boolean => stopping.value.has(runKey(run))
const didNotStop = (run: TitleBarRun): boolean => stopFailed.value.has(runKey(run))
const reserveStopSpace = computed(() =>
  places.value.some(({ runs }) => runs.some((run) => run.canStop))
)
const finishedList = useTemplateRef<HTMLElement>('finishedList')

async function toggleFinished(): Promise<void> {
  showFinished.value = !showFinished.value
  if (!showFinished.value) return
  await nextTick()
  finishedList.value?.scrollIntoView({ block: 'nearest' })
}

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
const hasRunning = computed(() => props.overview.runs.some((run) => run.state === 'running'))

function stopTicker(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

watch(
  hasRunning,
  (running) => {
    stopTicker()
    now.value = Date.now()
    if (running) ticker = setInterval(() => (now.value = Date.now()), 1000)
  },
  { immediate: true }
)

const content = useTemplateRef<HTMLElement>('content')
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  now.value = Date.now()
  const el = content.value
  if (!el) return
  resizeObserver = new ResizeObserver(() => emit('resize', el.offsetHeight))
  resizeObserver.observe(el)
})
onUnmounted(() => {
  stopTicker()
  for (const timer of stopping.value.values()) if (timer) clearTimeout(timer)
  resizeObserver?.disconnect()
})

function statusLine(run: TitleBarRun): string {
  if (isStopping(run)) return t('runOverview.stopping')
  if (didNotStop(run)) return t('runOverview.stopFailed')
  if (run.state === 'queued') {
    if (run.ahead === undefined) return t('runOverview.waiting')
    return run.ahead === 0 ? t('runOverview.next') : t('runOverview.ahead', run.ahead)
  }
  if (run.state === 'running') return run.step ?? t('runOverview.running')
  if (run.state === 'failed') return run.step ?? t('runOverview.failed')
  return run.step ?? t('runOverview.done')
}

function stepCountOf(run: TitleBarRun): string | null {
  if (isStopping(run) || didNotStop(run)) return null
  if (run.state !== 'running' || run.stepIndex === undefined || run.stepCount === undefined) {
    return null
  }
  return t('runOverview.stepOf', { index: run.stepIndex, count: run.stepCount })
}

function elapsed(run: TitleBarRun): string {
  return run.startedAt ? formatPlaybackTime(Math.max(0, now.value - run.startedAt) / 1000) : ''
}

function endedLabel(run: TitleBarRun): string {
  return run.endedAt ? formatRelativeFromMs(run.endedAt, t, now.value) : ''
}

function progressWidth(run: TitleBarRun): string {
  return `${Math.round((run.progress ?? 0) * 100)}%`
}
</script>

<template>
  <div
    class="run-overview h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    data-testid="run-overview"
  >
    <div ref="content" class="run-overview-content flex flex-col gap-3 p-3">
      <section
        v-for="place in places"
        :key="place.key"
        class="flex flex-col gap-2"
        :data-testid="`run-overview-place-${place.where}`"
      >
        <h2
          class="m-0 flex items-center gap-1.5 px-1 text-[12px] leading-4 font-medium text-muted-foreground"
        >
          <Cloud v-if="place.where === 'cloud'" :size="14" aria-hidden="true" />
          <Laptop v-else :size="14" aria-hidden="true" />
          <span class="truncate" :title="place.name">{{ place.name }}</span>
        </h2>
        <ol class="m-0 flex list-none flex-col overflow-hidden rounded-xl bg-card p-0">
          <li
            v-for="run in place.runs"
            :key="runKey(run)"
            class="relative flex items-center border-t border-solid border-border first:border-t-0 hover:bg-card-hover/80"
          >
            <RunOverviewRow
              :app-title="run.appTitle"
              :picture="run.picture"
              :status="statusLine(run)"
              :step-count="stepCountOf(run)"
              :waiting="run.state === 'queued'"
              class="min-w-0 flex-auto"
              data-testid="run-overview-run"
              @open="emit('open', run.appId)"
            >
              <template v-if="didNotStop(run)" #icon>
                <CircleAlert
                  :size="12"
                  class="shrink-0 text-destructive"
                  aria-hidden="true"
                  data-testid="run-overview-stop-failed-icon"
                />
              </template>
              <template v-else-if="run.state === 'running'" #icon>
                <LoaderCircle
                  :size="12"
                  class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </template>
              <template v-if="run.state === 'running' && run.startedAt" #end>
                <span class="shrink-0 text-[12px] text-muted-foreground tabular-nums">{{
                  elapsed(run)
                }}</span>
              </template>
            </RunOverviewRow>
            <Button
              v-if="run.canStop"
              variant="muted-textonly"
              size="icon"
              class="mr-1.5 shrink-0"
              :disabled="isStopping(run)"
              :aria-label="t('runOverview.stopRun', { app: run.appTitle })"
              :title="t('runOverview.stopRun', { app: run.appTitle })"
              data-testid="run-overview-stop"
              @click="stop(run)"
            >
              <Square :size="12" fill="currentColor" aria-hidden="true" />
            </Button>
            <span
              v-else-if="reserveStopSpace"
              class="mr-1.5 size-8 shrink-0"
              aria-hidden="true"
              data-testid="run-overview-stop-space"
            />
            <span
              v-if="run.state === 'running' && run.progress !== undefined"
              class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-secondary"
              aria-hidden="true"
            >
              <span class="block h-full bg-foreground" :style="{ width: progressWidth(run) }" />
            </span>
          </li>
        </ol>
      </section>

      <section
        v-if="overview.apps.length > 0"
        class="flex flex-col gap-2"
        data-testid="run-overview-apps"
      >
        <h2
          class="m-0 flex items-center gap-1.5 px-1 text-[12px] leading-4 font-medium text-muted-foreground"
        >
          <AppWindow :size="14" aria-hidden="true" />
          <span class="truncate">{{ t('runOverview.otherApps') }}</span>
        </h2>
        <ol class="m-0 flex list-none flex-col overflow-hidden rounded-xl bg-card p-0">
          <li
            v-for="app in overview.apps"
            :key="app.id"
            class="border-t border-solid border-border first:border-t-0 hover:bg-card-hover/80"
          >
            <RunOverviewRow
              :app-title="app.title"
              :picture="app.picture"
              :status="app.state === 'running' ? t('runOverview.running') : t('titleBar.ready')"
              data-testid="run-overview-app"
              @open="emit('open', app.id)"
            >
              <template v-if="app.state === 'running'" #icon>
                <LoaderCircle
                  :size="12"
                  class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </template>
            </RunOverviewRow>
          </li>
        </ol>
      </section>

      <section v-if="finished.length > 0" class="flex flex-col gap-2">
        <Button
          variant="muted-textonly"
          size="md"
          class="w-full justify-between px-1 text-[12px] font-medium"
          :aria-expanded="showFinished"
          data-testid="run-overview-finished-toggle"
          @click="toggleFinished"
        >
          {{ t('runOverview.finished', { count: finished.length }) }}
          <ChevronRight
            :size="14"
            class="transition-transform duration-150 motion-reduce:transition-none"
            :class="{ 'rotate-90': showFinished }"
            aria-hidden="true"
          />
        </Button>
        <ol
          v-if="showFinished"
          ref="finishedList"
          class="m-0 flex list-none flex-col overflow-hidden rounded-xl bg-card p-0"
        >
          <li
            v-for="run in finished"
            :key="`${run.appId}:${run.id}`"
            class="border-t border-solid border-border first:border-t-0 hover:bg-card-hover/80"
          >
            <RunOverviewRow
              :app-title="run.appTitle"
              :picture="run.picture"
              :status="statusLine(run)"
              data-testid="run-overview-finished-run"
              @open="emit('open', run.appId)"
            >
              <template #icon>
                <CircleAlert
                  v-if="run.state === 'failed'"
                  :size="12"
                  class="shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <CircleCheck v-else :size="12" class="shrink-0" aria-hidden="true" />
              </template>
              <template #end>
                <span class="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
                  <Cloud v-if="run.where === 'cloud'" :size="12" aria-hidden="true" />
                  <Laptop v-else :size="12" aria-hidden="true" />
                  {{ endedLabel(run) }}
                </span>
              </template>
            </RunOverviewRow>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>
