<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import Dialog from '@comfyorg/design-system/dialog/Dialog'
import DialogContent from '@comfyorg/design-system/dialog/DialogContent'
import DialogOverlay from '@comfyorg/design-system/dialog/DialogOverlay'
import DialogPortal from '@comfyorg/design-system/dialog/DialogPortal'
import DialogTitle from '@comfyorg/design-system/dialog/DialogTitle'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    open: boolean
    ariaLabel?: string
    ariaLabelledby?: string
    role?: 'dialog' | 'alertdialog'
    dismissOnEscape?: boolean
    dismissOnOutside?: boolean
    preventScroll?: boolean
    overlayClass?: HTMLAttributes['class']
    contentClass?: HTMLAttributes['class']
  }>(),
  {
    ariaLabel: undefined,
    ariaLabelledby: undefined,
    role: 'dialog',
    dismissOnEscape: true,
    dismissOnOutside: true,
    preventScroll: true,
    overlayClass: undefined,
    contentClass: undefined
  }
)

const emit = defineEmits<{ close: [] }>()

function onOpenChange(open: boolean): void {
  if (!open) emit('close')
}

function onEscape(event: KeyboardEvent): void {
  // An inner dialog owns Escape even when it cannot be dismissed. In a
  // separate Desktop popup, bubbling would otherwise close the host window.
  event.stopImmediatePropagation()
  if (!props.dismissOnEscape) event.preventDefault()
}

function onContentEscape(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  // Desktop's host popup also listens on window. Contain a key originating
  // in this focused dialog before it reaches that separate window handler.
  event.stopPropagation()
  event.preventDefault()
  if (props.dismissOnEscape) emit('close')
}

function onPointerDownOutside(event: Event): void {
  if (!props.dismissOnOutside) event.preventDefault()
}

function onOpenAutoFocus(event: Event): void {
  // Prefer an explicitly marked field over the library's first tabbable
  // element. Other dialogs start on their content, never a destructive CTA.
  const content = event.target
  if (event.defaultPrevented || !(content instanceof HTMLElement)) return
  event.preventDefault()
  const target = content.querySelector<HTMLElement>('[autofocus]')
  target?.focus()
  // A disabled or hidden target may refuse focus. Keep it on the dialog
  // rather than allowing the library to pick an unrelated first button.
  if (content.ownerDocument.activeElement !== target) content.focus()
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogPortal v-if="open">
      <div class="desktop-dialog-layer pointer-events-none" :class="overlayClass">
        <!-- The package overlay owns its reference-counted body scroll lock.
             Omitting it preserves the explicit preventScroll=false contract. -->
        <DialogOverlay
          v-if="preventScroll"
          class="absolute inset-0 bg-transparent pointer-events-auto data-[state=open]:animate-none data-[state=closed]:animate-none"
        />
        <div v-else class="absolute inset-0 pointer-events-auto" aria-hidden="true" />
        <DialogContent
          v-bind="$attrs"
          surface="none"
          size="fit"
          class="relative top-auto left-auto m-0 w-auto max-w-full max-h-none translate-x-0 translate-y-0 pointer-events-auto data-[state=open]:animate-none data-[state=closed]:animate-none"
          :class="contentClass"
          :role="role"
          :aria-label="ariaLabel"
          :aria-labelledby="ariaLabelledby"
          :aria-describedby="undefined"
          aria-modal="true"
          @keydown.esc="onContentEscape"
          @escape-key-down="onEscape"
          @pointer-down-outside="onPointerDownOutside"
          @open-auto-focus="onOpenAutoFocus"
        >
          <!-- Register the package title context without announcing a second
               heading. The dialog is named above by aria-label or by the
               consumer's visible heading through aria-labelledby. -->
          <DialogTitle as="span" class="hidden" aria-hidden="true" />
          <slot />
        </DialogContent>
      </div>
    </DialogPortal>
  </Dialog>
</template>
