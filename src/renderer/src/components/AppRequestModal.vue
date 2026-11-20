<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Textarea from '@comfyorg/design-system/textarea/Textarea'
import { Check } from '@lucide/vue'
import BaseModal from './ui/BaseModal.vue'
import requestArt from '../assets/app-request/request-art.webp'

type RequestStatus = 'idle' | 'sending' | 'sent' | 'failed'

const APP_REQUEST_MAX_LENGTH = 500
const AUTOCLOSE_MS = 2000
const IME_COMPOSING_KEY_CODE = 229

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const titleId = `app-request-title-${useId()}`
const errorId = `app-request-error-${useId()}`
const request = ref('')
const status = ref<RequestStatus>('idle')
let attempt = 0
let autocloseTimer: ReturnType<typeof setTimeout> | null = null

const sending = computed(() => status.value === 'sending')
const sent = computed(() => status.value === 'sent')
const failed = computed(() => status.value === 'failed')
const canSend = computed(
  () => (status.value === 'idle' || failed.value) && request.value.trim().length > 0
)

function clearAutoclose(): void {
  if (autocloseTimer != null) {
    clearTimeout(autocloseTimer)
    autocloseTimer = null
  }
}

function abandonAttempt(): void {
  attempt++
  clearAutoclose()
}

function close(): void {
  abandonAttempt()
  emit('close')
}

async function deliver(text: string): Promise<boolean> {
  try {
    return (await window.api.sendAppRequest(text)) === true
  } catch {
    return false
  }
}

async function send(): Promise<void> {
  if (!canSend.value) return
  const current = ++attempt
  status.value = 'sending'
  const delivered = await deliver(request.value.trim())
  if (current !== attempt) return
  if (!delivered) {
    status.value = 'failed'
    return
  }
  status.value = 'sent'
  autocloseTimer = setTimeout(() => {
    autocloseTimer = null
    emit('close')
  }, AUTOCLOSE_MS)
}

function sendFromKeyboard(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === IME_COMPOSING_KEY_CODE) return
  event.preventDefault()
  void send()
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      request.value = ''
      status.value = 'idle'
    }
    if (!isOpen) abandonAttempt()
  },
  { immediate: true }
)
</script>

<template>
  <BaseModal
    :open="open"
    size="md"
    close-outside
    :aria-labelledby="titleId"
    content-class="w-[704px]! grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] min-[600px]:grid-cols-[296px_minmax(0,1fr)] [&_.base-modal-media]:hidden min-[600px]:[&_.base-modal-media]:block [&_.base-modal-media]:row-span-3 [&_.base-modal-media]:p-2 [&_.base-modal-body]:flex [&_.base-modal-body]:flex-col [&_.base-modal-footer]:p-4 [&_.base-modal-header]:border-b-0 [&_.base-modal-header]:pt-6 [&_.base-modal-header]:pb-0"
    @close="close"
  >
    <template #media>
      <div
        class="relative size-full overflow-hidden rounded-[8px]"
        aria-hidden="true"
        data-testid="app-request-art"
      >
        <img :src="requestArt" alt="" class="absolute inset-0 size-full object-cover" />
      </div>
    </template>
    <template #header>
      <h2 :id="titleId" class="m-0 text-base leading-[1.3] font-semibold text-neutral-100">
        {{ t('apps.request.title') }}
      </h2>
      <p class="m-0 mt-1.5 text-sm leading-[1.5] text-text-muted">
        {{ t('apps.request.intro') }}
      </p>
    </template>

    <p
      v-if="sent"
      class="m-0 flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center text-sm leading-[1.5] text-text-muted"
      role="status"
      data-testid="app-request-thanks"
    >
      <span class="grid size-10 place-items-center rounded-full bg-white/8 text-neutral-100">
        <Check :size="18" :stroke-width="2" aria-hidden="true" />
      </span>
      {{ t('apps.request.thanks') }}
    </p>
    <div v-else class="flex flex-1 flex-col gap-2">
      <Textarea
        v-model="request"
        data-initial-focus
        rows="5"
        :maxlength="APP_REQUEST_MAX_LENGTH"
        :readonly="sending"
        :aria-labelledby="titleId"
        :aria-describedby="failed ? errorId : undefined"
        :placeholder="t('apps.request.placeholder')"
        class="min-h-28 flex-1 resize-none leading-[1.5] placeholder:text-subtle-foreground"
        data-testid="app-request-input"
        @keydown.meta.enter="sendFromKeyboard"
        @keydown.ctrl.enter="sendFromKeyboard"
      />
      <p
        v-if="failed"
        :id="errorId"
        class="m-0 text-[13px] leading-[1.5] text-destructive"
        role="alert"
        data-testid="app-request-error"
      >
        {{ t('apps.request.failed') }}
      </p>
    </div>

    <template #footer>
      <Button
        v-if="sent"
        type="button"
        variant="inverted"
        size="lg"
        data-testid="app-request-done"
        @click="close"
      >
        {{ t('apps.request.done') }}
      </Button>
      <Button
        v-else
        type="button"
        variant="inverted"
        size="lg"
        :disabled="!canSend"
        data-testid="app-request-send"
        @click="send"
      >
        {{ sending ? t('apps.request.sending') : t('apps.request.send') }}
      </Button>
    </template>
  </BaseModal>
</template>
