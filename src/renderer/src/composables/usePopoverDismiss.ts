import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Open/close state plus dismissal rules for a small anchored popover menu:
 * Escape closes and refocuses the trigger, and a pointer-down outside the
 * root closes. Shared so every popover dismisses the same way.
 */
export function usePopoverDismiss(options: {
  /** Element containing both the trigger and the menu; clicks inside it stay open. */
  rootRef: Ref<HTMLElement | null>
  /** The trigger element, refocused when Escape closes the menu. */
  faceRef: Ref<HTMLElement | null>
}): {
  menuOpen: Ref<boolean>
  closeMenu: () => void
  toggleMenu: () => void
  onKeydown: (event: KeyboardEvent) => void
} {
  const menuOpen = ref(false)

  function closeMenu(): void {
    menuOpen.value = false
  }

  function toggleMenu(): void {
    menuOpen.value = !menuOpen.value
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && menuOpen.value) {
      event.stopPropagation()
      closeMenu()
      options.faceRef.value?.focus()
    }
  }

  function onPointerDown(event: MouseEvent): void {
    if (!menuOpen.value) return
    const target = event.target as Node | null
    if (target && options.rootRef.value?.contains(target)) return
    closeMenu()
  }

  onMounted(() => {
    document.addEventListener('mousedown', onPointerDown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onPointerDown)
  })

  return { menuOpen, closeMenu, toggleMenu, onKeydown }
}
