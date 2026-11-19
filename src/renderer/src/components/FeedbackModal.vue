<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createWidget } from '@typeform/embed'
import '@typeform/embed/build/css/widget.css'
import BaseModal from './ui/BaseModal.vue'
import { emitTelemetryAction } from '../lib/telemetry'

const FEEDBACK_FORM_ID = 'VhOXmuaL'
const AUTOCLOSE_MS = 2000

const props = defineProps<{
  open: boolean
  hiddenFields: Record<string, string>
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const container = ref<HTMLElement | null>(null)
const loading = ref(true)
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

watch(
  [() => props.open, container],
  ([open, element], _previous, onCleanup) => {
    if (!open || !element) return
    loading.value = true
    submitted.value = false
    let active = true
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
        if (active) loading.value = false
      },
      onSubmit: () => {
        if (active) onSubmit()
      }
    })
    onCleanup(() => {
      active = false
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
    close-outside
    :aria-label="t('feedback.modalLabel')"
    content-class="feedback-modal-panel [&.base-modal-panel]:min-h-0 [&_.base-modal-body]:overflow-hidden [&_.base-modal-body]:rounded-[inherit] [&_.base-modal-body]:p-0"
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
      <div ref="container" class="absolute inset-0 size-full" data-testid="feedback-widget" />
    </div>
  </BaseModal>
</template>
