<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import DesktopDialogSurface from './DesktopDialogSurface.vue'

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
  <DesktopDialogSurface
    :open="open"
    :aria-label="ariaLabel"
    :aria-labelledby="ariaLabelledby"
    :dismiss-on-escape="dismissOnEscape"
    :dismiss-on-outside="dismissOnOutside"
    :prevent-scroll="preventScroll"
    :overlay-class="[
      'base-modal-overlay fixed inset-0 z-60 grid place-items-center bg-neutral-800/70 px-[clamp(16px,4vw,48px)] py-[clamp(32px,6vh,72px)]',
      { 'base-modal-overlay--blur backdrop-blur-[8px] backdrop-saturate-[115%]': blurOverlay }
    ]"
    :content-class="[
      'base-modal-panel relative flex w-[var(--base-modal-width,var(--base-modal-width-md))] max-w-full flex-col overflow-hidden rounded-panel border border-solid border-border bg-[var(--modal-surface-bg)] text-neutral-100 shadow-[var(--modal-surface-shadow)] [--base-modal-width-sm:480px] [--base-modal-width-md:640px] [--base-modal-width-lg:800px] [--base-modal-width-xl:min(1080px,92vw)] max-h-[clamp(360px,80vh,920px)]',
      sizeClass,
      sizeStyleClass,
      contentClass
    ]"
    @close="emit('close')"
  >
    <Button
      v-if="showCloseButton"
      type="button"
      variant="muted-textonly"
      size="icon"
      class="base-modal-close absolute top-3.5 right-3.5 z-2"
      :aria-label="$t('common.close')"
      data-testid="base-modal-close"
      @click="emit('close')"
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
  </DesktopDialogSurface>
</template>
