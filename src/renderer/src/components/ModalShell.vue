<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from './Modal.vue'
import Button from '@comfyorg/design-system/button/Button'

/**
 * Shared modal chrome (header + scrollable body) wrapping `Modal.vue` and
 * forwarding its sizing/backdrop props. Slots: `#header` (whole header row),
 * `#title` (title content only), default (body), `#footer` (pinned footer row).
 */

type Opacity = 'dim' | 'heavy-dim' | 'opaque'

withDefaults(
  defineProps<{
    binding?: boolean
    opacity?: Opacity
    width?: 'regular' | 'wide'
    contentClass?: string
    inline?: boolean
    /** Plain text title shown in the default header. Ignored if a `#header` slot is provided. */
    title?: string
    /** Hide the corner close button (binding takeovers without an in-header dismiss). */
    hideClose?: boolean
    /** Glyph for the corner close (defaults to ✕; ProgressModal/ConsoleModal swap to − while running). */
    closeGlyph?: string
  }>(),
  {
    binding: false,
    opacity: undefined,
    width: 'wide',
    contentClass: '',
    inline: false,
    title: '',
    hideClose: false,
    closeGlyph: '✕'
  }
)

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const titleId = `view-modal-title-${useId()}`
</script>

<template>
  <Modal
    :binding="binding"
    :opacity="opacity"
    :width="width"
    :content-class="contentClass"
    :inline="inline"
    :aria-label="title || undefined"
    :aria-labelledby="title ? undefined : titleId"
    @close="emit('close')"
  >
    <div
      class="view-modal-header flex shrink-0 items-center gap-3 border-b border-solid border-[var(--border)] px-5 py-4"
    >
      <slot name="header">
        <div
          :id="titleId"
          class="view-modal-title flex min-w-0 flex-1 items-center gap-1.5 truncate text-[18px] font-semibold text-text [&:hover_.edit-name-hint]:opacity-60 [&:focus_.edit-name-hint]:opacity-0"
        >
          <slot name="title">{{ title }}</slot>
        </div>
        <Button
          v-if="!hideClose"
          variant="muted-textonly"
          size="icon"
          class="view-modal-close shrink-0 text-lg"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          {{ closeGlyph }}
        </Button>
      </slot>
    </div>
    <div class="view-modal-body flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <slot />
    </div>
    <div
      v-if="$slots.footer"
      class="view-modal-footer shrink-0 border-t border-solid border-[var(--border)] px-5 py-3 [&_.view-bottom]:pt-0"
    >
      <slot name="footer" />
    </div>
  </Modal>
</template>
