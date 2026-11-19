<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PopoverRoot } from 'reka-ui'
import Button from '@comfyorg/design-system/button/Button'
import CoachmarkCard from '@comfyorg/design-system/card/CoachmarkCard'
import PopoverContent from '@comfyorg/design-system/popover/PopoverContent'
import { emitTelemetryAction } from '../../lib/telemetry'
import { HOME_TOUR_STEPS, findHomeTourAnchor, type HomeTourStep } from './homeTourSteps'
import { useHomeTour } from './useHomeTour'

const { active } = defineProps<{ active: boolean }>()

const FIRST_ANCHOR_WAIT_MS = 1500
const HOLE_PADDING = 4

const { t } = useI18n()
const { audience, done, loaded, finish } = useHomeTour()
const titleId = useId()
const bodyId = useId()
const nextButton = useTemplateRef<{ $el: HTMLElement }>('nextButton')

const steps = computed(() => HOME_TOUR_STEPS[audience.value])
const running = computed(() => active && loaded.value && !done.value)
const index = ref<number | null>(null)
const step = computed<HomeTourStep | null>(() =>
  index.value === null ? null : (steps.value[index.value] ?? null)
)
const shownSteps = shallowRef<HomeTourStep[]>([])
const position = computed(() => {
  const current = step.value ? shownSteps.value.indexOf(step.value) : -1
  return { current: current + 1, total: shownSteps.value.length }
})
const isLast = computed(() => position.value.current === position.value.total)

const rect = shallowRef<DOMRect | null>(null)
let frame = 0
let startToken = 0
let resumeAt = 0
let focusBeforeTour: HTMLElement | null = null

function nearestStep(from: number, direction: 1 | -1): number | null {
  for (let i = from; i >= 0 && i < steps.value.length; i += direction) {
    if (findHomeTourAnchor(steps.value[i]!.anchor)) return i
  }
  return null
}

function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function sameSteps(a: HomeTourStep[], b: HomeTourStep[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

function trackAnchor(): void {
  const current = step.value
  const next = current
    ? (findHomeTourAnchor(current.anchor)?.getBoundingClientRect() ?? null)
    : null
  if (!sameRect(rect.value, next)) rect.value = next
  const shown = steps.value.filter((s) => findHomeTourAnchor(s.anchor) !== null)
  if (!sameSteps(shownSteps.value, shown)) shownSteps.value = shown
  frame = requestAnimationFrame(trackAnchor)
}

function waitForFirstAnchor(token: number): Promise<void> {
  const deadline = performance.now() + FIRST_ANCHOR_WAIT_MS
  return new Promise((resolve) => {
    const poll = (): void => {
      const first = steps.value[0]
      const found = first ? findHomeTourAnchor(first.anchor) !== null : true
      if (token !== startToken || found || performance.now() >= deadline) resolve()
      else requestAnimationFrame(poll)
    }
    poll()
  })
}

async function start(): Promise<void> {
  const token = ++startToken
  await waitForFirstAnchor(token)
  if (token !== startToken || !running.value) return
  index.value = nearestStep(resumeAt, 1) ?? nearestStep(0, 1)
  if (index.value === null) return
  focusBeforeTour = document.activeElement instanceof HTMLElement ? document.activeElement : null
  emitTelemetryAction('comfy.desktop.home_tour.shown', { audience: audience.value })
  trackAnchor()
}

function stop(): void {
  startToken += 1
  cancelAnimationFrame(frame)
  if (index.value !== null) resumeAt = index.value
  index.value = null
  rect.value = null
  shownSteps.value = []
}

function end(): void {
  resumeAt = 0
  if (focusBeforeTour?.isConnected) focusBeforeTour.focus()
  focusBeforeTour = null
  void finish()
}

watch(running, (now) => (now ? void start() : stop()), { immediate: true })
watch(done, (isDone) => {
  if (isDone) resumeAt = 0
})
onBeforeUnmount(stop)

function next(): void {
  if (index.value === null) return
  const target = nearestStep(index.value + 1, 1)
  if (target === null) {
    emitTelemetryAction('comfy.desktop.home_tour.completed', { audience: audience.value })
    end()
    return
  }
  index.value = target
}

function back(): void {
  if (index.value === null) return
  const target = nearestStep(index.value - 1, -1)
  if (target !== null) index.value = target
}

function skip(): void {
  emitTelemetryAction('comfy.desktop.home_tour.skipped', {
    audience: audience.value,
    step: position.value.current
  })
  end()
}

const hole = computed(() => {
  const r = rect.value
  if (!r) return null
  return {
    x: r.x - HOLE_PADDING,
    y: r.y - HOLE_PADDING,
    w: r.width + HOLE_PADDING * 2,
    h: r.height + HOLE_PADDING * 2
  }
})

const reference = computed(() => {
  const r = rect.value
  return r ? { getBoundingClientRect: () => r } : undefined
})

function focusNext(event: Event): void {
  event.preventDefault()
  nextButton.value?.$el.focus()
}
</script>

<template>
  <template v-if="running && step && hole">
    <div class="pointer-events-none fixed inset-0 z-40" data-testid="home-tour-dim">
      <div
        class="pointer-events-auto absolute inset-x-0 top-0 bg-black/70"
        :style="{ height: `${hole.y}px` }"
      />
      <div
        class="pointer-events-auto absolute inset-x-0 bottom-0 bg-black/70"
        :style="{ top: `${hole.y + hole.h}px` }"
      />
      <div
        class="pointer-events-auto absolute left-0 bg-black/70"
        :style="{ top: `${hole.y}px`, height: `${hole.h}px`, width: `${hole.x}px` }"
      />
      <div
        class="pointer-events-auto absolute right-0 bg-black/70"
        :style="{ top: `${hole.y}px`, height: `${hole.h}px`, left: `${hole.x + hole.w}px` }"
      />
      <div
        class="pointer-events-none absolute rounded-xl ring-2 ring-ring"
        :style="{
          left: `${hole.x}px`,
          top: `${hole.y}px`,
          width: `${hole.w}px`,
          height: `${hole.h}px`
        }"
      />
    </div>
    <PopoverRoot :open="true">
      <PopoverContent
        :key="step.anchor"
        :reference="reference"
        :side="step.side"
        :align="step.align"
        :side-offset="16"
        :aria-labelledby="titleId"
        :aria-describedby="bodyId"
        class="w-80 overflow-visible rounded-2xl border-0 bg-background p-0 shadow-none"
        data-testid="home-tour"
        @open-auto-focus="focusNext"
        @interact-outside.prevent
        @escape-key-down="skip"
      >
        <CoachmarkCard
          :title="t(step.titleKey)"
          :title-id="titleId"
          :message="isLast ? `${t(step.bodyKey)} ${t('homeTour.replayHint')}` : t(step.bodyKey)"
          :message-id="bodyId"
        >
          <template #actions>
            <span class="text-xs text-muted-foreground tabular-nums">
              {{ t('homeTour.progress', position) }}
            </span>
            <span class="flex-1" />
            <Button
              :class="isLast && 'invisible'"
              variant="muted-textonly"
              size="md"
              data-testid="home-tour-skip"
              @click="skip"
            >
              {{ t('homeTour.skip') }}
            </Button>
            <Button
              :class="position.current <= 1 && 'invisible'"
              variant="secondary"
              size="md"
              data-testid="home-tour-back"
              @click="back"
            >
              {{ t('homeTour.back') }}
            </Button>
            <Button
              ref="nextButton"
              variant="inverted"
              size="md"
              data-testid="home-tour-next"
              @click="next"
            >
              {{ isLast ? t('homeTour.done') : t('homeTour.next') }}
            </Button>
          </template>
        </CoachmarkCard>
      </PopoverContent>
    </PopoverRoot>
  </template>
</template>
