<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import Button from '@comfyorg/design-system/button/Button'
import { linkify, handleModalLinkClick } from '../../lib/modalLinkify'
import { TID } from '../../../../shared/testIds'
import type { ModalDetailGroup } from '../../types/ipc'

// Prompt primitive (title, message, text input, Cancel + primary) built on
// BaseModal. Two-way `open` via `v-model:open`.

interface Props {
  open: boolean
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  inputLabel?: string
  /** Truthy requires a non-empty value; a string overrides the error copy. */
  required?: boolean | string
  /** Recessed sub-blocks below the message (e.g. release notes). */
  messageDetails?: ModalDetailGroup[]
  size?: 'sm' | 'md' | 'lg' | 'xl'
  dismissOnEscape?: boolean
  dismissOnOutside?: boolean
  testIdInput?: string
  testIdAction?: string
  testIdCancel?: string
}

const props = withDefaults(defineProps<Props>(), {
  message: '',
  placeholder: '',
  defaultValue: '',
  confirmLabel: undefined,
  cancelLabel: undefined,
  inputLabel: undefined,
  required: false,
  messageDetails: () => [],
  size: 'sm',
  dismissOnEscape: true,
  dismissOnOutside: true,
  testIdInput: undefined,
  testIdAction: undefined,
  testIdCancel: undefined
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [value: string]
  cancel: []
}>()

const TITLE_ID = 'base-prompt-title'

// Preserve the existing button sizing and native focus outline while using
// the shared component. The main action is the current white/inverted action.
const buttonClass =
  '[appearance:button] rounded-lg border border-solid px-4 py-2 font-sans text-sm leading-[1.5] font-normal whitespace-normal transition-none focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]'
const linkClass =
  '[&_.modal-link]:cursor-pointer [&_.modal-link]:text-[var(--accent)] [&_.modal-link]:underline'

const inputRef = ref<HTMLInputElement | null>(null)
const inputValue = ref('')
const error = ref('')

const linkifiedMessage = computed(() => linkify(props.message))

function cancel(): void {
  emit('update:open', false)
  emit('cancel')
}

function submit(): void {
  const value = inputValue.value.trim()
  if (props.required && !value) {
    error.value = typeof props.required === 'string' ? props.required : 'This field is required'
    return
  }
  emit('update:open', false)
  emit('submit', value)
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      inputValue.value = props.defaultValue
      error.value = ''
      void nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    }
  },
  { immediate: true }
)
</script>

<template>
  <BaseModal
    :open="open"
    :size="size"
    :aria-labelledby="TITLE_ID"
    :dismiss-on-escape="dismissOnEscape"
    :dismiss-on-outside="dismissOnOutside"
    :show-close-button="false"
    content-class="base-prompt-panel"
    @close="cancel"
  >
    <template #header>
      <h2
        :id="TITLE_ID"
        class="base-prompt-title m-0 text-base leading-[1.3] font-semibold text-neutral-100"
      >
        {{ title }}
      </h2>
    </template>

    <div class="base-prompt-body flex flex-col gap-3.5 text-sm leading-[1.5] text-text-muted">
      <div
        v-if="message"
        class="base-prompt-message whitespace-pre-line select-text [&_strong]:font-semibold [&_strong]:text-text"
        :class="linkClass"
        @click="handleModalLinkClick"
        v-html="linkifiedMessage"
      ></div>

      <div v-if="messageDetails.length" class="base-prompt-details flex flex-col gap-2">
        <div
          v-for="(group, gi) in messageDetails"
          :key="gi"
          class="base-prompt-detail-group flex flex-col gap-1"
        >
          <span
            class="base-prompt-detail-label text-xs leading-[1.5] font-semibold tracking-[0.04em] text-text-muted uppercase"
            >{{ group.label }}</span
          >
          <div
            class="base-prompt-detail-recessed max-h-[200px] overflow-y-auto rounded-lg border border-solid border-neutral-100/8 bg-neutral-100/4 px-2.5 py-2"
            @click="handleModalLinkClick"
          >
            <div
              v-for="(item, ii) in group.items"
              :key="ii"
              class="base-prompt-detail-item text-[13px] leading-[1.45] text-neutral-100"
              :class="linkClass"
              v-html="linkify(item)"
            ></div>
          </div>
        </div>
      </div>

      <div class="base-prompt-field flex flex-col gap-1">
        <label class="base-prompt-field-label text-[13px] font-semibold text-text">
          {{ inputLabel ?? $t('common.name') }}
        </label>
        <input
          ref="inputRef"
          v-model="inputValue"
          type="text"
          class="base-prompt-input mt-1.5 w-full rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-neutral-100/4 px-2.5 py-2 text-[14px] text-neutral-100 outline-none transition-[border-color] duration-[120ms] ease-[ease] focus-visible:border-[var(--accent)]"
          :placeholder="placeholder"
          :data-testid="testIdInput ?? TID.basePromptInput"
          @keydown.enter.prevent.stop="submit"
        />
        <div v-if="error" class="base-prompt-error min-h-3 text-[13px] text-danger">
          {{ error }}
        </div>
      </div>
    </div>

    <template #footer>
      <Button
        type="button"
        variant="secondary"
        size="unset"
        :class="[
          buttonClass,
          'border-[var(--border)] bg-surface text-text hover:bg-[var(--border)]'
        ]"
        :data-testid="testIdCancel ?? TID.basePromptCancel"
        @click="cancel"
      >
        {{ cancelLabel ?? $t('common.cancel') }}
      </Button>
      <Button
        type="button"
        variant="inverted"
        size="unset"
        :class="[
          buttonClass,
          'border-[var(--accent-primary)] bg-[var(--accent-primary)] font-medium text-background hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)] hover:transition-[background,border-color] hover:duration-[120ms] hover:ease-[ease]'
        ]"
        :data-testid="testIdAction ?? TID.basePromptAction"
        @click="submit"
      >
        {{ confirmLabel ?? $t('modal.ok') }}
      </Button>
    </template>
  </BaseModal>
</template>
