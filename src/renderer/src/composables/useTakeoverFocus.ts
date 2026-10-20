import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'

/**
 * A full-window takeover's focus: on mount, focus its `[autofocus]` control
 * (e.g. a text input that should be ready to type) or else the dialog root
 * itself, not the first button, so keyboard and AT users start inside it
 * without a ring on a control they did not tab to. On unmount, give focus
 * back to whatever had it, if that is still on the page.
 */
export function useTakeoverFocus(root: Readonly<Ref<HTMLElement | null>>): void {
  let returnFocusTo: HTMLElement | null = null

  onMounted(() => {
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void nextTick(() =>
      (root.value?.querySelector<HTMLElement>('[autofocus]') ?? root.value)?.focus()
    )
  })

  onBeforeUnmount(() => {
    if (returnFocusTo?.isConnected) returnFocusTo.focus()
    returnFocusTo = null
  })
}
