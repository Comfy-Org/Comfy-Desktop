<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, CircleAlert, CircleCheck, Cloud, Laptop, LoaderCircle } from '@lucide/vue'
import type { TitleBarRun } from '../types/ipc'
import { formatPlaybackTime, formatRelativeFromMs } from '../lib/datetime'

const props = defineProps<{ runs: TitleBarRun[] }>()
const emit = defineEmits<{ open: [appId: string] }>()

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
  for (const run of props.runs.filter(isGoing)) {
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
  props.runs.filter((run) => !isGoing(run)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
)

const showFinished = ref(false)

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
const hasRunning = computed(() => props.runs.some((run) => run.state === 'running'))

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
onMounted(() => (now.value = Date.now()))
onUnmounted(stopTicker)

function statusLine(run: TitleBarRun): string {
  if (run.state === 'queued') {
    if (run.ahead === undefined) return t('runOverview.waiting')
    return run.ahead <= 1 ? t('runOverview.next') : t('runOverview.ahead', run.ahead)
  }
  if (run.state === 'running') {
    const step =
      run.stepIndex !== undefined && run.stepCount !== undefined
        ? t('runOverview.stepOf', { index: run.stepIndex, count: run.stepCount })
        : null
    return [run.step, step].filter(Boolean).join(' · ') || t('runOverview.running')
  }
  if (run.state === 'failed') return run.step ?? t('runOverview.failed')
  return run.step ?? t('runOverview.done')
}

function elapsed(run: TitleBarRun): string {
  return run.startedAt ? formatPlaybackTime((now.value - run.startedAt) / 1000) : ''
}

function endedLabel(run: TitleBarRun): string {
  return run.endedAt ? formatRelativeFromMs(run.endedAt, t, now.value) : ''
}

function progressWidth(run: TitleBarRun): string {
  return `${Math.round((run.progress ?? 0) * 100)}%`
}
</script>

<template>
  <div class="run-overview flex flex-col gap-3 p-3" data-testid="run-overview">
    <p v-if="runs.length === 0" class="m-0 px-1 py-3 text-center text-[12px] text-muted-foreground">
      {{ t('runOverview.empty') }}
    </p>

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
        <span class="truncate">{{ place.name }}</span>
      </h2>
      <ol class="m-0 flex list-none flex-col overflow-hidden rounded-xl bg-card p-0">
        <li
          v-for="run in place.runs"
          :key="`${run.appId}:${run.id}`"
          class="relative border-t border-solid border-border first:border-t-0"
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-3 py-2.5 text-left [font:inherit] text-foreground hover:bg-card-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            :aria-label="t('runOverview.openApp', { app: run.appTitle })"
            data-testid="run-overview-run"
            @click="emit('open', run.appId)"
          >
            <img
              v-if="run.picture"
              :src="run.picture"
              alt=""
              class="size-8 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-border"
              :class="{ 'opacity-60': run.state === 'queued' }"
            />
            <span class="flex min-w-0 flex-auto flex-col">
              <span class="truncate text-[14px] leading-5">{{ run.appTitle }}</span>
              <span
                class="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground"
              >
                <LoaderCircle
                  v-if="run.state === 'running'"
                  :size="12"
                  class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <span class="truncate" data-testid="run-overview-status">{{
                  statusLine(run)
                }}</span>
              </span>
            </span>
            <span
              v-if="run.state === 'running' && run.startedAt"
              class="shrink-0 text-[12px] text-muted-foreground tabular-nums"
              >{{ elapsed(run) }}</span
            >
          </button>
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

    <section v-if="finished.length > 0" class="flex flex-col gap-2">
      <Button
        variant="muted-textonly"
        size="md"
        class="w-full justify-between px-1 text-[12px] font-medium"
        :aria-expanded="showFinished"
        data-testid="run-overview-finished-toggle"
        @click="showFinished = !showFinished"
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
        class="m-0 flex list-none flex-col overflow-hidden rounded-xl bg-card p-0"
      >
        <li
          v-for="run in finished"
          :key="`${run.appId}:${run.id}`"
          class="border-t border-solid border-border first:border-t-0"
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-3 py-2.5 text-left [font:inherit] text-foreground hover:bg-card-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            :aria-label="t('runOverview.openApp', { app: run.appTitle })"
            data-testid="run-overview-finished-run"
            @click="emit('open', run.appId)"
          >
            <img
              v-if="run.picture"
              :src="run.picture"
              alt=""
              class="size-8 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-border"
            />
            <span class="flex min-w-0 flex-auto flex-col">
              <span class="truncate text-[14px] leading-5">{{ run.appTitle }}</span>
              <span
                class="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground"
              >
                <CircleAlert
                  v-if="run.state === 'failed'"
                  :size="12"
                  class="shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <CircleCheck v-else :size="12" class="shrink-0" aria-hidden="true" />
                <span class="truncate">{{ statusLine(run) }}</span>
              </span>
            </span>
            <span class="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
              <Cloud v-if="run.where === 'cloud'" :size="12" aria-hidden="true" />
              <Laptop v-else :size="12" aria-hidden="true" />
              {{ endedLabel(run) }}
            </span>
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>
