<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import BaseModal from './ui/BaseModal.vue'
import { emitTelemetryAction } from '../lib/telemetry'

const APP_REQUEST_SURVEY_ID = '01a1f22e-d672-0000-a5ce-85d8a1d81406'
const APP_REQUEST_QUESTION_ID = '0f16a789-5c8e-4871-b44e-ec11c54b8c9b'
const APP_REQUEST_MAX_LENGTH = 500
const AUTOCLOSE_MS = 2000

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const titleId = `app-request-title-${useId()}`
const request = ref('')
const sent = ref(false)
let autocloseTimer: ReturnType<typeof setTimeout> | null = null

const canSend = computed(() => !sent.value && request.value.trim().length > 0)

function clearAutoclose(): void {
  if (autocloseTimer != null) {
    clearTimeout(autocloseTimer)
    autocloseTimer = null
  }
}

function close(): void {
  clearAutoclose()
  emit('close')
}

function send(): void {
  if (!canSend.value) return
  sent.value = true
  emitTelemetryAction('survey sent', {
    $survey_id: APP_REQUEST_SURVEY_ID,
    [`$survey_response_${APP_REQUEST_QUESTION_ID}`]: request.value.trim()
  })
  autocloseTimer = setTimeout(() => {
    autocloseTimer = null
    emit('close')
  }, AUTOCLOSE_MS)
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      request.value = ''
      sent.value = false
    }
    if (!isOpen) clearAutoclose()
  },
  { immediate: true }
)
</script>

<template>
  <BaseModal
    :open="open"
    size="sm"
    :aria-labelledby="titleId"
    :show-close-button="false"
    @close="close"
  >
    <template #header>
      <h2 :id="titleId" class="m-0 text-base leading-[1.3] font-semibold text-neutral-100">
        {{ t('apps.request.title') }}
      </h2>
    </template>

    <p
      v-if="sent"
      class="m-0 text-sm leading-[1.5] text-text-muted"
      role="status"
      data-testid="app-request-thanks"
    >
      {{ t('apps.request.thanks') }}
    </p>
    <textarea
      v-else
      v-model="request"
      data-initial-focus
      rows="4"
      :maxlength="APP_REQUEST_MAX_LENGTH"
      :aria-labelledby="titleId"
      :placeholder="t('apps.request.placeholder')"
      class="w-full resize-none rounded-lg border border-solid border-border bg-transparent px-3 py-2 text-sm leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="app-request-input"
      @keydown.meta.enter.prevent="send"
      @keydown.ctrl.enter.prevent="send"
    />

    <template v-if="!sent" #footer>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        data-testid="app-request-cancel"
        @click="close"
      >
        {{ t('common.cancel') }}
      </Button>
      <Button
        type="button"
        variant="inverted"
        size="lg"
        :disabled="!canSend"
        data-testid="app-request-send"
        @click="send"
      >
        {{ t('apps.request.send') }}
      </Button>
    </template>
  </BaseModal>
</template>
