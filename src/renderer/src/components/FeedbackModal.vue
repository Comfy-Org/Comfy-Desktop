<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createWidget } from '@typeform/embed'
import '@typeform/embed/build/css/widget.css'
import Button from '@comfyorg/design-system/button/Button'
import BaseModal from './ui/BaseModal.vue'
import { emitTelemetryAction } from '../lib/telemetry'

const FEEDBACK_FORM_ID = 'VhOXmuaL'
const AUTOCLOSE_MS = 2000
const LOAD_TIMEOUT_MS = 10_000
const RETRY_BARRIER = 'comfy-feedback-retry'

const props = defineProps<{
  open: boolean
  hiddenFields: Record<string, string>
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const container = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref(false)
const submitted = ref(false)
let autocloseTimer: ReturnType<typeof setTimeout> | null = null

function clearAutoclose(): void {
  if (autocloseTimer != null) {
    clearTimeout(autocloseTimer)
    autocloseTimer = null
  }
}

function onClose(): void {
  clearAutoclose()
  emit('close')
}

function onSubmit(): void {
  if (!props.open || submitted.value) return
  submitted.value = true
  emitTelemetryAction('comfy.desktop.feedback.submitted', {})
  autocloseTimer = setTimeout(() => {
    autocloseTimer = null
    emit('close')
  }, AUTOCLOSE_MS)
}

let loadTimer: ReturnType<typeof setTimeout> | null = null
let reloadWidget: (() => void) | null = null
let attempt = 0
let readyAttempt = 0

function onRetryBarrier(event: MessageEvent): void {
  if (event.source !== window || event.data?.type !== RETRY_BARRIER) return
  readyAttempt = event.data.attempt
}

function clearLoadTimer(): void {
  if (loadTimer != null) {
    clearTimeout(loadTimer)
    loadTimer = null
  }
}

function waitForForm(): void {
  clearLoadTimer()
  loading.value = true
  failed.value = false
  loadTimer = setTimeout(() => {
    loadTimer = null
    if (!loading.value) return
    loading.value = false
    failed.value = true
  }, LOAD_TIMEOUT_MS)
}

function retry(): void {
  if (!reloadWidget) return
  attempt += 1
  window.postMessage({ type: RETRY_BARRIER, attempt }, '*')
  waitForForm()
  reloadWidget()
}

watch(
  [() => props.open, container],
  ([open, element], _previous, onCleanup) => {
    if (!open || !element) return
    submitted.value = false
    let active = true
    readyAttempt = attempt
    window.addEventListener('message', onRetryBarrier)
    waitForForm()
    const widget = createWidget(FEEDBACK_FORM_ID, {
      container: element,
      hidden: props.hiddenFields,
      inlineOnMobile: true,
      redirectTarget: '_self',
      iframeProps: {
        title: t('feedback.modalLabel'),
        allow: 'camera; microphone; autoplay; encrypted-media; fullscreen'
      },
      onReady: () => {
        if (!active || readyAttempt !== attempt) return
        clearLoadTimer()
        loading.value = false
        failed.value = false
      },
      onSubmit: () => {
        if (active) onSubmit()
      }
    })
    reloadWidget = () => widget.refresh()
    onCleanup(() => {
      active = false
      reloadWidget = null
      window.removeEventListener('message', onRetryBarrier)
      clearLoadTimer()
      clearAutoclose()
      widget.unmount()
    })
  },
  { flush: 'post' }
)
</script>

<template>
  <BaseModal
    :open="open"
    size="xl"
    :aria-label="t('feedback.modalLabel')"
    content-class="feedback-modal-panel [&.base-modal-panel]:min-h-0 [&_.base-modal-body]:overflow-hidden [&_.base-modal-body]:p-0"
    @close="onClose"
  >
    <div class="feedback-modal-body relative h-[clamp(520px,76vh,820px)] w-full overflow-hidden">
      <div
        v-if="loading"
        class="feedback-modal-loading pointer-events-none absolute inset-0 z-1 grid place-items-center text-[13px] text-[color:color-mix(in_oklab,var(--neutral-100,#fff)_65%,transparent)]"
        role="status"
        aria-live="polite"
      >
        {{ t('feedback.loading') }}
      </div>
      <div
        v-else-if="failed"
        class="absolute inset-0 z-1 flex flex-col items-center justify-center gap-3 px-10 text-center"
        role="alert"
        data-testid="feedback-failed"
      >
        <h2 class="m-0 text-heading font-semibold text-foreground">
          {{ t('feedback.failedTitle') }}
        </h2>
        <p class="m-0 max-w-90 text-ui text-muted-foreground">
          {{ t('apps.failedBody') }}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="mt-1"
          data-testid="feedback-retry"
          @click="retry"
        >
          {{ t('apps.retry') }}
        </Button>
      </div>
      <div
        ref="container"
        class="absolute inset-0 size-full"
        :class="{ invisible: failed }"
        data-testid="feedback-widget"
      />
    </div>
  </BaseModal>
</template>
