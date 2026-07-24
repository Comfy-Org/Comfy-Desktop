import { ref, type Ref } from 'vue'

/** Tracks whether an element's text is clipped. Call `check()` on hover/focus
 *  to gate a "show tooltip only when truncated" pattern — avoids a per-element
 *  ResizeObserver. */
export function useTruncation(el: Ref<HTMLElement | null>): {
  isTruncated: Ref<boolean>
  check: () => void
} {
  const isTruncated = ref(false)
  const check = (): void => {
    isTruncated.value = !!el.value && el.value.scrollWidth > el.value.clientWidth
  }
  return { isTruncated, check }
}
