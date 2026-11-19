<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Textarea from '@comfyorg/design-system/textarea/Textarea'
import { Check, Plus } from '@lucide/vue'
import type { AppCard } from '../types/ipc'
import BaseModal from './ui/BaseModal.vue'
import { stillsOf } from '../lib/appStills'

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

const ART_PICTURE_LIMIT = 12
const ART_ROW_MIN = 6

function fillRow(pictures: string[]): string[] {
  if (pictures.length === 0) return []
  const row = [...pictures]
  while (row.length < ART_ROW_MIN) row.push(...pictures)
  return row
}

const brokenPictures = reactive(new Set<string>())

const artPictures = computed(() => {
  const perApp = props.apps.map(stillsOf)
  const pictures: string[] = []
  for (let round = 0; perApp.some((list) => round < list.length); round++) {
    for (const list of perApp) {
      const picture = list[round]
      if (picture && !brokenPictures.has(picture) && !pictures.includes(picture)) {
        pictures.push(picture)
      }
    }
  }
  return pictures.slice(0, ART_PICTURE_LIMIT)
})

const artRows = computed(() => {
  const pictures = artPictures.value
  const top = fillRow(pictures.filter((_, index) => index % 2 === 0))
  const bottom = fillRow(pictures.filter((_, index) => index % 2 === 1))
  return [top, bottom.length > 0 ? bottom : [...top].reverse()].filter((row) => row.length > 0)
})

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
    size="sm"
    close-outside
    :aria-labelledby="titleId"
    content-class="[&_.base-modal-footer]:p-4 [&_.base-modal-header]:border-b-0 [&_.base-modal-header]:pb-0"
    @close="close"
  >
    <template v-if="artRows.length > 0" #media>
      <div
        class="relative flex h-48 flex-col justify-center overflow-hidden rounded-t-[inherit]"
        aria-hidden="true"
        data-testid="app-request-art"
      >
        <div class="flex -rotate-6 scale-110 flex-col gap-2">
          <div
            v-for="(row, rowIndex) in artRows"
            :key="rowIndex"
            class="app-request-row flex w-max animate-marquee gap-2 motion-reduce:animate-none"
            :class="{ '[animation-direction:reverse]': rowIndex % 2 === 1 }"
            data-testid="app-request-art-row"
          >
            <img
              v-for="(picture, index) in [...row, ...row]"
              :key="index"
              :src="picture"
              alt=""
              class="h-[72px] w-[112px] shrink-0 rounded-[10px] object-cover"
              @error="brokenPictures.add(picture)"
            />
          </div>
        </div>
        <div
          class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_55%,var(--modal-surface-bg))]"
        />
        <div
          class="absolute top-1/2 left-1/2 flex h-[72px] w-[112px] -translate-1/2 flex-col items-center justify-center gap-1.5 rounded-[10px] bg-[var(--modal-surface-bg)] text-foreground shadow-[0_12px_32px_-8px_rgb(0_0_0/0.7)]"
          data-testid="app-request-art-yours"
        >
          <Plus :size="18" :stroke-width="1.75" />
          <span class="text-xs leading-none font-semibold">{{ t('apps.request.artYours') }}</span>
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
      class="m-0 flex flex-col items-center gap-3 py-6 text-center text-sm leading-[1.5] text-text-muted"
      role="status"
      data-testid="app-request-thanks"
    >
      <span class="grid size-10 place-items-center rounded-full bg-white/8 text-neutral-100">
        <Check :size="18" :stroke-width="2" aria-hidden="true" />
      </span>
      {{ t('apps.request.thanks') }}
    </p>
    <div v-else class="flex flex-col gap-2">
      <Textarea
        v-model="request"
        data-initial-focus
        rows="4"
        :maxlength="APP_REQUEST_MAX_LENGTH"
        :readonly="sending"
        :aria-labelledby="titleId"
        :aria-describedby="failed ? errorId : undefined"
        :placeholder="t('apps.request.placeholder')"
        class="resize-none leading-[1.5]"
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
