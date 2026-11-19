<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Textarea from '@comfyorg/design-system/textarea/Textarea'
import { AppWindow, Check, MousePointer2, Plus } from '@lucide/vue'
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

const ART_APP_COUNT = 5
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
    content-class="grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] min-[600px]:grid-cols-[256px_minmax(0,1fr)] [&_.base-modal-aside]:hidden min-[600px]:[&_.base-modal-aside]:block [&_.base-modal-aside]:row-span-3 [&_.base-modal-aside]:overflow-hidden [&_.base-modal-aside]:rounded-l-[inherit] [&_.base-modal-body]:flex [&_.base-modal-body]:flex-col [&_.base-modal-footer]:p-4 [&_.base-modal-header]:border-b-0 [&_.base-modal-header]:pt-6 [&_.base-modal-header]:pb-0"
    @close="close"
  >
    <template #aside>
      <div
        class="relative size-full overflow-hidden bg-cover bg-center"
        :style="{ backgroundImage: `url(${requestArt})` }"
        aria-hidden="true"
        data-testid="app-request-art"
      >
        <div
          class="absolute inset-x-[18px] top-1/2 -translate-y-1/2 rounded-[12px] bg-background p-3.5 shadow-[0_24px_48px_-20px_rgb(20_20_60/0.55)]"
        >
          <div class="mb-3 flex items-center justify-between gap-2">
            <p class="m-0 text-lg leading-none font-semibold tracking-[-0.04em] text-foreground">
              {{ t('sidebar.apps') }}
            </p>
            <span class="h-5 w-20 rounded-md bg-white/6" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="app in artApps"
              :key="app.id"
              class="relative aspect-square overflow-hidden rounded-[9px] bg-[rgb(235_235_235/0.05)]"
              data-testid="app-request-art-app"
            >
              <img
                v-if="app.still"
                :src="app.still"
                alt=""
                class="absolute inset-0 size-full object-cover"
              />
              <span v-else class="absolute inset-0 grid place-items-center text-subtle-foreground">
                <AppWindow :size="18" :stroke-width="1.5" />
              </span>
              <span
                class="absolute inset-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.7),rgb(0_0_0/0.55)_28%,transparent_60%)]"
              />
              <span
                class="absolute inset-x-2 bottom-1.5 truncate text-[10px] leading-tight font-semibold text-white"
              >
                {{ app.title }}
              </span>
            </div>
            <div
              class="relative aspect-square rounded-[9px] bg-[rgb(235_235_235/0.1)] text-foreground"
              data-testid="app-request-art-yours"
            >
              <span class="absolute inset-0 grid place-items-center">
                <Plus :size="18" :stroke-width="1.5" />
              </span>
              <span
                class="absolute inset-x-2 bottom-1.5 truncate text-[10px] leading-tight font-semibold"
              >
                {{ t('apps.request.artYours') }}
              </span>
              <MousePointer2
                :size="16"
                :stroke-width="1.5"
                class="absolute top-[58%] left-[60%] fill-white text-neutral-900 drop-shadow-[0_2px_3px_rgb(0_0_0/0.4)]"
              />
            </div>
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
      class="m-0 my-auto flex flex-col items-center gap-3 text-center text-sm leading-[1.5] text-text-muted"
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
