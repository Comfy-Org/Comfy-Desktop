<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle, XCircle, Ban } from 'lucide-vue-next'
import { operationInflightLabel, operationSuccessLabel } from '../lib/progressStatusLabel'
import { MSG_CANCELLED } from '../../../shared/operationStatus'
import OperationErrorDetail from '../components/ui/OperationErrorDetail.vue'
import type { PopupInstancePickerSnapshot } from '../../../preload/comfyTitlePopupPreload'

type OperationStatus = PopupInstancePickerSnapshot['installOperationStatus'][string]

interface Props {
  operation: OperationStatus
  installationName: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  open: []
  cancel: []
  retry: []
  dismiss: []
}>()

const { t } = useI18n()

const isInflight = computed(() => !props.operation.done)
const isSuccess = computed(() => props.operation.done && props.operation.ok === true)
const isError = computed(
  () =>
    props.operation.done && props.operation.ok === false && props.operation.error !== MSG_CANCELLED
)
const isCancelled = computed(() => props.operation.done && props.operation.error === MSG_CANCELLED)

const progressPercent = computed(() => Math.min(100, Math.max(0, props.operation.percent)))
const isIndeterminate = computed(() => props.operation.percent < 0 && !props.operation.done)

const statusLabel = computed(() => {
  if (isCancelled.value) return t('instancePicker.progressCancelled')
  if (isError.value) return props.operation.error ?? t('instancePicker.progressError')
  if (isSuccess.value) return operationSuccessLabel(props.operation, t)
  return props.operation.status || operationInflightLabel(props.operation, t)
})
</script>

<template>
  <div class="pip flex size-full box-border items-center justify-center px-6 py-8">
    <Transition
      name="pip-fade"
      mode="out-in"
      enter-active-class="pip-fade-enter-active transition-[opacity,transform] duration-200 ease-[ease]"
      leave-active-class="pip-fade-leave-active transition-[opacity,transform] duration-200 ease-[ease]"
      enter-from-class="pip-fade-enter-from opacity-0 [transform:translateY(6px)]"
      leave-to-class="pip-fade-leave-to opacity-0 [transform:translateY(6px)]"
    >
      <div
        v-if="isInflight"
        key="inflight"
        class="pip__body flex w-full max-w-[260px] flex-col items-center gap-3 text-center"
      >
        <div class="pip__spinner relative size-16 shrink-0" aria-hidden="true">
          <svg viewBox="0 0 36 36" class="pip__ring size-full [transform:rotate(-90deg)]">
            <circle
              class="pip__ring-track fill-none stroke-[var(--chooser-surface-border)] [stroke-width:3]"
              cx="18"
              cy="18"
              r="15"
            />
            <circle
              class="pip__ring-fill fill-none stroke-[var(--brand-accent,#f5c518)] [stroke-width:3] [stroke-linecap:round] [stroke-dasharray:94.25] transition-[stroke-dashoffset] duration-300 ease-[ease]"
              cx="18"
              cy="18"
              r="15"
              :class="
                isIndeterminate
                  ? 'is-indeterminate [stroke-dashoffset:56] animate-spin [animation-duration:1.2s] origin-center [transform-box:fill-box]'
                  : '[stroke-dashoffset:94.25]'
              "
              :style="
                isIndeterminate ? {} : { strokeDashoffset: 94.25 - (94.25 * progressPercent) / 100 }
              "
            />
          </svg>
          <span
            v-if="!isIndeterminate"
            class="pip__pct absolute inset-0 flex items-center justify-center text-[11px] font-semibold tracking-[-0.3px] text-text"
            >{{ progressPercent }}%</span
          >
        </div>

        <p class="pip__label m-0 text-[12px] leading-[1.4] text-text-muted [word-break:break-word]">
          {{ statusLabel }}
        </p>

        <button
          v-if="operation.cancellable"
          type="button"
          class="pip__ghost-btn h-[30px] rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-4 py-0 text-[12px] text-text-muted cursor-pointer transition-[color,border-color] duration-[120ms] ease-[ease] hover:border-[var(--text-muted,var(--neutral-100))] hover:text-text"
          @click="emit('cancel')"
        >
          {{ t('instancePicker.progressCancel') }}
        </button>
      </div>

      <div
        v-else-if="isSuccess"
        key="success"
        class="pip__body flex w-full max-w-[260px] flex-col items-center gap-3 text-center"
      >
        <div
          class="pip__icon pip__icon--success mb-1 flex items-center justify-center text-[var(--brand-success,#27ae60)]"
        >
          <CheckCircle :size="40" />
        </div>
        <p class="pip__heading m-0 text-[14px] leading-[1.3] font-semibold text-text">
          {{ operationSuccessLabel(operation, t) }}
        </p>
        <p
          class="pip__subtext m-0 text-[12px] leading-[1.5] text-text-muted [word-break:break-word]"
        >
          {{ installationName }} {{ t('instancePicker.progressSuccessSubtext') }}
        </p>
        <button
          type="button"
          class="pip__primary-btn mt-1 h-[34px] rounded-lg border-none bg-[var(--brand-accent,#f5c518)] px-5 py-0 text-[13px] font-semibold text-black cursor-pointer transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.85] active:opacity-70"
          @click="emit('open')"
        >
          {{ t('instancePicker.progressOpenInstance') }}
        </button>
      </div>

      <div
        v-else-if="isError"
        key="error"
        class="pip__body flex w-full max-w-[260px] flex-col items-center gap-3 text-center"
      >
        <div
          class="pip__icon pip__icon--error mb-1 flex items-center justify-center text-[var(--brand-error,#e74c3c)]"
        >
          <XCircle :size="40" />
        </div>
        <p
          class="pip__heading pip__heading--error m-0 text-[14px] leading-[1.3] font-semibold text-[var(--brand-error,#e74c3c)]"
        >
          {{ t('instancePicker.progressError') }}
        </p>
        <OperationErrorDetail v-if="operation.error" :error="operation.error" compact />
        <div class="pip__actions mt-1 flex w-full flex-col items-center gap-2">
          <button
            type="button"
            class="pip__primary-btn mt-1 h-[34px] rounded-lg border-none bg-[var(--brand-accent,#f5c518)] px-5 py-0 text-[13px] font-semibold text-black cursor-pointer transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.85] active:opacity-70"
            @click="emit('retry')"
          >
            {{ t('instancePicker.progressRetry') }}
          </button>
          <button
            type="button"
            class="pip__ghost-btn h-[30px] rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-4 py-0 text-[12px] text-text-muted cursor-pointer transition-[color,border-color] duration-[120ms] ease-[ease] hover:border-[var(--text-muted,var(--neutral-100))] hover:text-text"
            @click="emit('dismiss')"
          >
            {{ t('instancePicker.progressDismiss') }}
          </button>
        </div>
      </div>

      <div
        v-else-if="isCancelled"
        key="cancelled"
        class="pip__body flex w-full max-w-[260px] flex-col items-center gap-3 text-center"
      >
        <div
          class="pip__icon pip__icon--cancelled mb-1 flex items-center justify-center text-text-muted opacity-45"
        >
          <Ban :size="36" />
        </div>
        <p class="pip__heading m-0 text-[14px] leading-[1.3] font-semibold text-text">
          {{ t('instancePicker.progressCancelled') }}
        </p>
      </div>
    </Transition>
  </div>
</template>
