<script setup lang="ts">
// Scrollable, selectable error block with a copy button for in-shelf
// operation failures. Keeps the full message (e.g. multi-line stderr)
// readable and copyable instead of clamping it to one line. Pass `compact`
// for the smaller title-popup card.
import { useI18n } from 'vue-i18n'
import BaseCopyButton from './BaseCopyButton.vue'
import { TID } from '../../../../shared/testIds'

interface Props {
  error: string
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), { compact: false })

const { t } = useI18n()
</script>

<template>
  <div
    class="op-error-detail relative mt-0.5 w-full"
    :class="compact ? 'is-compact max-w-none' : 'max-w-[520px]'"
  >
    <pre
      class="op-error-detail__text m-0 overflow-y-auto rounded-lg border border-solid border-[var(--brand-surface-border,rgba(255,255,255,0.08))] bg-[var(--brand-surface-bg,rgba(255,255,255,0.04))] text-left font-[family-name:var(--font-mono,ui-monospace,monospace)] leading-[1.45] whitespace-pre-wrap text-[var(--brand-error,#e74c3c)] [word-break:break-word] select-text"
      :class="
        compact
          ? 'max-h-40 py-2 pr-8 pl-2.5 text-[11px]'
          : 'max-h-[200px] py-2.5 pr-[38px] pl-3 text-xs'
      "
      :data-testid="TID.pickerOpErrorMessage"
      >{{ props.error }}</pre
    >
    <BaseCopyButton
      class="op-error-detail__copy absolute"
      :class="compact ? 'top-1 right-1' : 'top-1.5 right-1.5'"
      :get-value="() => props.error"
      :aria-label="t('common.copyError', 'Copy error details')"
      :data-testid="TID.pickerOpErrorCopy"
    />
  </div>
</template>
