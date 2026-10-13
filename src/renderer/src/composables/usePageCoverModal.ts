import { nextTick, onUnmounted, watch, type Ref } from 'vue'

// Dialogs paint above a page cover and keep their own focus and Escape. The
// page and wizards underneath are inert (PAGE_COVERED).
function isInLiveDialog(el: Element | null, cover: HTMLElement | null): boolean {
  const dialog = el?.closest('[aria-modal="true"]')
  return !!dialog && dialog !== cover && !dialog.closest('[inert]')
}

/** Focus and Escape for a title-bar modal that covers the page but sits below dialogs. */
export function usePageCoverModal(
  isOpen: () => boolean,
  cover: Readonly<Ref<HTMLElement | null>>,
  dismiss: () => void
): void {
  let returnFocusTo: HTMLElement | null = null

  // Window capture runs before the document Escape handlers of wizards underneath.
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || isInLiveDialog(document.activeElement, cover.value)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    dismiss()
  }

  function open(): void {
    window.addEventListener('keydown', onKeydown, true)
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Focus the container, not a button, so open paints no focus ring.
    void nextTick(() => {
      if (!isInLiveDialog(document.activeElement, cover.value)) cover.value?.focus()
    })
  }

  function close(): void {
    window.removeEventListener('keydown', onKeydown, true)
    returnFocusTo?.focus()
    returnFocusTo = null
  }

  // Post-flush, so the page underneath is no longer inert when focus returns to it.
  watch(
    isOpen,
    (now, was) => {
      if (now && !was) open()
      else if (!now && was) close()
    },
    { immediate: true, flush: 'post' }
  )
  onUnmounted(() => {
    if (isOpen()) close()
  })
}
