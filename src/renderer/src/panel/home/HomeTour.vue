<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'
import { until } from '@vueuse/core'
import { PopoverRoot } from 'reka-ui'
import Button from '@comfyorg/design-system/button/Button'
import CoachmarkCard from '@comfyorg/design-system/card/CoachmarkCard'
import PopoverContent from '@comfyorg/design-system/popover/PopoverContent'
import { emitTelemetryAction } from '../../lib/telemetry'
import { useInstallationStore } from '../../stores/installationStore'
import { HOME_TOUR_STEPS, findHomeTourAnchor, type HomeTourStep } from './homeTourSteps'
import { useHomeTour } from './useHomeTour'

const { active, interrupted = false } = defineProps<{ active: boolean; interrupted?: boolean }>()

const HOLE_PADDING = 4
const TARGET_OPEN_WINDOW_MS = 1000

const { t } = useI18n()
const installationStore = useInstallationStore()
const { audience, done, loaded, replays, finish, markShown } = useHomeTour()
const titleId = useId()
const bodyId = useId()
const nextButton = useTemplateRef<{ $el: HTMLElement }>('nextButton')
const card = useTemplateRef<{ $el: HTMLElement }>('card')

const running = computed(() => active && loaded.value && !done.value)
const tourSteps = shallowRef<HomeTourStep[]>([])
const index = ref<number | null>(null)
const step = computed<HomeTourStep | null>(() =>
  index.value === null ? null : (tourSteps.value[index.value] ?? null)
)
const position = computed(() => ({
  current: (index.value ?? 0) + 1,
  total: tourSteps.value.length
}))
const isLast = computed(() => position.value.current === position.value.total)

const rect = shallowRef<DOMRect | null>(null)
let frame = 0
let startToken = 0
let paused: { steps: HomeTourStep[]; index: number } | null = null
let focusBeforeTour: HTMLElement | null = null
let restoreFocusOnClose = false
let pendingOpen: { step: number; expires: ReturnType<typeof setTimeout> } | null = null

function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function presentStep(from: number, direction: 1 | -1): number | null {
  for (let i = from; i >= 0 && i < tourSteps.value.length; i += direction) {
    if (findHomeTourAnchor(tourSteps.value[i]!.anchor)) return i
  }
  return null
}

function nearestPresentStep(from: number): number | null {
  return presentStep(from, 1) ?? presentStep(from, -1)
}

function trackAnchor(): void {
  const current = step.value
  const next = current
    ? (findHomeTourAnchor(current.anchor)?.getBoundingClientRect() ?? null)
    : null
  if (!next && index.value !== null) {
    const replacement = nearestPresentStep(index.value)
    if (replacement !== null && replacement !== index.value) index.value = replacement
  }
  if (!sameRect(rect.value, next)) rect.value = next
  frame = requestAnimationFrame(trackAnchor)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function homeHasRendered(): Promise<void> {
  await until(() => installationStore.loading).toBe(false)
  await nextTick()
  await nextFrame()
}

async function start(): Promise<void> {
  const token = ++startToken
  await homeHasRendered()
  if (token !== startToken || !running.value) return
  const resumed = paused !== null
  const shown =
    paused?.steps ??
    HOME_TOUR_STEPS[audience.value].filter((s) => findHomeTourAnchor(s.anchor) !== null)
  const startAt = paused?.index ?? 0
  if (shown.length === 0) return
  paused = null
  tourSteps.value = shown
  index.value = nearestPresentStep(startAt) ?? startAt
  focusBeforeTour = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (!resumed) {
    markShown()
    emitTelemetryAction('comfy.desktop.home_tour.shown', { audience: audience.value })
  }
  trackAnchor()
}

function restoreFocus(event: Event): void {
  event.preventDefault()
  if (!restoreFocusOnClose) return
  restoreFocusOnClose = false
  if (focusBeforeTour?.isConnected) focusBeforeTour.focus()
  focusBeforeTour = null
}

function clearPendingOpen(): void {
  if (pendingOpen) clearTimeout(pendingOpen.expires)
  pendingOpen = null
}

function stop(): void {
  const openedByTarget = pendingOpen !== null && !interrupted
  const openedStep = pendingOpen?.step ?? 0
  clearPendingOpen()
  startToken += 1
  cancelAnimationFrame(frame)
  if (step.value && index.value !== null) paused = { steps: tourSteps.value, index: index.value }
  if (card.value?.$el.contains(document.activeElement)) restoreFocusOnClose = true
  index.value = null
  tourSteps.value = []
  rect.value = null
  if (openedByTarget) {
    emitTelemetryAction('comfy.desktop.home_tour.target_opened', {
      audience: audience.value,
      step: openedStep
    })
    end({ returnFocus: false })
  }
}

function end({ returnFocus }: { returnFocus: boolean }): void {
  paused = null
  restoreFocusOnClose = returnFocus
  void finish()
}

watch(running, (now) => (now ? void start() : stop()), { immediate: true })
watch(replays, () => {
  paused = null
  if (index.value === null) return
  clearPendingOpen()
  startToken += 1
  cancelAnimationFrame(frame)
  index.value = null
  tourSteps.value = []
  rect.value = null
  void start()
})
watch(step, (current) => {
  if (current) findHomeTourAnchor(current.anchor)?.scrollIntoView({ block: 'nearest' })
})
watch(done, (isDone) => {
  if (isDone) paused = null
})
onBeforeUnmount(stop)

function next(): void {
  clearPendingOpen()
  if (index.value === null) return
  const target = isLast.value ? null : presentStep(index.value + 1, 1)
  if (target === null) {
    emitTelemetryAction('comfy.desktop.home_tour.completed', { audience: audience.value })
    end({ returnFocus: true })
    return
  }
  index.value = target
}

function back(): void {
  clearPendingOpen()
  if (index.value === null || index.value === 0) return
  const target = presentStep(index.value - 1, -1)
  if (target !== null) index.value = target
}

function skip(): void {
  clearPendingOpen()
  emitTelemetryAction('comfy.desktop.home_tour.skipped', {
    audience: audience.value,
    step: position.value.current
  })
  end({ returnFocus: true })
}

function elementUnderTarget(event: MouseEvent): Element | null {
  const target = event.currentTarget as HTMLElement
  const body = document.body.style
  const bodyPointerEvents = body.pointerEvents
  target.style.pointerEvents = 'none'
  body.pointerEvents = 'auto'
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  target.style.pointerEvents = ''
  body.pointerEvents = bodyPointerEvents
  return hit
}

const CONTROL = 'button, a[href], [role="button"], [role="link"]'

function isDisabled(control: HTMLElement): boolean {
  return control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true'
}

function clickableArea(hit: Element, anchor: HTMLElement): HTMLElement | null {
  let area: HTMLElement | null = null
  for (let el: Element | null = hit; el && anchor.contains(el); el = el.parentElement) {
    if (el instanceof HTMLElement && getComputedStyle(el).cursor === 'pointer') area = el
  }
  return area
}

function controlUnder(hit: Element, anchor: HTMLElement): HTMLElement | null {
  const control = hit.closest<HTMLElement>(CONTROL)
  if (control && anchor.contains(control)) return isDisabled(control) ? null : control
  return clickableArea(hit, anchor)
}

function chooseBuildCard(card: HTMLElement): void {
  const running = card.dataset['buildRunning'] === 'true'
  clearPendingOpen()
  emitTelemetryAction(
    running ? 'comfy.desktop.home_tour.target_opened' : 'comfy.desktop.home_tour.completed',
    { audience: audience.value, step: position.value.current }
  )
  end({ returnFocus: !running })
  if (running) card.click()
}

function openTarget(event: MouseEvent): void {
  const current = step.value
  const anchor = current ? findHomeTourAnchor(current.anchor) : null
  const hit = elementUnderTarget(event)
  const card = hit?.closest<HTMLElement>('[data-build-id]')
  if (anchor && card && anchor.contains(card)) {
    chooseBuildCard(card)
    return
  }
  const control = anchor && hit && anchor.contains(hit) ? controlUnder(hit, anchor) : null
  if (!control) return
  clearPendingOpen()
  pendingOpen = {
    step: position.value.current,
    expires: setTimeout(() => (pendingOpen = null), TARGET_OPEN_WINDOW_MS)
  }
  control.click()
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
    <div class="pointer-events-none fixed inset-0 z-tour" data-testid="home-tour-dim">
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
        class="pointer-events-auto absolute cursor-pointer rounded-xl ring-2 ring-ring"
        data-testid="home-tour-target"
        :style="{
          left: `${hole.x}px`,
          top: `${hole.y}px`,
          width: `${hole.w}px`,
          height: `${hole.h}px`
        }"
        @click="openTarget"
      />
    </div>
    <PopoverRoot :open="true" modal>
      <PopoverContent
        :key="step.anchor"
        :reference="reference"
        :side="step.side"
        :align="step.align"
        :side-offset="16"
        :aria-labelledby="titleId"
        :aria-describedby="bodyId"
        class="z-tour w-80 overflow-visible rounded-2xl border-0 bg-background p-0 shadow-none motion-reduce:animate-none"
        data-testid="home-tour"
        @open-auto-focus="focusNext"
        @close-auto-focus="restoreFocus"
        @interact-outside.prevent
        @escape-key-down="skip"
      >
        <CoachmarkCard
          ref="card"
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
              <span class="grid">
                <span class="col-start-1 row-start-1" :class="isLast && 'invisible'">
                  {{ t('homeTour.next') }}
                </span>
                <span class="col-start-1 row-start-1" :class="!isLast && 'invisible'">
                  {{ t('homeTour.done') }}
                </span>
              </span>
            </Button>
          </template>
        </CoachmarkCard>
      </PopoverContent>
    </PopoverRoot>
  </template>
</template>
