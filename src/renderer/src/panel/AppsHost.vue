<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

const SLIDE_MS = 480
const HOLD_MAX_MS = 1000

const { url, growBy = 0 } = defineProps<{
  url: string
  growBy?: number
}>()

const emit = defineEmits<{
  failed: [url: string]
  'app-open': [open: boolean]
  entered: []
}>()

const slot = useTemplateRef<HTMLElement>('slot')
let observer: ResizeObserver | null = null
let stopListening: (() => void) | null = null
let stopAppOpen: (() => void) | null = null
let offset = 0
let holdWidth = 0
let frame = 0
let holdTimer: ReturnType<typeof setTimeout> | undefined

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

function report(fresh = false): void {
  const el = slot.value
  if (!el) return
  const r = el.getBoundingClientRect()
  if (holdWidth && r.width >= holdWidth) holdWidth = 0
  const width = Math.max(r.width, holdWidth)
  window.api.showApps({ x: r.x + offset, y: r.y, width, height: r.height, fresh, url })
}

const reportResize = (): void => report()

function slideIn(distance: number): Promise<void> {
  return new Promise((done) => {
    const start = performance.now()
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / SLIDE_MS)
      offset = distance * (1 - easeOutCubic(t))
      report()
      if (t < 1) frame = requestAnimationFrame(tick)
      else done()
    }
    frame = requestAnimationFrame(tick)
  })
}

function releaseHoldLater(): void {
  holdTimer = setTimeout(() => {
    holdWidth = 0
    report()
  }, HOLD_MAX_MS)
}

onMounted(async () => {
  stopListening = window.api.onAppsLoadFailed(({ url: failed }) => emit('failed', failed))
  stopAppOpen = window.api.onAppsAppOpen(({ open }) => emit('app-open', open))
  observer = new ResizeObserver(reportResize)
  if (slot.value) observer.observe(slot.value)
  window.addEventListener('resize', reportResize)
  const width = slot.value?.getBoundingClientRect().width ?? 0
  if (growBy > 0) holdWidth = width + growBy
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  offset = reduced ? 0 : width
  report(true)
  if (!reduced) await slideIn(width)
  emit('entered')
  if (holdWidth) releaseHoldLater()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  clearTimeout(holdTimer)
  stopListening?.()
  stopAppOpen?.()
  observer?.disconnect()
  window.removeEventListener('resize', reportResize)
  window.api.hideApps()
})
</script>

<template>
  <div ref="slot" class="panel-apps min-h-0 flex-1" data-testid="apps-host" />
</template>
