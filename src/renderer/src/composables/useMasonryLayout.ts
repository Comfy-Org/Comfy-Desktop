import { computed, nextTick, shallowRef, toValue, watch } from 'vue'
import type { CSSProperties, MaybeRefOrGetter, Ref } from 'vue'
import { tryOnScopeDispose, useMutationObserver, useResizeObserver } from '@vueuse/core'

export interface MasonryOptions {
  minColumnWidth: number
  gap: number
  enabled: MaybeRefOrGetter<boolean>
}

interface Placement {
  column: number
  top: number
}

const UNPLACED: Placement = { column: 0, top: 0 }

function columnCountFor(width: number, minColumnWidth: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)))
}

function placeInShortestColumn(
  heights: readonly number[],
  columnCount: number,
  gap: number
): { placements: Placement[]; height: number } {
  const nextTops = new Array<number>(columnCount).fill(0)
  const placements = heights.map((height) => {
    const column = nextTops.indexOf(Math.min(...nextTops))
    const top = nextTops[column]!
    nextTops[column] = top + height + gap
    return { column, top }
  })
  return { placements, height: Math.max(0, ...nextTops.map((top) => top - gap)) }
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

export function useMasonryLayout(
  container: Readonly<Ref<HTMLElement | null>>,
  options: MasonryOptions
) {
  const { minColumnWidth, gap } = options
  const enabled = () => toValue(options.enabled)
  const columnCount = shallowRef(1)
  const items = shallowRef<HTMLElement[]>([])
  const itemHeights = shallowRef<number[]>([])

  function measure(): void {
    const el = container.value
    if (!el || !enabled()) return
    const count = columnCountFor(el.clientWidth, minColumnWidth, gap)
    if (count !== columnCount.value) {
      columnCount.value = count
      void nextTick(measure)
      return
    }
    const children = Array.from(el.children, (child) => child as HTMLElement)
    if (!sameItems(children, items.value)) items.value = children
    const heights = children.map((child) => child.getBoundingClientRect().height)
    if (!sameItems(heights, itemHeights.value)) itemHeights.value = heights
  }

  let frame: number | undefined
  function measureNextFrame(): void {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      measure()
    })
  }
  tryOnScopeDispose(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  useResizeObserver(() => (enabled() ? [container.value, ...items.value] : []), measureNextFrame)
  useMutationObserver(container, measure, { childList: true, subtree: true })
  watch([container, enabled], measure, { flush: 'post' })

  const layout = computed(() => placeInShortestColumn(itemHeights.value, columnCount.value, gap))

  const containerStyle = computed<CSSProperties | undefined>(() =>
    enabled() ? { position: 'relative', height: `${layout.value.height}px` } : undefined
  )

  function itemStyle(index: number): CSSProperties | undefined {
    if (!enabled()) return undefined
    const count = columnCount.value
    const { column, top } = layout.value.placements[index] ?? UNPLACED
    const columnWidth = `(100% - ${(count - 1) * gap}px) / ${count}`
    return {
      position: 'absolute',
      top: `${top}px`,
      left: `calc(${columnWidth} * ${column} + ${column * gap}px)`,
      width: `calc(${columnWidth})`
    }
  }

  return { containerStyle, itemStyle }
}
