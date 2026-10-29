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
    size="lg"
    blur-overlay
    :aria-label="t(titleKey)"
    content-class="terms-content"
    @close="emit('close')"
  >
    <template #header>
      <h2
        class="terms-title mt-0 mr-0 mb-2 ml-0 font-display text-[length:var(--takeover-fs-h3)] font-extrabold tracking-normal text-neutral-100"
      >
        {{ t(titleKey) }}
      </h2>
      <div
        class="terms-meta flex flex-wrap gap-4 text-[length:var(--takeover-fs-caption)] text-neutral-300 [&_strong]:font-semibold [&_strong]:text-neutral-100"
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
      class="terms-body select-text text-[length:var(--takeover-fs-body)] leading-[1.6] text-neutral-300 focus:outline-none [&_strong]:font-semibold [&_strong]:text-neutral-100"
      tabindex="0"
    >
      <template v-for="(block, i) in policy.blocks" :key="`${doc}-${i}`">
        <h2
          v-if="block.kind === 'h2'"
          class="terms-h2 mt-[18px] mr-0 mb-2 ml-0 text-[length:var(--takeover-fs-lead)] font-semibold text-neutral-100 first:mt-0"
        >
          {{ block.text }}
        </h2>
        <h3
          v-else-if="block.kind === 'h3'"
          class="terms-h3 mt-3.5 mr-0 mb-1.5 ml-0 text-[length:var(--takeover-fs-body)] font-semibold text-neutral-100"
        >
          {{ block.text }}
        </h3>
        <p v-else-if="block.kind === 'p' && block.text" class="terms-p mt-0 mr-0 mb-2.5 ml-0">
          <InlineRichText :text="block.text" />
        </p>
        <ul
          v-else-if="block.kind === 'ul' && block.items"
          class="terms-ul mt-0 mr-0 mb-2.5 ml-0 pl-5 [&>li]:mb-1.5"
        >
          <li v-for="(item, k) in block.items" :key="k">
            <InlineRichText :text="item" />
          </li>
        </ul>
      </template>
    </div>
  </BaseModal>
</template>
