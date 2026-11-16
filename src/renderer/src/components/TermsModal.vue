<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './ui/BaseModal.vue'
import InlineRichText from './InlineRichText.vue'
import { LEGAL_DOCS, type LegalDocId } from '../lib/legalDocs'

const props = withDefaults(
  defineProps<{
    open?: boolean
    doc?: LegalDocId
  }>(),
  { open: true, doc: 'privacy' }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

const policy = computed(() => LEGAL_DOCS[props.doc] ?? LEGAL_DOCS.privacy)
const titleKey = computed(() => {
  switch (props.doc) {
    case 'eula':
      return 'firstUse.eulaModalTitle'
    case 'tos':
      return 'firstUse.tosModalTitle'
    case 'notices':
      return 'firstUse.noticesModalTitle'
    default:
      return 'firstUse.privacyModalTitle'
  }
})
</script>

<template>
  <BaseModal
    :open="open"
    size="md"
    blur-overlay
    :aria-label="t(titleKey)"
    content-class="terms-content"
    @close="emit('close')"
  >
    <template #header>
      <h2
        class="terms-title m-0 text-[18px] leading-7 font-semibold tracking-[-0.01em] text-foreground"
      >
        {{ t(titleKey) }}
      </h2>
      <div
        class="terms-meta mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs/[15px] text-subtle-foreground [&_strong]:font-medium [&_strong]:text-muted-foreground"
      >
        <span
          ><strong>{{ t('firstUse.legalDocEffective') }}:</strong> {{ policy.effectiveDate }}</span
        >
        <span
          ><strong>{{ t('firstUse.legalDocAppliesTo') }}:</strong> {{ policy.appliesTo }}</span
        >
      </div>
    </template>
    <div
      class="terms-body text-[13px]/5 text-muted-foreground select-text focus:outline-none [&_code]:rounded-[4px] [&_code]:bg-white/6 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground [&_strong]:font-medium [&_strong]:text-foreground"
      tabindex="0"
    >
      <template v-for="(block, i) in policy.blocks" :key="`${doc}-${i}`">
        <h2
          v-if="block.kind === 'h2'"
          class="terms-h2 mt-6 mb-2 text-sm/5 font-semibold text-foreground first:mt-0"
        >
          {{ block.text }}
        </h2>
        <h3
          v-else-if="block.kind === 'h3'"
          class="terms-h3 mt-4 mb-1.5 text-[13px]/5 font-semibold text-foreground"
        >
          {{ block.text }}
        </h3>
        <p v-else-if="block.kind === 'p' && block.text" class="terms-p mt-0 mb-3">
          <InlineRichText :text="block.text" />
        </p>
        <ul
          v-else-if="block.kind === 'ul' && block.items"
          class="terms-ul mt-0 mb-3 list-disc pl-5 marker:text-subtle-foreground [&>li]:mb-1.5 [&>li]:pl-1"
        >
          <li v-for="(item, k) in block.items" :key="k">
            <InlineRichText :text="item" />
          </li>
        </ul>
      </template>
    </div>
  </BaseModal>
</template>
