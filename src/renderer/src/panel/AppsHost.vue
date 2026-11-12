<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import AppPageSkeleton from './AppPageSkeleton.vue'
import type { AppOutputs } from '../types/ipc'

const ENTER_MS = 220
const ENTER_NUDGE = 'translateX(48px)'
const ENTER_EASING_TOKEN = '--ease-out-expo'
const HOLD_MAX_MS = 1000
const REVEAL_MAX_MS = 4000
const SKELETON_LINGER_MS = 250

const {
  url,
  growBy = 0,
  covered = false,
  backdrop = null
} = defineProps<{
  url: string
  growBy?: number
  covered?: boolean
  backdrop?: string | null
}>()

const emit = defineEmits<{
  failed: [url: string]
  'app-open': [open: boolean]
  entered: []
  outputs: [outputs: AppOutputs]
}>()

const slot = useTemplateRef<HTMLElement>('slot')
const surface = useTemplateRef<HTMLElement>('surface')
const skeletonShown = ref(true)
let observer: ResizeObserver | null = null
let stopListening: (() => void) | null = null
let stopAppOpen: (() => void) | null = null
let stopOutputs: (() => void) | null = null
let stopSettled: (() => void) | null = null
let parked = true
let gone = false
let holdWidth = 0
let holdTimer: ReturnType<typeof setTimeout> | undefined
let revealTimer: ReturnType<typeof setTimeout> | undefined
let lingerTimer: ReturnType<typeof setTimeout> | undefined

function report(fresh = false): void {
  const el = slot.value
  if (!el || gone || covered) return
  const r = el.getBoundingClientRect()
  if (holdWidth && r.width >= holdWidth) holdWidth = 0
  const width = Math.max(r.width, holdWidth)
  window.api.showApps({ x: r.x, y: r.y, width, height: r.height, fresh, parked, url })
}

const reportResize = (): void => report()

function entranceEasing(): string {
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue(ENTER_EASING_TOKEN)
    .trim()
  return CSS.supports('animation-timing-function', token) ? token : 'ease-out'
}

function enter(): Promise<void> {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const easing = entranceEasing()
  const animation = surface.value?.animate(
    reducedMotion
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: ENTER_NUDGE, opacity: 0 },
          { transform: 'none', opacity: 1 }
        ],
    { duration: ENTER_MS, easing }
  )
  return animation
    ? animation.finished.then(
        () => {},
        () => {}
      )
    : Promise.resolve()
}

function pageSettled(): Promise<void> {
  return new Promise((done) => {
    stopSettled = window.api.onAppsSettled(done)
  })
}

function revealApp(): void {
  if (gone || !parked) return
  clearTimeout(revealTimer)
  parked = false
  report()
  lingerTimer = setTimeout(() => (skeletonShown.value = false), SKELETON_LINGER_MS)
}

function releaseHoldLater(): void {
  holdTimer = setTimeout(() => {
    holdWidth = 0
    report()
  }, HOLD_MAX_MS)
}

watch(
  () => covered,
  (isCovered) => (isCovered ? window.api.hideApps() : report())
)

onMounted(async () => {
  stopListening = window.api.onAppsLoadFailed(({ url: failed }) => emit('failed', failed))
  stopAppOpen = window.api.onAppsAppOpen(({ open }) => emit('app-open', open))
  stopOutputs = window.api.onAppsOutput((outputs) => emit('outputs', outputs))
  const settled = pageSettled()
  revealTimer = setTimeout(revealApp, REVEAL_MAX_MS)
  observer = new ResizeObserver(reportResize)
  if (slot.value) observer.observe(slot.value)
  window.addEventListener('resize', reportResize)
  const width = slot.value?.getBoundingClientRect().width ?? 0
  if (growBy > 0) holdWidth = width + growBy
  report(true)
  emit('entered')
  await enter()
  if (gone) return
  if (holdWidth) releaseHoldLater()
  await settled
  revealApp()
})

onBeforeUnmount(() => {
  gone = true
  clearTimeout(holdTimer)
  clearTimeout(revealTimer)
  clearTimeout(lingerTimer)
  stopListening?.()
  stopAppOpen?.()
  stopOutputs?.()
  stopSettled?.()
  observer?.disconnect()
  window.removeEventListener('resize', reportResize)
  window.api.hideApps()
})
</script>

<template>
  <div ref="slot" class="min-h-0 flex-1 overflow-hidden" data-testid="apps-host">
    <div
      ref="surface"
      class="size-full rounded-shell bg-content-background"
      data-testid="apps-host-surface"
    >
      <AppPageSkeleton v-if="skeletonShown" />
    </div>
    <img
      v-if="covered && backdrop"
      :src="backdrop"
      alt=""
      class="absolute inset-0 size-full rounded-shell object-cover"
      data-testid="apps-host-backdrop"
    />
  </div>
</template>
