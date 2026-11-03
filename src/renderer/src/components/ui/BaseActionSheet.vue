<script setup lang="ts">
import { useId } from 'vue'
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

const TITLE_ID = `base-action-sheet-title-${useId()}`

function cancel(): void {
  emit('update:open', false)
  emit('cancel')
}

function onItemClick(value: string): void {
  emit('update:open', false)
  emit('select', value)
}
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
          v-for="item in items"
          :key="item.value"
          :variant="item.tone === 'danger' ? 'destructive-textonly' : 'secondary'"
          size="lg"
          class="base-action-sheet-item h-auto w-full flex-col items-start gap-0.5 py-2.5 text-left whitespace-normal"
          :data-testid="`base-action-sheet-item-${item.value}`"
          :class="{ 'base-action-sheet-item--danger': item.tone === 'danger' }"
          @click="onItemClick(item.value)"
        >
          <span
            class="base-action-sheet-item-label font-medium"
            :class="item.tone === 'danger' ? 'text-danger' : 'text-neutral-100'"
            >{{ item.label }}</span
          >
          <span
            v-if="item.description"
            class="base-action-sheet-item-desc text-xs leading-[1.5] text-muted-foreground"
          >
            {{ item.description }}
          </span>
        </Button>
      </div>
    </div>

    <template #footer>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        :data-testid="testIdCancel ?? 'base-action-sheet-cancel'"
        @click="cancel"
      >
        {{ cancelLabel ?? $t('common.cancel') }}
      </Button>
    </template>
  </BaseModal>
</template>
