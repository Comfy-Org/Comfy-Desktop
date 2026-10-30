<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { useModal, type ModalOption } from '../composables/useModal'
import { TID } from '../../../shared/testIds'
import InfoTooltip from './InfoTooltip.vue'
import MigrateConfirmBody from './MigrateConfirmBody.vue'
import BaseAlert from './ui/BaseAlert.vue'
import { formatNodeVersion } from '../lib/snapshots'

const { t } = useI18n()

const { state, close, dismiss } = useModal()

/** Migrate-to-Standalone flow; `snapshotPreview` is only set by
 *  useMigrateAction, so its presence reliably cues the brand layout. */
const isMigrateConfirm = computed(() => state.type === 'confirm' && state.snapshotPreview != null)

/** A confirm with no extras renders through BaseAlert; rich confirms keep
 *  the legacy markup with its scrollable body. */
const isSimpleConfirm = computed(
  () =>
    state.type === 'confirm' &&
    !state.loading &&
    state.snapshotPreview == null &&
    state.messageDetails.length === 0 &&
    state.checkboxes.length === 0 &&
    state.variantCards.length === 0 &&
    !state.variantLoading
)

/** BaseAlert owns its own teleport + overlay, so the legacy overlay below
 *  must skip when this is true to avoid double-mounting a backdrop. */
const usesBaseAlert = computed(() => state.type === 'alert' || isSimpleConfirm.value)

const baseAlertTone = computed<'primary' | 'danger'>(() =>
  state.type === 'confirm' && state.confirmStyle === 'danger' ? 'danger' : 'primary'
)

/** Alert uses buttonLabel (single OK); simple confirm uses confirmLabel. */
const baseAlertButtonLabel = computed(() =>
  state.type === 'alert' ? state.buttonLabel : state.confirmLabel
)

function onBaseAlertClose(): void {
  if (state.type === 'alert') close(undefined)
  else close(true)
}

function onBaseAlertCancel(): void {
  close(false)
}

/** Mirror checkbox flips back into state.checkboxes so
 *  useModal.getLastCheckboxValues() sees them at submit time. */
function onMigrateCheckboxToggle(id: string, checked: boolean): void {
  const cb = state.checkboxes.find((c) => c.id === id)
  if (cb) cb.checked = checked
}

const inputValue = ref('')
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const overlayRef = ref<HTMLDivElement | null>(null)
const mouseDownOnOverlay = ref(false)
const spNodesExpanded = ref(true)
const spPipExpanded = ref(false)

const localOptions = reactive<(ModalOption & { checked: boolean })[]>([])

const anyChecked = computed(() => localOptions.some((o) => o.checked))

// Preserve the legacy actions' geometry and focus affordance on the shared button.
const actionClass =
  'static inline-block rounded-lg border border-solid px-4 py-2 text-[14px] leading-[1.5] appearance-auto whitespace-normal transition-none disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color]'
const neutralActionClass =
  actionClass +
  ' border-[var(--border)] bg-[var(--surface)] font-normal text-text hover:bg-[var(--border)]'
const primaryActionClass =
  actionClass +
  ' border-[var(--accent-primary)] bg-[var(--accent-primary)] font-medium text-[var(--color-background)] hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] enabled:hover:border-[var(--accent-hover)] enabled:hover:bg-[var(--accent-hover)] hover:[transition:background_120ms_ease,border-color_120ms_ease]'
const confirmClass = computed(() => {
  if (state.confirmStyle === 'primary') return primaryActionClass
  if (state.confirmStyle === 'danger' || state.confirmStyle === 'danger-solid') {
    return (
      actionClass +
      ' border-[var(--danger)] bg-[var(--danger)] font-normal text-[var(--bg)] hover:bg-[color-mix(in_srgb,var(--danger)_85%,#000)]'
    )
  }
  if (state.confirmStyle === 'accent') {
    return (
      actionClass +
      ' border-[var(--accent)] bg-[var(--surface)] font-semibold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--bg)]'
    )
  }
  return [neutralActionClass, state.confirmStyle]
})

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function linkify(text: string): string {
  if (!text) return ''
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g)
  return parts
    .map((part, i) => {
      const escaped = escapeHtml(part)
      if (i % 2 === 1) {
        return `<a href="#" class="modal-link" data-url="${escaped}">${escaped}</a>`
      }
      return escaped
    })
    .join('')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

const linkifiedMessage = computed(() => linkify(state.message))

function handleMessageClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.classList.contains('modal-link')) {
    event.preventDefault()
    const url = target.dataset.url
    if (url) {
      window.api.openExternal(url)
    }
  }
}

function submitPrompt(): void {
  const value = inputValue.value.trim()
  if (state.required && !value) {
    error.value = typeof state.required === 'string' ? state.required : 'This field is required'
    return
  }
  close(value)
}

function submitOptions(): void {
  const result: Record<string, boolean> = {}
  for (const opt of localOptions) {
    result[opt.id] = opt.checked
  }
  close(result)
}

function handleOverlayMouseDown(event: MouseEvent): void {
  mouseDownOnOverlay.value = event.target === overlayRef.value
}

function handleOverlayClick(event: MouseEvent): void {
  if (mouseDownOnOverlay.value && event.target === overlayRef.value) {
    dismiss()
  }
  mouseDownOnOverlay.value = false
}

function resetSnapshotExpansion(): void {
  const sp = state.snapshotPreview
  const hasVariantCards = state.variantCards.length > 0 || state.variantLoading
  spNodesExpanded.value = hasVariantCards ? false : sp ? sp.customNodes.length > 0 : true
  spPipExpanded.value = false
}

watch(
  () => state.snapshotPreview,
  () => {
    if (state.visible && state.type === 'confirm') {
      resetSnapshotExpansion()
    }
  }
)

watch(
  () => state.variantCards,
  () => {
    if (state.visible && state.type === 'confirm' && state.variantCards.length > 0) {
      spNodesExpanded.value = false
    }
  }
)

function handleKeydown(event: KeyboardEvent): void {
  if (!state.visible) return
  // BaseAlert owns ESC dismissal for alert + simple confirm; skip to avoid
  // double-resolving the promise.
  if (usesBaseAlert.value) return
  if (event.key === 'Escape') {
    dismiss()
  }
}

watch(
  () => state.visible,
  async (visible) => {
    if (!visible) return

    if (state.type === 'prompt') {
      inputValue.value = state.defaultValue
      error.value = ''
      await nextTick()
      inputRef.value?.focus()
      inputRef.value?.select()
    }

    if (state.type === 'confirm') {
      resetSnapshotExpansion()
    }

    if (state.type === 'confirmWithOptions') {
      localOptions.length = 0
      for (const opt of state.options) {
        localOptions.push({ id: opt.id, label: opt.label, checked: opt.checked ?? false })
      }
    }
  }
)

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <!-- Alerts and simple confirms render through BaseAlert; rich confirms /
       prompt / select / options stay in the legacy markup below. -->
  <BaseAlert
    :open="state.visible && usesBaseAlert"
    :title="state.title"
    :message="state.message"
    :show-cancel="isSimpleConfirm"
    :button-label="baseAlertButtonLabel"
    :tone="baseAlertTone"
    :test-id-root="state.testIds.root"
    :test-id-action="state.testIds.action"
    :test-id-cancel="state.testIds.cancel"
    @close="onBaseAlertClose"
    @cancel="onBaseAlertCancel"
  />

  <Teleport to="body">
    <div
      v-if="state.visible && !usesBaseAlert"
      ref="overlayRef"
      class="dialog-overlay fixed inset-0 z-[100] flex items-center justify-center [-webkit-backdrop-filter:blur(2px)]"
      @mousedown="handleOverlayMouseDown"
      @click="handleOverlayClick"
    >
      <!-- Rich confirm; simple confirms fall through to BaseAlert above. -->
      <div
        v-if="state.type === 'confirm'"
        class="dialog-box min-w-[320px] rounded-[var(--radius-panel)] border border-solid bg-[var(--neutral-800)] px-6"
        :class="
          isMigrateConfirm
            ? 'mig-modal w-[min(100%,600px)] max-w-[600px] border-[var(--brand-surface-border)] pt-5 pb-[18px] shadow-[0_24px_64px_0_rgba(0,0,0,0.35)]'
            : [
                'border-[var(--border)] py-4',
                state.snapshotPreview ||
                state.loading ||
                state.variantLoading ||
                state.variantCards.length > 0
                  ? 'w-[720px] max-w-[720px]'
                  : 'max-w-[400px]'
              ]
        "
      >
        <div
          class="dialog-title -mx-6 border-b border-solid px-6"
          :class="
            isMigrateConfirm
              ? 'mb-4 border-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] pb-3.5 text-[length:var(--takeover-fs-h3)] font-medium text-text'
              : 'mb-3 border-[var(--border)] pb-3 text-[16px] font-semibold'
          "
        >
          {{ state.title }}
        </div>
        <div
          class="dialog-body mb-0 overflow-y-auto"
          :class="
            isMigrateConfirm
              ? 'flex max-h-[70vh] flex-col gap-3.5'
              : state.loading || state.variantLoading || state.variantCards.length > 0
                ? 'max-h-[70vh]'
                : 'max-h-[50vh]'
          "
        >
          <!-- Hidden when message is empty (migrate flow sets none) to
               avoid a stray empty box at the top. -->
          <div
            v-if="state.message"
            class="dialog-prompt-card mb-3 rounded-md border border-solid border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-[14px] leading-[1.6] whitespace-pre-line text-text-muted [&_strong]:font-semibold [&_strong]:text-text"
            @click="handleMessageClick"
            v-html="linkifiedMessage"
          ></div>

          <div
            v-if="state.loading"
            class="dialog-loading flex items-center justify-center gap-2.5 py-6 text-[14px] text-text-muted"
          >
            <div
              class="dialog-loading-spinner size-5 animate-spin rounded-[50%] border-2 border-solid border-[var(--border)] border-t-[var(--accent)] [animation-duration:0.6s]"
            />
            <span>{{ $t('common.loading') }}</span>
          </div>

          <!-- Migrate-flow brand layout (counts only, no device picker). -->
          <template v-if="isMigrateConfirm && !state.loading && state.snapshotPreview">
            <MigrateConfirmBody
              :preview="state.snapshotPreview"
              :details="state.messageDetails"
              :checkboxes="state.checkboxes"
              @toggle-checkbox="onMigrateCheckboxToggle"
            />
          </template>

          <!-- Detailed snapshot preview; gated off for the migrate flow. -->
          <template v-if="!isMigrateConfirm && !state.loading && state.snapshotPreview">
            <div class="dialog-grid mb-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div class="dialog-field mb-1 flex flex-col gap-0.5">
                <span class="dialog-label text-[13px] text-text-muted">{{
                  $t('snapshots.comfyuiVersion')
                }}</span>
                <span class="dialog-value text-[14px] text-text select-text">{{
                  state.snapshotPreview.comfyuiVersion
                }}</span>
              </div>
              <div class="dialog-field mb-1 flex flex-col gap-0.5">
                <span class="dialog-label text-[13px] text-text-muted">{{
                  $t('snapshots.variant')
                }}</span>
                <span class="dialog-value text-[14px] text-text select-text">{{
                  state.snapshotPreview.comfyui.variant || '—'
                }}</span>
              </div>
              <div
                v-if="state.snapshotPreview.pythonVersion"
                class="dialog-field mb-1 flex flex-col gap-0.5"
              >
                <span class="dialog-label text-[13px] text-text-muted">{{
                  $t('snapshots.pythonVersion')
                }}</span>
                <span class="dialog-value text-[14px] text-text select-text">{{
                  state.snapshotPreview.pythonVersion
                }}</span>
              </div>
            </div>

            <div class="dialog-subsection mt-2.5">
              <div
                class="dialog-subsection-title mb-1.5 flex cursor-pointer select-none items-center justify-between text-[13px] font-semibold text-text-muted"
                @click="spNodesExpanded = !spNodesExpanded"
              >
                <span
                  >{{ $t('snapshots.customNodes') }} ({{
                    state.snapshotPreview.customNodes.length
                  }})<InfoTooltip :text="t('tooltips.customNodes')" side="bottom"
                /></span>
                <span class="dialog-collapse text-[14px]">{{ spNodesExpanded ? '▾' : '▸' }}</span>
              </div>
              <template v-if="spNodesExpanded">
                <div
                  v-if="state.snapshotPreview.customNodes.length > 0"
                  class="dialog-list flex max-h-[240px] flex-col gap-[3px] overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
                >
                  <div
                    v-for="node in state.snapshotPreview.customNodes"
                    :key="node.id"
                    class="dialog-node-row flex items-center gap-2 py-0.5 text-[13px]"
                  >
                    <span
                      class="dialog-node-status size-[7px] shrink-0 rounded-[50%]"
                      :class="node.enabled ? 'bg-[var(--info)]' : 'bg-[var(--text-muted)]'"
                    />
                    <span class="dialog-node-name min-w-0 flex-1 truncate text-text select-text">{{
                      node.id
                    }}</span>
                    <span
                      class="dialog-node-type shrink-0 rounded-[3px] border border-solid border-[var(--border)] px-[5px] py-px text-[11px] font-semibold text-text-muted uppercase"
                      >{{ node.type }}</span
                    >
                    <span
                      class="dialog-node-version shrink-0 text-[13px] text-text-muted [font-family:monospace] select-text"
                      >{{ formatNodeVersion(node) }}</span
                    >
                  </div>
                </div>
                <div v-else class="dialog-empty text-[14px] text-text-muted">—</div>
              </template>
            </div>

            <div class="dialog-subsection mt-2.5">
              <div
                class="dialog-subsection-title mb-1.5 flex cursor-pointer select-none items-center justify-between text-[13px] font-semibold text-text-muted"
                @click="spPipExpanded = !spPipExpanded"
              >
                <span
                  >{{ $t('snapshots.pipPackages') }} ({{
                    state.snapshotPreview.pipPackageCount
                  }})<InfoTooltip :text="t('tooltips.pipPackages')" side="bottom"
                /></span>
                <span class="dialog-collapse text-[14px]">{{ spPipExpanded ? '▾' : '▸' }}</span>
              </div>
              <template v-if="spPipExpanded">
                <div
                  v-if="state.snapshotPreview.pipPackageCount > 0"
                  class="dialog-list flex max-h-[240px] flex-col gap-[3px] overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
                >
                  <div
                    v-for="(version, name) in state.snapshotPreview.pipPackages"
                    :key="name"
                    class="dialog-pip-row flex items-center justify-between py-0.5 text-[13px]"
                  >
                    <span class="dialog-pip-name min-w-0 flex-1 truncate text-text select-text">{{
                      name
                    }}</span>
                    <span
                      class="dialog-pip-version ml-3 max-w-1/2 truncate text-text-muted [font-family:monospace] select-text"
                      :title="version"
                      >{{ version }}</span
                    >
                  </div>
                </div>
                <div v-else class="dialog-empty text-[14px] text-text-muted">—</div>
              </template>
            </div>
          </template>

          <!-- Generic details + checkboxes; the migrate layout renders its
               own, so skip when migrate is active. -->
          <template v-if="!isMigrateConfirm">
            <div v-if="state.messageDetails.length" class="dialog-details mt-3 mb-0">
              <div
                v-for="(group, gi) in state.messageDetails"
                :key="gi"
                class="dialog-detail-group mb-1.5"
              >
                <span
                  class="dialog-detail-label mb-1.5 block text-[13px] font-semibold text-text uppercase"
                  >{{ group.label }}</span
                >
                <div
                  class="dialog-detail-recessed max-h-[200px] overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                  @click="handleMessageClick"
                >
                  <div
                    v-for="(item, ii) in group.items"
                    :key="ii"
                    class="dialog-detail-item text-[14px] leading-[1.6] whitespace-pre-line text-text-muted [&_a]:cursor-pointer [&_a]:text-[var(--accent)] [&_a]:underline"
                    v-html="linkify(item)"
                  ></div>
                </div>
              </div>
            </div>
            <div
              v-if="state.checkboxes.length"
              class="dialog-options mt-3 mb-4 flex flex-col items-start gap-1.5 border-t border-solid border-[var(--border)] pt-3"
            >
              <label
                v-for="cb in state.checkboxes"
                :key="cb.id"
                class="dialog-option inline-flex cursor-pointer select-none items-center gap-2 text-[14px] text-text-muted"
              >
                <input
                  v-model="cb.checked"
                  type="checkbox"
                  class="relative mt-0 size-4 shrink-0 cursor-pointer appearance-auto rounded-[3px] accent-[var(--accent)] [background:none] checked:[background:none] [transition:background_0.2s] after:content-none"
                />
                <span>{{ cb.label }}</span>
              </label>
            </div>
          </template>
        </div>
        <div
          class="dialog-actions -mx-6 flex justify-end gap-2 border-t border-solid px-6"
          :class="
            isMigrateConfirm
              ? 'mt-4 border-[color-mix(in_oklab,var(--neutral-100)_8%,transparent)] pt-3.5'
              : 'border-[var(--border)] pt-3'
          "
        >
          <Button
            variant="secondary"
            size="unset"
            :class="neutralActionClass"
            :data-testid="TID.modalCancel"
            @click="close(false)"
          >
            {{ $t('common.cancel') }}
          </Button>
          <Button
            variant="secondary"
            size="unset"
            :class="confirmClass"
            :disabled="
              state.loading ||
              state.variantLoading ||
              (state.variantCards.length > 0 && !state.selectedVariant)
            "
            :data-testid="TID.modalConfirm"
            @click="close(true)"
          >
            {{ state.confirmLabel }}
          </Button>
        </div>
      </div>

      <div
        v-else-if="state.type === 'confirmWithOptions'"
        class="dialog-box min-w-[320px] max-w-[400px] rounded-[var(--radius-panel)] border border-solid border-[var(--border)] bg-[var(--neutral-800)] px-6 py-4"
      >
        <div
          class="dialog-title -mx-6 mb-3 border-b border-solid border-[var(--border)] px-6 pb-3 text-[16px] font-semibold"
        >
          {{ state.title }}
        </div>
        <div
          class="dialog-message mb-5 max-h-[50vh] overflow-y-auto text-[14px] whitespace-pre-line text-text-muted select-text"
        >
          {{ state.message }}
        </div>
        <div
          class="dialog-options mt-3 mb-4 flex flex-col items-start gap-1.5 border-t border-solid border-[var(--border)] pt-3"
        >
          <label
            v-for="opt in localOptions"
            :key="opt.id"
            class="dialog-option inline-flex cursor-pointer select-none items-center gap-2 text-[14px] text-text-muted"
          >
            <input
              v-model="opt.checked"
              type="checkbox"
              class="relative mt-0 size-4 shrink-0 cursor-pointer appearance-auto rounded-[3px] accent-[var(--accent)] [background:none] checked:[background:none] [transition:background_0.2s] after:content-none"
            />
            <span>{{ opt.label }}</span>
          </label>
        </div>
        <div
          class="dialog-actions -mx-6 flex justify-end gap-2 border-t border-solid border-[var(--border)] px-6 pt-3"
        >
          <Button
            variant="secondary"
            size="unset"
            :class="neutralActionClass"
            @click="close(null)"
            >{{ $t('common.cancel') }}</Button
          >
          <Button
            variant="secondary"
            size="unset"
            :class="confirmClass"
            :disabled="!anyChecked"
            @click="submitOptions()"
          >
            {{ state.confirmLabel }}
          </Button>
        </div>
      </div>

      <div
        v-else-if="state.type === 'prompt'"
        class="dialog-box min-w-[320px] rounded-[var(--radius-panel)] border border-solid border-[var(--border)] bg-[var(--neutral-800)] px-6 py-4"
        :class="state.messageDetails.length > 0 ? 'w-[720px] max-w-[720px]' : 'max-w-[400px]'"
      >
        <div
          class="dialog-title -mx-6 mb-3 border-b border-solid border-[var(--border)] px-6 pb-3 text-[16px] font-semibold"
        >
          {{ state.title }}
        </div>
        <div
          class="dialog-body mb-0 overflow-y-auto"
          :class="state.messageDetails.length > 0 ? 'max-h-[70vh]' : 'max-h-[50vh]'"
        >
          <div
            class="dialog-prompt-card mb-3 rounded-md border border-solid border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-[14px] leading-[1.6] whitespace-pre-line text-text-muted [&_strong]:font-semibold [&_strong]:text-text"
            v-html="linkify(state.message)"
          ></div>
          <div v-if="state.messageDetails.length" class="dialog-details mt-3 mb-0">
            <div
              v-for="(group, gi) in state.messageDetails"
              :key="gi"
              class="dialog-detail-group mb-1.5"
            >
              <span
                class="dialog-detail-label mb-1.5 block text-[13px] font-semibold text-text uppercase"
                >{{ group.label }}</span
              >
              <div
                class="dialog-detail-recessed max-h-[200px] overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                @click="handleMessageClick"
              >
                <div
                  v-for="(item, ii) in group.items"
                  :key="ii"
                  class="dialog-detail-item text-[14px] leading-[1.6] whitespace-pre-line text-text-muted [&_a]:cursor-pointer [&_a]:text-[var(--accent)] [&_a]:underline"
                  v-html="linkify(item)"
                ></div>
              </div>
            </div>
          </div>
          <div class="dialog-input-wrap mb-3">
            <label class="dialog-input-label mb-1 block text-[13px] font-semibold text-text">{{
              $t('common.name')
            }}</label>
            <input
              ref="inputRef"
              v-model="inputValue"
              type="text"
              class="dialog-input mt-1.5 w-full rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[14px] text-text outline-none focus:border-[var(--accent)] disabled:opacity-40"
              :data-testid="TID.modalPromptInput"
              :placeholder="state.placeholder"
              @keydown.enter="submitPrompt"
            />
          </div>
          <div v-if="error" class="dialog-error mb-0 min-h-3 text-[13px] text-[var(--danger)]">
            {{ error }}
          </div>
        </div>
        <div
          class="dialog-actions -mx-6 flex justify-end gap-2 border-t border-solid border-[var(--border)] px-6 pt-3"
        >
          <Button
            variant="secondary"
            size="unset"
            :class="neutralActionClass"
            :data-testid="TID.modalCancel"
            @click="close(null)"
          >
            {{ $t('common.cancel') }}
          </Button>
          <Button
            variant="secondary"
            size="unset"
            :class="primaryActionClass"
            :data-testid="TID.modalConfirm"
            @click="submitPrompt"
          >
            {{ state.confirmLabel }}
          </Button>
        </div>
      </div>

      <div
        v-else-if="state.type === 'select'"
        class="dialog-box dialog-select-box min-w-[340px] max-w-[440px] rounded-[var(--radius-panel)] border border-solid border-[var(--border)] bg-[var(--neutral-800)] px-6 py-4"
      >
        <div
          class="dialog-title -mx-6 mb-3 border-b border-solid border-[var(--border)] px-6 pb-3 text-[16px] font-semibold"
        >
          {{ state.title }}
        </div>
        <div
          v-if="state.message"
          class="dialog-message mb-5 max-h-[50vh] overflow-y-auto text-[14px] whitespace-pre-line text-text-muted select-text"
        >
          {{ state.message }}
        </div>
        <div
          class="dialog-select-list mb-4 flex max-h-[40vh] flex-col gap-1 overflow-y-auto text-[var(--neutral-100)]"
        >
          <Button
            v-for="item in state.items"
            :key="item.value"
            variant="secondary"
            size="unset"
            class="dialog-select-item static flex w-full items-center gap-2 rounded-md border border-solid border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-left text-[14px] leading-[1.5] font-normal whitespace-normal text-text appearance-auto hover:border-[var(--accent)] hover:bg-[var(--surface)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color]"
            @click="close(item.value)"
          >
            <span class="dialog-select-item-label flex-1 font-medium">{{ item.label }}</span>
            <span
              v-if="item.description"
              class="dialog-select-item-desc text-[12px] text-text-muted"
            >
              {{ item.description }}
            </span>
          </Button>
        </div>
        <div
          class="dialog-actions -mx-6 flex justify-end gap-2 border-t border-solid border-[var(--border)] px-6 pt-3"
        >
          <Button
            variant="secondary"
            size="unset"
            :class="neutralActionClass"
            @click="close(null)"
            >{{ $t('common.cancel') }}</Button
          >
        </div>
      </div>
    </div>
  </Teleport>
</template>
