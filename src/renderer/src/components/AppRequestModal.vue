<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Textarea from '@comfyorg/design-system/textarea/Textarea'
import { AppWindow, Plus } from '@lucide/vue'
import type { AppCard } from '../types/ipc'
import BaseModal from './ui/BaseModal.vue'
import requestArt from '../assets/app-request/request-art.webp'

type RequestStatus = 'idle' | 'sending' | 'sent' | 'failed'

const APP_REQUEST_MAX_LENGTH = 500
const AUTOCLOSE_MS = 2000
const IME_COMPOSING_KEY_CODE = 229

const props = withDefaults(defineProps<{ open: boolean; apps?: AppCard[] }>(), { apps: () => [] })

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const titleId = `app-request-title-${useId()}`
const errorId = `app-request-error-${useId()}`
const request = ref('')
const status = ref<RequestStatus>('idle')
let attempt = 0
let autocloseTimer: ReturnType<typeof setTimeout> | null = null

const ART_APP_COUNT = 3
const PICTURE_URL = /\.(avif|gif|jpe?g|png|webp)(\?|#|$)/i

function stillOf(app: AppCard): string | null {
  const cover = app.covers[0]
  if (!cover) return null
  if (cover.stillUrl) return cover.stillUrl
  return PICTURE_URL.test(cover.url) ? cover.url : null
}

const artApps = computed(() =>
  props.apps
    .slice(0, ART_APP_COUNT)
    .map((app) => ({ id: app.id, title: app.title, still: stillOf(app) }))
)

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
    content-class="grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] min-[600px]:grid-cols-[232px_minmax(0,1fr)] [&_.base-modal-aside]:hidden min-[600px]:[&_.base-modal-aside]:block [&_.base-modal-aside]:row-span-3 [&_.base-modal-aside]:overflow-hidden [&_.base-modal-aside]:rounded-l-[inherit] [&_.base-modal-body]:flex [&_.base-modal-body]:flex-col [&_.base-modal-footer]:p-4 [&_.base-modal-header]:border-b-0 [&_.base-modal-header]:pt-6 [&_.base-modal-header]:pb-0"
    @close="close"
  >
    <template #aside>
      <div
        class="relative grid size-full place-items-center bg-cover bg-center px-6"
        :style="{ backgroundImage: `url(${requestArt})` }"
        aria-hidden="true"
        data-testid="app-request-art"
      >
        <div
          class="flex w-full flex-col gap-1 rounded-[14px] bg-white/92 p-2 text-neutral-900 shadow-[0_18px_40px_-16px_rgb(40_40_80/0.45)]"
        >
          <p class="m-0 px-1.5 pt-1 pb-1.5 text-xs font-semibold text-neutral-900">
            {{ t('sidebar.apps') }}
          </p>
          <div
            v-for="app in artApps"
            :key="app.id"
            class="flex min-w-0 items-center gap-2.5 rounded-[9px] px-1.5 py-1"
            data-testid="app-request-art-app"
          >
            <img
              v-if="app.still"
              :src="app.still"
              alt=""
              class="size-7 shrink-0 rounded-[7px] object-cover"
            />
            <span
              v-else
              class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-neutral-900/8 text-neutral-500"
            >
              <AppWindow :size="14" :stroke-width="1.75" />
            </span>
            <span class="truncate text-[12.5px] leading-tight text-neutral-700">
              {{ app.title }}
            </span>
          </div>
          <div
            class="flex min-w-0 items-center gap-2.5 rounded-[9px] bg-neutral-900/6 px-1.5 py-1"
            data-testid="app-request-art-yours"
          >
            <span
              class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-neutral-900 text-white"
            >
              <Plus :size="14" :stroke-width="2" />
            </span>
            <span class="truncate text-[12.5px] leading-tight font-semibold text-neutral-900">
              {{ t('apps.request.artYours') }}
            </span>
          </div>
        </div>
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
      class="m-0 text-sm leading-[1.5] text-text-muted"
      role="status"
      data-testid="app-request-thanks"
    >
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
        class="min-h-28 flex-1 resize-none leading-[1.5]"
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

    <template v-if="!sent" #footer>
      <Button
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
