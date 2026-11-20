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

type WindowListener = Parameters<Window['addEventListener']>

interface LoadAttempt {
  retire: () => void
}

let current: LoadAttempt | null = null

function createTrackedWidget(options: Parameters<typeof createWidget>[1]): {
  widget: ReturnType<typeof createWidget>
  listeners: WindowListener[]
} {
  const listeners: WindowListener[] = []
  const add = window.addEventListener
  window.addEventListener = function (this: Window, ...args: WindowListener) {
    listeners.push(args)
    add.apply(this, args)
  } as Window['addEventListener']
  try {
    return { widget: createWidget(FEEDBACK_FORM_ID, options), listeners }
  } finally {
    window.addEventListener = add
  }
}

function startAttempt(element: HTMLElement): void {
  current?.retire()
  loading.value = true
  failed.value = false
  let loadTimer: ReturnType<typeof setTimeout> | null = null
  const attempt: LoadAttempt = { retire }
  const isCurrent = () => current === attempt
  const { widget, listeners } = createTrackedWidget({
    container: element,
    hidden: props.hiddenFields,
    inlineOnMobile: true,
    redirectTarget: '_self',
    iframeProps: {
      title: t('feedback.modalLabel'),
      allow: 'camera; microphone; autoplay; encrypted-media; fullscreen'
    },
    onReady: () => {
      if (!isCurrent()) return
      clearLoadTimer()
      loading.value = false
      failed.value = false
    },
    onSubmit: () => {
      if (isCurrent()) onSubmit()
    }
  })

  function clearLoadTimer(): void {
    if (loadTimer != null) {
      clearTimeout(loadTimer)
      loadTimer = null
    }
  }

  function retire(): void {
    if (isCurrent()) current = null
    clearLoadTimer()
    for (const args of listeners.splice(0)) window.removeEventListener(...args)
    widget.unmount()
  }

  current = attempt
  loadTimer = setTimeout(() => {
    loadTimer = null
    if (!isCurrent() || !loading.value) return
    loading.value = false
    failed.value = true
  }, LOAD_TIMEOUT_MS)
}

function retry(): void {
  if (current && container.value) startAttempt(container.value)
}

watch(
  [() => props.open, container],
  ([open, element], _previous, onCleanup) => {
    if (!open || !element) return
    submitted.value = false
    startAttempt(element)
    onCleanup(() => {
      current?.retire()
      clearAutoclose()
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
