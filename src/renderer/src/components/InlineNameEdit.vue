<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Pencil } from 'lucide-vue-next'
import { useInlineTextEdit } from '../composables/useInlineTextEdit'

const props = withDefaults(
  defineProps<{
    name: string
    prefix: string
    onRename?: (newName: string) => Promise<boolean>
    textClass?: string
    iconSize?: number
    pencilWidth?: string
  }>(),
  {
    onRename: undefined,
    textClass: 'text-[16px] leading-6 font-semibold text-text',
    iconSize: 13,
    pencilWidth: '17px'
  }
)

const { t } = useI18n()

const editable = computed(() => !!props.onRename)
const nameEl = useTemplateRef<HTMLElement>('nameEl')

const { focus, onKeydown, onPaste, onBlur } = useInlineTextEdit(nameEl, {
  value: () => props.name,
  commit: async (next) => (await props.onRename?.(next)) === true
})

defineExpose({ focus })
</script>

<template>
  <span
    :class="`${prefix}-name-wrap`"
    class="group/name -ml-1.5 inline-flex max-w-[calc(100%+0.375rem)] min-w-0 items-center gap-1.5"
    :style="{ '--inline-name-pencil': pencilWidth }"
  >
    <span
      v-if="editable"
      :id="`${prefix}-name`"
      ref="nameEl"
      :class="[`${prefix}-name`, textClass]"
      class="peer/name min-w-0 cursor-text truncate rounded-md px-1.5 py-0.5 outline-none transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:shadow-[0_0_0_2px_var(--focus-ring,var(--neutral-50))]"
      role="textbox"
      :aria-label="t('statusFactPanel.editName')"
      contenteditable="plaintext-only"
      spellcheck="false"
      @blur="onBlur"
      @keydown="onKeydown"
      @paste="onPaste"
    />
    <span
      v-else
      :class="[`${prefix}-name`, `${prefix}-name-static`, textClass]"
      class="min-w-0 cursor-default truncate rounded-md px-1.5 py-0.5 outline-none"
      >{{ name }}</span
    >
    <Button
      v-if="editable"
      variant="textonly"
      size="unset"
      type="button"
      :class="`${prefix}-edit-btn`"
      class="static -ml-1.5 inline-flex w-0 shrink-0 appearance-auto items-center justify-center overflow-hidden rounded-md border-none bg-transparent p-0 transition-[width,margin-left] duration-[120ms] ease-[ease] group-hover/name:ml-0 group-hover/name:w-[var(--inline-name-pencil)] peer-focus-visible/name:ml-0 peer-focus-visible/name:w-[var(--inline-name-pencil)] hover:bg-transparent focus-visible:ml-0 focus-visible:w-[var(--inline-name-pencil)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring,var(--neutral-50))] focus-visible:[outline-style:solid] [&>svg]:opacity-0 group-hover/name:[&>svg]:opacity-60 peer-focus-visible/name:[&>svg]:opacity-60 focus-visible:[&>svg]:opacity-60"
      :aria-label="t('statusFactPanel.editName')"
      :aria-controls="`${prefix}-name`"
      @click="focus"
    >
      <Pencil
        :size="iconSize"
        :class="`${prefix}-edit-hint`"
        class="shrink-0 text-text-muted transition-opacity duration-[120ms] ease-[ease] select-none"
        aria-hidden="true"
      />
    </Button>
  </span>
</template>
