<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import Button from '@comfyorg/design-system/button/Button'

// Action-sheet primitive: title, message, list of choices, Cancel footer.
// Not BaseSelect.vue, which is the inline form combobox.

export interface ActionSheetItem {
  value: string
  label: string
  description?: string
  tone?: 'default' | 'danger'
}

interface Props {
  open: boolean
  title: string
  message?: string
  items: ActionSheetItem[]
  cancelLabel?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  dismissOnEscape?: boolean
  dismissOnOutside?: boolean
  testIdCancel?: string
}

const props = withDefaults(defineProps<Props>(), {
  message: '',
  cancelLabel: undefined,
  size: 'sm',
  dismissOnEscape: true,
  dismissOnOutside: true,
  testIdCancel: undefined
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  select: [value: string]
  cancel: []
}>()

const TITLE_ID = 'base-action-sheet-title'

const firstItemRef = ref<HTMLButtonElement | null>(null)

function cancel(): void {
  emit('update:open', false)
  emit('cancel')
}

function onItemClick(value: string): void {
  emit('update:open', false)
  emit('select', value)
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      void nextTick(() => firstItemRef.value?.focus())
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
    content-class="base-action-sheet-panel"
    @close="cancel"
  >
    <template #header>
      <h2
        :id="TITLE_ID"
        class="base-action-sheet-title m-0 text-base leading-[1.3] font-semibold text-neutral-100"
      >
        {{ title }}
      </h2>
    </template>

    <div class="base-action-sheet-body flex flex-col gap-3 text-sm leading-[1.5] text-text-muted">
      <div v-if="message" class="base-action-sheet-message whitespace-pre-line select-text">
        {{ message }}
      </div>
      <div class="base-action-sheet-list flex flex-col gap-1.5">
        <Button
          v-for="(item, idx) in items"
          :key="item.value"
          as-child
          variant="textonly"
          size="unset"
          class="base-action-sheet-item flex w-full flex-col items-start gap-0.5 rounded-lg border border-solid bg-neutral-100/4 px-3 py-2.5 text-left whitespace-normal font-sans text-sm leading-[1.5] font-normal text-neutral-100 [appearance:button] transition-[border-color,background] duration-[120ms] ease-[ease] focus-visible:ring-0 focus-visible:outline-none"
          :class="
            item.tone === 'danger'
              ? 'base-action-sheet-item--danger border-danger/35 hover:border-danger hover:bg-danger/12 focus-visible:border-danger focus-visible:bg-danger/12'
              : 'border-neutral-100/10 hover:border-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] focus-visible:border-[var(--accent)] focus-visible:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]'
          "
        >
          <button
            :ref="
              (el) => {
                if (idx === 0) firstItemRef = el as HTMLButtonElement
              }
            "
            type="button"
            :data-testid="`base-action-sheet-item-${item.value}`"
            @click="onItemClick(item.value)"
          >
            <span
              class="base-action-sheet-item-label font-medium"
              :class="item.tone === 'danger' ? 'text-danger' : 'text-neutral-100'"
              >{{ item.label }}</span
            >
            <span
              v-if="item.description"
              class="base-action-sheet-item-desc text-xs leading-[1.5] text-text-muted"
            >
              {{ item.description }}
            </span>
          </button>
        </Button>
      </div>
    </div>

    <template #footer>
      <Button
        type="button"
        variant="secondary"
        size="unset"
        class="rounded-lg border border-solid border-[var(--border)] bg-surface px-4 py-2 font-sans text-sm leading-[1.5] font-normal whitespace-normal text-text [appearance:button] transition-none hover:bg-[var(--border)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]"
        :data-testid="testIdCancel ?? 'base-action-sheet-cancel'"
        @click="cancel"
      >
        {{ cancelLabel ?? $t('common.cancel') }}
      </Button>
    </template>
  </BaseModal>
</template>
