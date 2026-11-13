import { computed, shallowRef, toValue, watch } from 'vue'
import type {
  ComponentPublicInstance,
  CSSProperties,
  MaybeRefOrGetter,
  Ref,
  WatchSource
} from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { VirtualItem } from '@tanstack/vue-virtual'

export interface VirtualMasonryOptions {
  scroller: Readonly<Ref<HTMLElement | null>>
  gallery: Readonly<Ref<HTMLElement | null>>
  count: MaybeRefOrGetter<number>
  itemKey: (index: number) => string
  estimateHeight: (index: number, columnWidth: number) => number
  minColumnWidth: number
  gap: MaybeRefOrGetter<number>
  relayoutWhen: WatchSource
}

const OVERSCAN_ROWS = 2

export function useVirtualMasonry(options: VirtualMasonryOptions) {
  const { scroller, gallery, minColumnWidth } = options
  const galleryWidth = shallowRef(0)
  const galleryTop = shallowRef(0)

  function measureGallery(): void {
    const list = gallery.value
    const view = scroller.value
    if (!list || !view) return
    galleryWidth.value = list.clientWidth
    galleryTop.value =
      list.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop
  }
  useResizeObserver(scroller, measureGallery)
  watch(gallery, measureGallery, { flush: 'post' })

  const lanes = computed(() => {
    const gap = toValue(options.gap)
    return Math.max(1, Math.floor((galleryWidth.value + gap) / (minColumnWidth + gap)))
  })

  const virtualizer = useVirtualizer(
    computed(() => {
      const gap = toValue(options.gap)
      const columnWidth = (galleryWidth.value - gap * (lanes.value - 1)) / lanes.value
      return {
        enabled: galleryWidth.value > 0,
        count: toValue(options.count),
        getScrollElement: () => scroller.value,
        getItemKey: (index: number) => options.itemKey(index),
        estimateSize: (index: number) => options.estimateHeight(index, columnWidth),
        lanes: lanes.value,
        gap,
        scrollMargin: galleryTop.value,
        overscan: OVERSCAN_ROWS,
        laneAssignmentMode: 'measured' as const
      }
    })
  )

  watch([options.relayoutWhen, lanes], () => virtualizer.value.measure())

  const cards = computed(() => virtualizer.value.getVirtualItems())

  const galleryStyle = computed<CSSProperties>(() => ({
    position: 'relative',
    height: `${virtualizer.value.getTotalSize()}px`
  }))

  function cardStyle(card: VirtualItem): CSSProperties {
    const gap = toValue(options.gap)
    const share = `(100% - ${gap * (lanes.value - 1)}px) / ${lanes.value}`
    return {
      position: 'absolute',
      top: 0,
      left: `calc(${share} * ${card.lane} + ${card.lane * gap}px)`,
      width: `calc(${share})`,
      transform: `translateY(${card.start - virtualizer.value.options.scrollMargin}px)`
    }
  }

  function measureCard(el: Element | ComponentPublicInstance | null): void {
    virtualizer.value.measureElement(el instanceof Element ? el : null)
  }

  return { cards, galleryStyle, cardStyle, measureCard }
}
