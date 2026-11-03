<script setup lang="ts">
import { computed, useId } from 'vue'
import { X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import DesktopDialogSurface from './DesktopDialogSurface.vue'
import { linkify, handleModalLinkClick } from '../../lib/modalLinkify'
import type { ModalDetailGroup } from '../../types/ipc'

// Compact alert primitive. Footer supports up to three actions in order
// `[Cancel] [Secondary] [Primary]`. Use BaseModal for richer header/footer
// needs; not BaseSelect (the inline form combobox).

interface Props {
  open: boolean
  title: string
  message?: string
  /** Low-emphasis guidance rendered below the main content. */
  hint?: string
  buttonLabel?: string
  /** Render Cancel + primary; ESC / backdrop emit `cancel`. */
  showCancel?: boolean
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  /** Middle action between Cancel and Primary; emits `@secondary`. */
  secondaryLabel?: string
  secondaryTone?: 'primary' | 'danger' | 'default'
  /** Header ✕ that emits `cancel`. Mutually exclusive with `showCancel`. */
  showCloseIcon?: boolean
  /** Recessed sub-blocks below the message (release notes, change summaries). */
  messageDetails?: ModalDetailGroup[]
  ariaLabel?: string
  ariaLabelledby?: string
  dismissOnEscape?: boolean
  dismissOnOutside?: boolean
  preventScroll?: boolean
  testIdRoot?: string
  testIdAction?: string
  testIdCancel?: string
  testIdSecondary?: string
  testIdCloseIcon?: string
}

const props = withDefaults(defineProps<Props>(), {
  message: '',
  hint: '',
  buttonLabel: undefined,
  showCancel: false,
  cancelLabel: undefined,
  tone: 'primary',
  secondaryLabel: undefined,
  secondaryTone: 'default',
  showCloseIcon: false,
  messageDetails: () => [],
  ariaLabel: undefined,
  ariaLabelledby: undefined,
  dismissOnEscape: true,
  dismissOnOutside: true,
  preventScroll: true,
  testIdRoot: undefined,
  testIdAction: undefined,
  testIdCancel: undefined,
  testIdSecondary: undefined,
  testIdCloseIcon: undefined
})

const emit = defineEmits<{ close: []; cancel: []; secondary: [] }>()

const TITLE_ID = `base-alert-title-${useId()}`

const dialogAriaLabel = computed(() => props.ariaLabel)
const dialogAriaLabelledby = computed(
  () => props.ariaLabelledby ?? (props.ariaLabel ? undefined : TITLE_ID)
)

// ESC + backdrop dismiss as cancel when a cancel affordance exists,
// else as primary OK. Secondary never receives ESC/backdrop dismissal.
function dismiss(): void {
  if (props.showCancel || props.showCloseIcon) emit('cancel')
  else emit('close')
}

const hasDetails = computed(() => props.messageDetails.length > 0)
const linkifiedMessage = computed(() => linkify(props.message))
// A secondary action means two non-cancel buttons, which need a wider panel.
const hasWideActions = computed(() => !!props.secondaryLabel)

const actionVariants = { default: 'secondary', primary: 'inverted', danger: 'destructive' } as const

const panelWidthClass = computed(() => {
  if (hasWideActions.value) return hasDetails.value ? 'w-[min(540px,100%)]' : 'w-[min(520px,100%)]'
  return hasDetails.value ? 'w-[min(480px,100%)]' : 'w-[min(440px,100%)]'
})

const linkClass =
  '[&_.modal-link]:cursor-pointer [&_.modal-link]:text-[var(--accent)] [&_.modal-link]:underline'

function onCancelClick(): void {
  emit('cancel')
}

function onActionClick(): void {
  emit('close')
}

function onSecondaryClick(): void {
  emit('secondary')
}

function onCloseIconClick(): void {
  emit('cancel')
}
</script>

<template>
  <DesktopDialogSurface
    :open="open"
    role="alertdialog"
    :aria-label="dialogAriaLabel"
    :aria-labelledby="dialogAriaLabelledby"
    :dismiss-on-escape="dismissOnEscape"
    :dismiss-on-outside="dismissOnOutside"
    :prevent-scroll="preventScroll"
    :data-testid="testIdRoot"
    overlay-class="base-alert-overlay fixed inset-0 z-[1000] grid place-items-center bg-neutral-800/60 px-[clamp(16px,4vw,48px)] py-[clamp(32px,6vh,72px)]"
    :content-class="[
      'base-alert-panel flex min-w-80 flex-col overflow-hidden rounded-panel border border-solid border-border bg-neutral-800 px-6 py-4 text-neutral-100 shadow-[var(--modal-surface-shadow)]',
      panelWidthClass,
      hasDetails ? 'max-h-[min(80vh,640px)]' : 'max-h-[min(80vh,560px)]',
      { 'base-alert-panel--rich': hasDetails, 'base-alert-panel--wide-actions': hasWideActions }
    ]"
    @close="dismiss"
  >
    <header
      class="base-alert-header relative -mx-6 mb-3 border-b border-solid border-neutral-100/8 px-6 pb-3"
    >
      <h2 :id="TITLE_ID" class="base-alert-title m-0 pr-8 text-base leading-[1.3] font-semibold">
        {{ title }}
      </h2>
      <Button
        v-if="showCloseIcon"
        type="button"
        variant="muted-textonly"
        size="icon"
        class="base-alert-close-icon absolute -top-1 right-[18px]"
        :aria-label="$t('common.close')"
        :data-testid="testIdCloseIcon ?? 'base-alert-close-icon'"
        @click="onCloseIconClick"
      >
        <X :size="16" />
      </Button>
    </header>
    <div
      v-if="message || hint || hasDetails || $slots.default || $slots.extra"
      class="base-alert-message mb-5 min-h-0 flex-auto overflow-y-auto text-sm leading-[1.5] whitespace-pre-line text-text-muted select-text"
    >
      <slot>
        <div
          v-if="message"
          class="base-alert-message-text whitespace-pre-line [&_strong]:font-semibold [&_strong]:text-text"
          :class="linkClass"
          @click="handleModalLinkClick"
          v-html="linkifiedMessage"
        ></div>
        <div v-if="hasDetails" class="base-alert-details mt-3 flex flex-col gap-2">
          <div
            v-for="(group, gi) in messageDetails"
            :key="gi"
            class="base-alert-detail-group flex flex-col gap-1"
          >
            <span
              class="base-alert-detail-label text-xs leading-[1.5] font-semibold tracking-[0.04em] text-text-muted uppercase"
              >{{ group.label }}</span
            >
            <div
              class="base-alert-detail-recessed max-h-[220px] overflow-y-auto rounded-lg border border-solid border-neutral-100/8 bg-neutral-100/4 px-2.5 py-2"
              @click="handleModalLinkClick"
            >
              <div
                v-for="(item, ii) in group.items"
                :key="ii"
                class="base-alert-detail-item text-[13px] leading-[1.45] text-neutral-100"
                :class="linkClass"
                v-html="linkify(item)"
              ></div>
            </div>
          </div>
        </div>
      </slot>
      <p v-if="hint" class="base-alert-hint mt-3 text-xs leading-[1.4] text-text-muted/75">
        {{ hint }}
      </p>
      <!-- Sits below message + details (unlike the default slot, which replaces them). -->
      <div v-if="$slots.extra" class="base-alert-extra mt-3">
        <slot name="extra" />
      </div>
    </div>
    <footer
      class="base-alert-footer -mx-6 flex flex-wrap justify-end gap-2 border-t border-solid border-neutral-100/8 px-6 pt-3 [&>button]:max-w-60 [&>button]:min-w-24 [&>button]:overflow-hidden [&>button]:text-ellipsis [&>button]:whitespace-nowrap"
    >
      <slot name="footer">
        <Button
          v-if="showCancel"
          type="button"
          variant="secondary"
          size="lg"
          :data-testid="testIdCancel ?? 'base-alert-cancel'"
          @click="onCancelClick"
        >
          <span class="truncate">{{ cancelLabel ?? $t('common.cancel') }}</span>
        </Button>
        <Button
          v-if="secondaryLabel"
          type="button"
          :variant="actionVariants[secondaryTone]"
          size="lg"
          :data-testid="testIdSecondary ?? 'base-alert-secondary'"
          @click="onSecondaryClick"
        >
          <span class="truncate">{{ secondaryLabel }}</span>
        </Button>
        <Button
          type="button"
          :variant="actionVariants[tone]"
          size="lg"
          :data-testid="testIdAction ?? 'base-alert-action'"
          @click="onActionClick"
        >
          <span class="truncate">{{ buttonLabel ?? $t('modal.ok') }}</span>
        </Button>
      </slot>
    </footer>
  </DesktopDialogSurface>
</template>
