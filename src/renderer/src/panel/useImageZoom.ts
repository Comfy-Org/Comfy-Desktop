import { computed, ref, type Ref } from 'vue'
import { useElementSize } from '@vueuse/core'

interface ImageSize {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

interface ImageView {
  scale: number
  x: number
  y: number
}

interface Drag {
  pointerId: number
  from: Point
  start: ImageView
}

const MAX_ZOOM = 8
const WHEEL_SPEED = 0.002
const PINCH_SPEED = 0.01
const KEY_FACTOR = 1.25
const WHEEL_LINE_PX = 16
const FIT_TOLERANCE = 0.001

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function useImageZoom(
  viewport: Readonly<Ref<HTMLElement | null>>,
  natural: Readonly<Ref<ImageSize | null>>,
  enabled: Readonly<Ref<boolean>>
) {
  const { width, height } = useElementSize(viewport)
  const chosen = ref<ImageView | null>(null)
  const animate = ref(false)
  const drag = ref<Drag | null>(null)

  const ready = computed(
    () => enabled.value && natural.value !== null && width.value > 0 && height.value > 0
  )

  const fitScale = computed(() => {
    const size = natural.value
    if (!ready.value || !size) return 1
    return Math.min(1, width.value / size.width, height.value / size.height)
  })

  function placed(scale: number, x: number, y: number): ImageView {
    const size = natural.value ?? { width: 0, height: 0 }
    const shownWidth = size.width * scale
    const shownHeight = size.height * scale
    return {
      scale,
      x:
        shownWidth <= width.value
          ? (width.value - shownWidth) / 2
          : clamp(x, width.value - shownWidth, 0),
      y:
        shownHeight <= height.value
          ? (height.value - shownHeight) / 2
          : clamp(y, height.value - shownHeight, 0)
    }
  }

  const view = computed<ImageView | null>(() => {
    if (!ready.value) return null
    const current = chosen.value
    return current ? placed(current.scale, current.x, current.y) : placed(fitScale.value, 0, 0)
  })

  const fitted = computed(() => chosen.value === null)
  const scale = computed(() => chosen.value?.scale ?? null)
  const dragging = computed(() => drag.value !== null)

  const canPan = computed(() => {
    const current = view.value
    const size = natural.value
    if (!current || !size) return false
    return (
      size.width * current.scale > width.value + 0.5 ||
      size.height * current.scale > height.value + 0.5
    )
  })

  function center(): Point {
    return { x: width.value / 2, y: height.value / 2 }
  }

  function pointOf(event: MouseEvent): Point {
    const box = viewport.value?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }

  function fit(smooth = false): void {
    animate.value = smooth
    chosen.value = null
  }

  function zoomTo(next: number, at: Point = center(), smooth = false): void {
    const current = view.value
    if (!current) return
    const imageX = (at.x - current.x) / current.scale
    const imageY = (at.y - current.y) / current.scale
    animate.value = smooth
    chosen.value = placed(next, at.x - imageX * next, at.y - imageY * next)
  }

  function zoomBy(factor: number, at: Point = center(), smooth = false): void {
    const current = view.value
    if (!current) return
    const next = current.scale * factor
    if (factor < 1 && next <= fitScale.value + FIT_TOLERANCE) {
      fit(smooth)
      return
    }
    zoomTo(clamp(next, fitScale.value, Math.max(MAX_ZOOM, fitScale.value)), at, smooth)
  }

  function onWheel(event: WheelEvent): void {
    if (!view.value) return
    event.preventDefault()
    const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1)
    const speed = event.ctrlKey ? PINCH_SPEED : WHEEL_SPEED
    zoomBy(Math.exp(-delta * speed), pointOf(event))
  }

  function onPointerDown(event: PointerEvent): void {
    const current = view.value
    if (event.button !== 0 || !canPan.value || !current) return
    event.preventDefault()
    ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
    animate.value = false
    drag.value = {
      pointerId: event.pointerId,
      from: { x: event.clientX, y: event.clientY },
      start: current
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const active = drag.value
    if (!active || event.pointerId !== active.pointerId) return
    chosen.value = placed(
      active.start.scale,
      active.start.x + event.clientX - active.from.x,
      active.start.y + event.clientY - active.from.y
    )
  }

  function onPointerUp(event: PointerEvent): void {
    if (drag.value?.pointerId === event.pointerId) drag.value = null
  }

  function onDoubleClick(event: MouseEvent): void {
    if (!view.value) return
    if (fitted.value) zoomTo(1, pointOf(event), true)
    else fit(true)
  }

  function onKey(key: string): boolean {
    if (!view.value) return false
    if (key === '+' || key === '=') zoomBy(KEY_FACTOR, center(), true)
    else if (key === '-') zoomBy(1 / KEY_FACTOR, center(), true)
    else if (key === '0') fit(true)
    else return false
    return true
  }

  function reset(): void {
    chosen.value = null
    drag.value = null
    animate.value = false
  }

  return {
    view,
    fitted,
    scale,
    canPan,
    dragging,
    animate,
    fit,
    zoomTo,
    reset,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    onKey
  }
}
