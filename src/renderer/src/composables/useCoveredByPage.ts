import { onBeforeUnmount, onMounted, ref, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

const PROBE_SPACING_PX = 40
const EDGE_INSET_PX = 1
const SETTLED_EVENTS = ['transitionend', 'animationend'] as const
const FLOATING_LAYERS = '[data-reka-popper-content-wrapper]'

function probeOffsets(length: number): number[] {
  const last = length - EDGE_INSET_PX
  if (last <= EDGE_INSET_PX) return []
  const offsets: number[] = []
  for (let offset = EDGE_INSET_PX; offset < last; offset += PROBE_SPACING_PX) offsets.push(offset)
  offsets.push(last)
  return offsets
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

export function isCoveredByPage(target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect()
  for (const layer of document.querySelectorAll(FLOATING_LAYERS)) {
    if (!target.contains(layer) && overlaps(layer.getBoundingClientRect(), rect)) return true
  }
  const columns = probeOffsets(rect.width)
  for (const top of probeOffsets(rect.height)) {
    for (const left of columns) {
      const hit = document.elementFromPoint(rect.left + left, rect.top + top)
      if (hit && !target.contains(hit) && !hit.contains(target)) return true
    }
  }
  return false
}

export function useCoveredByPage(target: MaybeRefOrGetter<HTMLElement | null>): Ref<boolean> {
  const covered = ref(false)
  let frame = 0
  let observer: MutationObserver | null = null

  function measure(): void {
    frame = 0
    const element = toValue(target)
    covered.value = element ? isCoveredByPage(element) : false
  }

  function scheduleMeasure(): void {
    if (frame === 0) frame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    observer = new MutationObserver(scheduleMeasure)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    for (const settled of SETTLED_EVENTS) document.addEventListener(settled, scheduleMeasure, true)
    window.addEventListener('resize', scheduleMeasure)
    measure()
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    for (const settled of SETTLED_EVENTS)
      document.removeEventListener(settled, scheduleMeasure, true)
    window.removeEventListener('resize', scheduleMeasure)
    if (frame !== 0) cancelAnimationFrame(frame)
  })

  return covered
}
