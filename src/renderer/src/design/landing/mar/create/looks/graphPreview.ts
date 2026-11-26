import { computed, onBeforeUnmount, reactive, ref, type Ref } from 'vue'

const LINGER_MS = 220
const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.5

export interface GraphPreviewExit<T> {
  top?: (item: T) => number
}

export function useGraphPreview<T extends { id: string }>(exit: GraphPreviewExit<T> = {}) {
  const preview = ref(null) as Ref<T | null>
  const dragging = ref(false)
  const view = reactive({ x: 0, y: 0, k: 1 })
  let linger: ReturnType<typeof setTimeout> | undefined
  let drag: { x: number; y: number } | null = null

  function stay(): void {
    clearTimeout(linger)
  }

  function show(item: T): void {
    stay()
    if (preview.value?.id !== item.id) Object.assign(view, { x: 0, y: 0, k: 1 })
    preview.value = item
  }

  function endPreview(): void {
    stay()
    preview.value = null
    dragging.value = false
    drag = null
  }

  function endSoon(): void {
    stay()
    if (!preview.value || dragging.value) return
    linger = setTimeout(endPreview, LINGER_MS)
  }

  function onStageEnter(): void {
    if (preview.value) stay()
  }

  function onStageLeave(): void {
    if (!dragging.value) endSoon()
  }

  function onDown(e: PointerEvent): void {
    if (!preview.value || e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY }
    dragging.value = true
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  function exitsAtTop(e: PointerEvent): boolean {
    const edge = preview.value && exit.top ? exit.top(preview.value) : 0
    return edge > 0 && e.clientY - (e.currentTarget as Element).getBoundingClientRect().top < edge
  }

  function onMove(e: PointerEvent): void {
    if (!drag) {
      if (exitsAtTop(e)) endPreview()
      return
    }
    view.x += e.clientX - drag.x
    view.y += e.clientY - drag.y
    drag = { x: e.clientX, y: e.clientY }
  }

  function onUp(e: PointerEvent): void {
    if (!drag) return
    drag = null
    dragging.value = false
    const el = e.currentTarget as Element
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (!inside) endSoon()
  }

  function onWheel(e: WheelEvent): void {
    if (!preview.value) return
    e.preventDefault()
    stay()
    const up = e.deltaY < 0 && !e.ctrlKey
    if (up && !dragging.value && view.k >= 1) return endPreview()
    const r = (e.currentTarget as Element).getBoundingClientRect()
    const sx = e.clientX - r.left - r.width / 2
    const sy = e.clientY - r.top - r.height / 2
    const k = Math.min(
      up ? 1 : ZOOM_MAX,
      Math.max(ZOOM_MIN, view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    )
    const f = k / view.k
    view.x = sx - (sx - view.x) * f
    view.y = sy - (sy - view.y) * f
    view.k = k
  }

  const panStyle = computed(() => ({
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`
  }))

  function dotsStyle(grid: number, layers: number, dots: number) {
    const size = grid * view.k
    const sizes = Array.from({ length: layers }, () => 'auto')
    const positions = Array.from({ length: layers }, () => '0 0')
    sizes[dots] = `${size}px ${size}px`
    positions[dots] = `calc(50% + ${view.x}px) calc(50% + ${view.y}px)`
    return { backgroundSize: sizes.join(', '), backgroundPosition: positions.join(', ') }
  }

  onBeforeUnmount(stay)

  return {
    preview,
    dragging,
    stay,
    show,
    endPreview,
    endSoon,
    onStageEnter,
    onStageLeave,
    onDown,
    onMove,
    onUp,
    onWheel,
    panStyle,
    dotsStyle
  }
}
