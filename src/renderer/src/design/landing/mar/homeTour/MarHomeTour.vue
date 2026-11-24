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
import { PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import Button from '../../ui/Button.vue'
import { cn } from '../../ui/cn'
import { floatingSurface } from '../../ui/menu.styles'
import { PORTAL_TO } from '../../ui/portal'
import {
  HOME_TOUR_STEPS,
  HOME_TOUR_TEXT,
  findHomeTourAnchor,
  type HomeTourStep
} from './homeTourSteps'
import { finishHomeTour, homeTour, homeTourAudience, homeTourDone } from './homeTour'

const { active } = defineProps<{ active: boolean }>()

const HOLE_PADDING = 4
const CARD_WIDTH = 320
const SIDE_OFFSET = 16

const titleId = useId()
const bodyId = useId()
const nextButton = useTemplateRef<{ $el: HTMLElement }>('nextButton')
const card = useTemplateRef<HTMLElement>('card')

const running = computed(() => active && !homeTourDone.value)
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
  await nextTick()
  await nextFrame()
  await new Promise((resolve) => setTimeout(resolve, 400))
}

async function start(): Promise<void> {
  const token = ++startToken
  await homeHasRendered()
  if (token !== startToken || !running.value) return
  const shown =
    paused?.steps ??
    HOME_TOUR_STEPS[homeTourAudience.value].filter((s) => findHomeTourAnchor(s.anchor) !== null)
  const startAt = paused?.index ?? 0
  if (shown.length === 0) return
  paused = null
  tourSteps.value = shown
  index.value = nearestPresentStep(startAt) ?? startAt
  focusBeforeTour = document.activeElement instanceof HTMLElement ? document.activeElement : null
  trackAnchor()
}

function restoreFocus(event: Event): void {
  event.preventDefault()
  if (!restoreFocusOnClose) return
  restoreFocusOnClose = false
  if (focusBeforeTour?.isConnected) focusBeforeTour.focus()
  focusBeforeTour = null
}

function clear(): void {
  startToken += 1
  cancelAnimationFrame(frame)
  index.value = null
  tourSteps.value = []
  rect.value = null
}

function stop(): void {
  if (step.value && index.value !== null) paused = { steps: tourSteps.value, index: index.value }
  if (card.value?.contains(document.activeElement)) restoreFocusOnClose = true
  clear()
}

function end({ returnFocus }: { returnFocus: boolean }): void {
  paused = null
  restoreFocusOnClose = returnFocus
  finishHomeTour()
}

watch(running, (now) => (now ? void start() : stop()), { immediate: true })
watch(
  () => homeTour.replays,
  () => {
    paused = null
    clear()
    if (running.value) void start()
  }
)
watch(
  () => homeTourAudience.value,
  () => {
    paused = null
    clear()
    if (running.value) void start()
  }
)
watch(step, (current) => {
  if (current) findHomeTourAnchor(current.anchor)?.scrollIntoView({ block: 'nearest' })
})
watch(homeTourDone, (isDone) => {
  if (isDone) paused = null
})
onBeforeUnmount(stop)

function next(): void {
  if (index.value === null) return
  const target = isLast.value ? null : presentStep(index.value + 1, 1)
  if (target === null) {
    end({ returnFocus: true })
    return
  }
  index.value = target
}

function back(): void {
  if (index.value === null || index.value === 0) return
  const target = presentStep(index.value - 1, -1)
  if (target !== null) index.value = target
}

function skip(): void {
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

function openTarget(event: MouseEvent): void {
  const current = step.value
  const anchor = current ? findHomeTourAnchor(current.anchor) : null
  const hit = elementUnderTarget(event)
  const control = anchor && hit && anchor.contains(hit) ? controlUnder(hit, anchor) : null
  if (!control) return
  end({ returnFocus: false })
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

const side = computed<HomeTourStep['side']>(() => {
  const r = rect.value
  const wanted = step.value?.side ?? 'right'
  if (!r || wanted !== 'right') return wanted
  const room = CARD_WIDTH + SIDE_OFFSET * 2
  const fitsBeside = r.right + room <= window.innerWidth || r.left - room >= 0
  return fitsBeside ? 'right' : 'top'
})

const reference = computed(() => {
  const r = rect.value
  return r ? { getBoundingClientRect: () => r } : undefined
})

const message = computed(() =>
  step.value
    ? isLast.value
      ? `${step.value.body} ${HOME_TOUR_TEXT.replayHint}`
      : step.value.body
    : ''
)

function focusNext(event: Event): void {
  event.preventDefault()
  nextButton.value?.$el.focus()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="running && step && hole"
      class="proto-ui pointer-events-none fixed inset-0 z-[75]"
      data-testid="home-tour-dim"
    >
      <div
        class="mht-dim pointer-events-auto absolute inset-x-0 top-0"
        :style="{ height: `${hole.y}px` }"
      />
      <div
        class="mht-dim pointer-events-auto absolute inset-x-0 bottom-0"
        :style="{ top: `${hole.y + hole.h}px` }"
      />
      <div
        class="mht-dim pointer-events-auto absolute left-0"
        :style="{ top: `${hole.y}px`, height: `${hole.h}px`, width: `${hole.x}px` }"
      />
      <div
        class="mht-dim pointer-events-auto absolute right-0"
        :style="{ top: `${hole.y}px`, height: `${hole.h}px`, left: `${hole.x + hole.w}px` }"
      />
      <div
        class="mht-target pointer-events-auto absolute cursor-pointer rounded-card"
        data-testid="home-tour-target"
        :style="{
          left: `${hole.x}px`,
          top: `${hole.y}px`,
          width: `${hole.w}px`,
          height: `${hole.h}px`
        }"
        @click="openTarget($event)"
      />
    </div>
  </Teleport>
  <PopoverRoot v-if="running && step && hole" :open="true" modal>
    <PopoverPortal :to="PORTAL_TO">
      <PopoverContent
        :key="step.anchor"
        :reference="reference"
        :side="side"
        :align="step.align"
        :side-offset="SIDE_OFFSET"
        :collision-padding="16"
        :aria-labelledby="titleId"
        :aria-describedby="bodyId"
        :class="cn(floatingSurface, 'z-[76] w-80 rounded-panel p-0 motion-reduce:animate-none')"
        @open-auto-focus="focusNext"
        @close-auto-focus="restoreFocus"
        @interact-outside.prevent
        @escape-key-down="skip"
      >
        <div ref="card" class="flex flex-col gap-6 p-4" data-testid="home-tour">
          <div class="flex flex-col gap-2">
            <h3 :id="titleId" class="text-heading font-semibold text-base-foreground">
              {{ step.title }}
            </h3>
            <p :id="bodyId" class="text-ui text-muted-foreground">{{ message }}</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-ui text-subtle-foreground tabular-nums">
              {{ HOME_TOUR_TEXT.progress(position.current, position.total) }}
            </span>
            <div class="ml-auto flex items-center gap-2" data-testid="home-tour-buttons">
              <Button v-if="!isLast" variant="ghost" data-testid="home-tour-skip" @click="skip">
                {{ HOME_TOUR_TEXT.skip }}
              </Button>
              <Button
                v-if="position.current > 1"
                variant="secondary"
                data-testid="home-tour-back"
                @click="back"
              >
                {{ HOME_TOUR_TEXT.back }}
              </Button>
              <Button ref="nextButton" variant="primary" data-testid="home-tour-next" @click="next">
                <span class="grid">
                  <span class="col-start-1 row-start-1" :class="isLast && 'invisible'">
                    {{ HOME_TOUR_TEXT.next }}
                  </span>
                  <span class="col-start-1 row-start-1" :class="!isLast && 'invisible'">
                    {{ HOME_TOUR_TEXT.done }}
                  </span>
                </span>
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
.mht-dim {
  background: oklch(0 0 0 / 0.7);
}
.mht-target {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
