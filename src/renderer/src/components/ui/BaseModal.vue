<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import { useModalOverlay } from '../../composables/useModalOverlay'

// Reusable modal primitive. Owns teleport, dismiss, focus capture/restore,
// body scroll lock, and a11y attrs. One of aria-label / aria-labelledby is
// required (it is the modal element for assistive tech).

type Size = 'sm' | 'md' | 'lg' | 'xl'

interface Props {
  open: boolean
  size?: Size
  ariaLabel?: string
  ariaLabelledby?: string
  dismissOnEscape?: boolean
  dismissOnOutside?: boolean
  showCloseButton?: boolean
  preventScroll?: boolean
  /** Opt-in: backdrop-filter is GPU-bound and costly on Electron. */
  blurOverlay?: boolean
  contentClass?: string | string[] | Record<string, boolean>
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  ariaLabel: undefined,
  ariaLabelledby: undefined,
  dismissOnEscape: true,
  dismissOnOutside: true,
  showCloseButton: true,
  preventScroll: true,
  blurOverlay: false,
  contentClass: undefined
})

const emit = defineEmits<{ close: [] }>()

if (!props.ariaLabel && !props.ariaLabelledby) {
  console.warn(
    '[BaseModal] requires `aria-label` or `aria-labelledby` — modal has no accessible name.'
  )
}

const dialogRef = ref<HTMLElement | null>(null)
// Pre-open focus owner, restored on close so focus returns to the trigger.
let returnFocusTo: HTMLElement | null = null
// Prior body `overflow`, restored so we don't clobber a host-set value.
let previousBodyOverflow: string | null = null

const { handleOverlayMouseDown, handleOverlayClick } = useModalOverlay(
  // Re-checks the prop so a same-tick dismiss flip still wins.
  () => props.open && props.dismissOnEscape,
  () => emit('close')
)

function onOverlayMouseDown(e: MouseEvent) {
  if (!props.dismissOnOutside) return
  handleOverlayMouseDown(e)
}
function onOverlayClick(e: MouseEvent) {
  if (!props.dismissOnOutside) return
  handleOverlayClick(e)
}

function onCloseClick(): void {
  emit('close')
}

function lockBodyScroll(): void {
  if (!props.preventScroll) return
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll(): void {
  if (previousBodyOverflow === null) return
  document.body.style.overflow = previousBodyOverflow
  previousBodyOverflow = null
}

function captureAndFocus(): void {
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // Focus the dialog container, not the close button — keeps focus trapped for
  // keyboard/AT without painting a focus-visible ring on open.
  void nextTick(() => dialogRef.value?.focus())
}

function restoreFocus(): void {
  try {
    returnFocusTo?.focus()
  } catch {
    // Original trigger may have been removed from the DOM while open.
  }
  returnFocusTo = null
}

// Focus + scroll-lock flip synchronously (not via the Transition) so they
// don't leak past dismiss or overlap an immediate re-open.
watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      lockBodyScroll()
      captureAndFocus()
    } else if (!isOpen && wasOpen) {
      unlockBodyScroll()
      restoreFocus()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  // Defensive: parent may unmount us while still open.
  unlockBodyScroll()
  restoreFocus()
})

const sizeClass = computed(() => `is-size-${props.size}`)
const sizeStyleClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return '[--base-modal-width:var(--base-modal-width-sm)] min-h-auto'
    case 'lg':
      return '[--base-modal-width:var(--base-modal-width-lg)] min-h-[clamp(360px,50vh,540px)]'
    case 'xl':
      return '[--base-modal-width:var(--base-modal-width-xl)] min-h-[clamp(360px,50vh,540px)]'
    default:
      return '[--base-modal-width:var(--base-modal-width-md)] min-h-[clamp(360px,50vh,540px)]'
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade" appear>
      <div
        v-if="open"
        ref="dialogRef"
        class="base-modal-overlay fixed inset-0 z-60 grid place-items-center bg-neutral-800/70 px-[clamp(16px,4vw,48px)] py-[clamp(32px,6vh,72px)] focus:outline-none"
        :class="{
          'base-modal-overlay--blur backdrop-blur-[8px] backdrop-saturate-[115%]': blurOverlay
        }"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        :aria-labelledby="ariaLabelledby"
        tabindex="-1"
        @mousedown="onOverlayMouseDown"
        @click="onOverlayClick"
      >
        <div
          class="base-modal-panel modal-fade-panel relative flex w-[var(--base-modal-width,var(--base-modal-width-md))] max-w-full flex-col overflow-hidden rounded-panel border border-solid border-border bg-[var(--modal-surface-bg)] text-neutral-100 shadow-[var(--modal-surface-shadow)] [--base-modal-width-sm:480px] [--base-modal-width-md:640px] [--base-modal-width-lg:800px] [--base-modal-width-xl:min(1080px,92vw)] max-h-[clamp(360px,80vh,920px)]"
          :class="[sizeClass, sizeStyleClass, contentClass]"
        >
          <Button
            v-if="showCloseButton"
            type="button"
            variant="textonly"
            size="unset"
            class="base-modal-close absolute top-3.5 right-3.5 z-2 size-8 rounded-lg border border-solid border-transparent bg-text/4 p-0 text-neutral-100 opacity-70 [appearance:button] transition-[background,border-color,opacity] duration-[120ms] ease-[ease] hover:border-neutral-100/44 hover:bg-neutral-950/85 hover:opacity-100 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring,var(--neutral-50))]"
            :aria-label="$t('common.close')"
            data-testid="base-modal-close"
            @click="onCloseClick"
          >
            <X :size="18" />
          </Button>
          <header
            v-if="$slots.header"
            class="base-modal-header border-b border-solid border-neutral-100/8 pt-5 pr-14 pb-3 pl-6"
          >
            <slot name="header" />
          </header>
          <div class="base-modal-body min-h-0 flex-auto overflow-y-auto px-6 py-4">
            <slot />
          </div>
          <footer
            v-if="$slots.footer"
            class="base-modal-footer flex items-center justify-end gap-2 border-t border-solid border-neutral-100/8 px-6 pt-3 pb-4"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
