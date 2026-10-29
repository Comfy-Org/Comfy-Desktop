<script setup lang="ts">
import { ref, computed, watch, toRaw, onMounted, onBeforeUnmount, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ChevronRight, Upload } from 'lucide-vue-next'
import { useModal } from '../composables/useModal'

import type { SnapshotFilePreview, FieldOption, GPUInfo, ShowProgressOpts } from '../types/ipc'
import { getVariantGpuLabel, sortedCardOptions, findBestVariant } from '../lib/variants'
import { triggerLabel as _triggerLabel, formatDate, formatNodeVersion } from '../lib/snapshots'
import BrandVariantList from '../components/BrandVariantList.vue'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import TakeoverBack from '../components/TakeoverBack.vue'
import { BaseSelect, type BaseSelectOption } from '../components/ui'
import { emitTelemetryAction, toVariantBucket } from '../lib/telemetry'

const emit = defineEmits<{
  close: []
  'show-progress': [opts: ShowProgressOpts]
}>()

const { t } = useI18n()
const modal = useModal()

const isOpen = ref(false)
const preview = ref<SnapshotFilePreview | null>(null)
const installName = ref('')
const loading = ref(false)
const creating = ref(false)
const dragging = ref(false)

const releaseOptions = ref<FieldOption[]>([])
const selectedRelease = ref<FieldOption | null>(null)
const releaseLoading = ref(false)
const variantOptions = ref<FieldOption[]>([])
const selectedVariant = ref<FieldOption | null>(null)
const variantLoading = ref(false)
const detectedGpu = ref<GPUInfo | null>(null)
let optionsGeneration = 0

const nodesExpanded = ref(true)
const pipExpanded = ref(false)
const timelineExpanded = ref(false)

const cardRef = ref<HTMLElement | null>(null)
let returnFocusTo: HTMLElement | null = null

const sortedVariants = computed(() => sortedCardOptions(variantOptions.value))

const snapshotGpuLabel = computed(() => {
  if (!preview.value) return null
  return getVariantGpuLabel(preview.value.newestSnapshot.comfyui.variant || '')
})
const detectedGpuLabel = computed(() => detectedGpu.value?.label || null)
const hardwareMismatch = computed(() => {
  if (!snapshotGpuLabel.value || !detectedGpuLabel.value) return false
  return snapshotGpuLabel.value !== detectedGpuLabel.value
})

const INVALID_NAME_CHARS = /[<>:"/\\|?*]/
const nameHasInvalidChars = computed(() => INVALID_NAME_CHARS.test(installName.value))

const releaseSelectOptions = computed<BaseSelectOption[]>(() =>
  releaseOptions.value.map((opt) => ({
    value: opt.value,
    label: opt.recommended ? `${opt.label} (${t('newInstall.recommended')})` : opt.label,
    description: opt.description
  }))
)
const releasePlaceholder = computed(() => {
  if (releaseLoading.value) return t('newInstall.loading')
  if (releaseOptions.value.length === 0) return t('newInstall.noOptions')
  return ''
})

function onReleaseChange(value: string): void {
  selectedRelease.value = releaseOptions.value.find((o) => o.value === value) ?? null
}

interface SummaryEntry {
  label: string
  value: string
}
const summaryEntries = computed<SummaryEntry[]>(() => {
  if (!preview.value) return []
  const p = preview.value
  const n = p.newestSnapshot
  return [
    { label: t('list.snapshotSourceName'), value: p.installationName || '—' },
    { label: t('list.snapshotCount'), value: String(p.snapshotCount) },
    { label: t('snapshots.comfyuiVersion'), value: n.comfyuiVersion || '—' },
    { label: t('snapshots.variant'), value: n.comfyui.variant || '—' },
    { label: t('snapshots.pythonVersion'), value: n.pythonVersion || '—' },
    { label: t('snapshots.capturedAt'), value: formatDate(n.createdAt) }
  ]
})

function triggerTone(trigger: string): string {
  if (trigger === 'restart') return 'text-[var(--info)]'
  if (trigger === 'manual' || trigger === 'pre-update') return 'text-[var(--success)]'
  if (trigger === 'post-update' || trigger === 'post-restore') return 'text-[var(--warning)]'
  return 'text-text-muted'
}

function triggerCopy(trigger: string): string {
  return _triggerLabel(trigger, t)
}

function open(): void {
  preview.value = null
  installName.value = ''
  loading.value = false
  creating.value = false
  dragging.value = false
  releaseOptions.value = []
  selectedRelease.value = null
  variantOptions.value = []
  selectedVariant.value = null
  releaseLoading.value = false
  variantLoading.value = false
  nodesExpanded.value = true
  pipExpanded.value = false
  timelineExpanded.value = false
  optionsGeneration++
  isOpen.value = true
}

async function loadReleaseOptions(): Promise<void> {
  const gen = ++optionsGeneration
  releaseLoading.value = true
  releaseOptions.value = []
  selectedRelease.value = null
  variantOptions.value = []
  selectedVariant.value = null
  try {
    const gpu = await window.api.detectGPU()
    if (gen !== optionsGeneration) return
    detectedGpu.value = gpu

    // `includeLatestStable: true` is the gate that opens the standalone source's
    // release list (see `standalone/index.ts:328`). Without it the source returns
    // an empty array and the Create Installation button stays disabled with no
    // visible reason. Mirrors the InstallWizardModal / QuickInstallModal calls
    // — the snapshot-import path was the only place that forgot to pass it.
    const options = await window.api.getFieldOptions(
      'standalone',
      'release',
      {},
      { includeLatestStable: true }
    )
    if (gen !== optionsGeneration) return
    releaseOptions.value = options

    // The release dropdown only offers the 'stable'/'latest' channels, so
    // match on the snapshot's update channel (a per-version releaseTag could
    // never equal a channel id). The created install is frozen regardless;
    // this only preselects the channel the snapshot was tracking.
    const snapshotChannel = preview.value?.newestSnapshot.updateChannel
    const match = snapshotChannel ? options.find((o) => o.value === snapshotChannel) : null
    selectedRelease.value = match || options[0] || null
  } finally {
    if (gen === optionsGeneration) releaseLoading.value = false
  }
}

async function loadVariantOptions(): Promise<void> {
  if (!selectedRelease.value) {
    variantOptions.value = []
    selectedVariant.value = null
    return
  }
  const gen = ++optionsGeneration
  variantLoading.value = true
  variantOptions.value = []
  selectedVariant.value = null
  try {
    const rawRelease = JSON.parse(JSON.stringify(toRaw(selectedRelease.value))) as FieldOption
    const options = await window.api.getFieldOptions('standalone', 'variant', {
      release: rawRelease
    })
    if (gen !== optionsGeneration) return
    variantOptions.value = options

    const snapshotVariantId = preview.value?.newestSnapshot.comfyui.variant || ''
    selectedVariant.value = findBestVariant(options, snapshotVariantId)
  } finally {
    if (gen === optionsGeneration) variantLoading.value = false
  }
}

watch(selectedRelease, () => {
  loadVariantOptions()
})

async function loadFromPath(filePath: string): Promise<void> {
  loading.value = true
  try {
    const result = await window.api.previewSnapshotPath(filePath)
    if (!result.ok) {
      if (result.message) {
        await modal.alert({ title: t('list.loadSnapshot'), message: result.message })
      }
      return
    }
    if (result.preview) {
      preview.value = result.preview
      installName.value = result.preview.installationName || ''
      await loadReleaseOptions()
    }
  } finally {
    loading.value = false
  }
}

async function handleBrowse(): Promise<void> {
  const result = await window.api.previewSnapshotFile()
  if (!result.ok) {
    if (result.message) {
      await modal.alert({ title: t('list.loadSnapshot'), message: result.message })
    }
    return
  }
  if (result.preview) {
    preview.value = result.preview
    installName.value = result.preview.installationName || ''
    await loadReleaseOptions()
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  dragging.value = true
}

function handleDragLeave(event: DragEvent): void {
  if (cardRef.value && !cardRef.value.contains(event.relatedTarget as Node)) {
    dragging.value = false
  }
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (!file) return
  if (!file.name.endsWith('.json')) {
    await modal.alert({ title: t('list.loadSnapshot'), message: t('snapshots.importInvalidFile') })
    return
  }
  const filePath = window.api.getPathForFile(file)
  if (!filePath) return
  await loadFromPath(filePath)
}

function handleClearPreview(): void {
  preview.value = null
  releaseOptions.value = []
  selectedRelease.value = null
  variantOptions.value = []
  selectedVariant.value = null
  optionsGeneration++
}

function selectVariant(option: FieldOption): void {
  selectedVariant.value = option
  emitTelemetryAction('comfy.desktop.install.variant.selected', {
    variant_bucket: toVariantBucket((option.data?.variantId as string | undefined) || option.value),
    recommended: !!option.recommended,
    flow: 'snapshot'
  })
}

async function handleCreate(): Promise<void> {
  if (!preview.value || creating.value) return
  creating.value = true
  const filePath = preview.value.filePath
  const releaseTag = selectedRelease.value?.value
  const variantId =
    (selectedVariant.value?.data?.variantId as string) || selectedVariant.value?.value || undefined

  try {
    const result = await window.api.createFromSnapshot(
      filePath,
      installName.value || undefined,
      releaseTag,
      variantId
    )
    if (!result.ok) {
      if (result.message) {
        await modal.alert({ title: t('list.loadSnapshot'), message: result.message })
      }
      return
    }
    if (result.entry) {
      creating.value = false
      isOpen.value = false
      emit('close')
      emit('show-progress', {
        installationId: result.entry.id,
        title: `${t('newInstall.installing')} — ${result.entry.name}`,
        apiCall: () => window.api.installInstance(result.entry!.id),
        cancellable: true,
        autoLaunchOnFinish: true,
        opKind: 'install'
      })
      return
    }
  } finally {
    creating.value = false
  }
}

function preventNav(event: Event): void {
  event.preventDefault()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) emit('close')
}

watch(isOpen, async (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    // Prefer a real field (user types right away); otherwise focus the dialog
    // container itself — never a button — so opening doesn't paint a focus-
    // visible ring. Focus stays trapped for keyboard/AT either way.
    const field = cardRef.value?.querySelector<HTMLElement>('input, select, textarea')
    ;(field ?? cardRef.value)?.focus()
  } else {
    document.removeEventListener('keydown', onKeydown)
    returnFocusTo?.focus()
    returnFocusTo = null
  }
})

onMounted(() => {
  document.addEventListener('dragover', preventNav)
  document.addEventListener('drop', preventNav)
})
onUnmounted(() => {
  document.removeEventListener('dragover', preventNav)
  document.removeEventListener('drop', preventNav)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus()
  returnFocusTo = null
})

defineExpose({ open })
</script>

<template>
  <BrandTakeoverLayout v-if="isOpen">
    <div
      class="load-snapshot-shell mx-auto flex h-full max-h-full min-h-0 w-full max-w-[720px] flex-col items-center justify-center self-stretch py-[clamp(1.5rem,4vh,3rem)] text-center"
      data-testid="load-snapshot-modal"
    >
      <h1
        class="load-snapshot-title m-0 font-display text-[length:var(--takeover-fs-title)] leading-[1.15] font-extrabold tracking-normal text-[var(--legacy-color-text)] opacity-85 text-center"
      >
        {{ $t('loadSnapshot.grandTitle') }}
      </h1>
      <p
        class="load-snapshot-lead mt-[var(--takeover-gap-md)] mr-0 mb-[var(--takeover-gap-lg)] ml-0 font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-200 text-center"
      >
        {{ $t('loadSnapshot.grandSubtitle') }}
      </p>
      <div
        ref="cardRef"
        class="load-snapshot-card flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] text-left [backdrop-filter:blur(var(--brand-surface-blur))]"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('loadSnapshot.grandTitle')"
        tabindex="-1"
        @dragover="!preview && handleDragOver($event)"
        @dragleave="!preview && handleDragLeave($event)"
        @drop="!preview && handleDrop($event)"
      >
        <div
          class="load-snapshot-card__body flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            v-if="!preview"
            class="load-snapshot-dropzone flex min-h-[220px] flex-auto flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed p-8 text-neutral-200 transition-[border-color,background] duration-160 ease-[ease] motion-reduce:transition-none"
            :class="[
              dragging
                ? 'load-snapshot-dropzone--active border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                : 'border-[var(--brand-surface-border)]',
              { 'load-snapshot-dropzone--loading opacity-60 pointer-events-none': loading }
            ]"
          >
            <div
              v-if="loading"
              class="load-snapshot-dropzone__loading text-[length:var(--takeover-fs-body)] text-neutral-300 load-snapshot-with-spinner flex items-center gap-2.5 before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
            >
              {{ $t('newInstall.loading') }}
            </div>
            <template v-else>
              <Upload
                :size="32"
                class="load-snapshot-dropzone__icon mb-1 text-neutral-300"
                aria-hidden="true"
              />
              <div
                class="load-snapshot-dropzone__hint text-center text-[length:var(--takeover-fs-body)] text-neutral-200"
              >
                {{ $t('list.snapshotDropHint') }}
              </div>
              <div
                class="load-snapshot-dropzone__or text-[length:var(--takeover-fs-caption)] text-neutral-300"
              >
                {{ $t('common.or') }}
              </div>
              <Button
                variant="textonly"
                size="unset"
                class="load-snapshot-tertiary static inline-flex items-center justify-center gap-0 border border-solid px-4 py-2.5 text-[length:var(--takeover-fs-body)] leading-[1.5] font-medium whitespace-normal appearance-auto transition-[background,border-color,color] duration-120 ease-[ease] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 rounded-[var(--radius-control)] border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] text-neutral-100 hover:bg-[var(--brand-surface-bg-hover)] enabled:hover:border-[var(--brand-surface-border-hover)]"
                type="button"
                @click="handleBrowse"
              >
                {{ $t('common.browse') }}
              </Button>
            </template>
          </div>

          <template v-else>
            <div
              class="load-snapshot-field mb-1 flex flex-col gap-2 [&_.ui-select-trigger]:text-[14px]"
            >
              <label class="load-snapshot-label text-[13px] text-neutral-200" for="ls-name">{{
                $t('common.name')
              }}</label>
              <div
                class="load-snapshot-input flex w-full items-center gap-2.5 rounded-md border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-3.5 py-2.5 text-[length:var(--takeover-fs-body)] text-neutral-100 transition-[border-color,background] duration-120 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] has-[input:focus-visible]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
              >
                <input
                  id="ls-name"
                  v-model="installName"
                  class="m-0 min-w-0 w-auto flex-auto box-content rounded-none appearance-none border-0 bg-transparent p-0 text-inherit [font:inherit] cursor-text outline-0 placeholder:text-neutral-400"
                  type="text"
                  :placeholder="$t('common.namePlaceholder')"
                />
              </div>
              <div
                v-if="nameHasInvalidChars"
                class="load-snapshot-hint text-[length:var(--takeover-fs-caption)] text-neutral-300 [&.load-snapshot-hint--warn]:text-[var(--warning)] load-snapshot-hint--warn"
              >
                {{ $t('list.snapshotNameHint') }}
              </div>
            </div>

            <div
              class="load-snapshot-field mb-1 flex flex-col gap-2 [&_.ui-select-trigger]:text-[14px]"
            >
              <label class="load-snapshot-label text-[13px] text-neutral-200">{{
                $t('list.snapshotRelease')
              }}</label>
              <BaseSelect
                :model-value="selectedRelease?.value ?? ''"
                :options="releaseSelectOptions"
                :placeholder="releasePlaceholder"
                :disabled="releaseLoading || releaseOptions.length === 0"
                :aria-label="$t('list.snapshotRelease')"
                @update:model-value="onReleaseChange"
              />
              <div
                v-if="preview.newestSnapshot.comfyui.releaseTag"
                class="load-snapshot-hint text-[length:var(--takeover-fs-caption)] text-neutral-300 [&.load-snapshot-hint--warn]:text-[var(--warning)]"
              >
                {{
                  $t('list.snapshotOriginalRelease', {
                    tag: preview.newestSnapshot.comfyui.releaseTag
                  })
                }}
              </div>
            </div>

            <div
              class="load-snapshot-field mb-1 flex flex-col gap-2 [&_.ui-select-trigger]:text-[14px]"
            >
              <label class="load-snapshot-label text-[13px] text-neutral-200">{{
                $t('list.snapshotDevice')
              }}</label>
              <div
                v-if="variantLoading"
                class="load-snapshot-loading py-2 text-[length:var(--takeover-fs-body)] text-neutral-300 load-snapshot-with-spinner flex items-center gap-2.5 before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
              >
                {{ $t('newInstall.loading') }}
              </div>
              <BrandVariantList
                v-else-if="variantOptions.length > 0"
                :options="sortedVariants"
                :selected-value="selectedVariant?.value"
                :aria-label="$t('list.snapshotDevice')"
                @select="selectVariant"
              />
              <div
                v-else
                class="load-snapshot-loading py-2 text-[length:var(--takeover-fs-body)] text-neutral-300"
              >
                {{ $t('newInstall.noOptions') }}
              </div>
              <div
                v-if="hardwareMismatch"
                class="load-snapshot-hw-warning rounded-md border border-solid border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[13px] text-[var(--warning)]"
              >
                {{
                  $t('list.snapshotHardwareMismatch', {
                    snapshotDevice: snapshotGpuLabel,
                    detectedDevice: detectedGpuLabel
                  })
                }}
              </div>
            </div>

            <div
              class="load-snapshot-divider my-1 h-px bg-[var(--brand-surface-border)]"
              aria-hidden="true"
            />

            <div
              class="load-snapshot-summary [&>*+*]:border-t [&>*+*]:border-solid [&>*+*]:border-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)] flex flex-col gap-0.5 rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-4 py-3.5"
            >
              <div
                v-for="entry in summaryEntries"
                :key="entry.label"
                class="load-snapshot-summary__row flex items-baseline justify-between gap-3 py-1.5 text-[length:var(--takeover-fs-body)]"
              >
                <span class="load-snapshot-summary__label flex-none text-neutral-300">{{
                  entry.label
                }}</span>
                <span
                  class="load-snapshot-summary__value max-w-[60%] truncate font-medium text-neutral-100"
                  >{{ entry.value }}</span
                >
              </div>
            </div>

            <div
              class="load-snapshot-disclosure group/disclosure border-t border-solid border-[var(--brand-surface-border)] pt-[var(--takeover-gap-md)]"
              :class="{ 'is-open': nodesExpanded }"
            >
              <Button
                variant="textonly"
                size="unset"
                type="button"
                class="load-snapshot-disclosure__summary static inline-flex items-center gap-1.5 rounded-lg border-none bg-transparent px-0 py-1 text-[length:var(--takeover-fs-body)] leading-[1.5] font-normal whitespace-normal text-neutral-200 appearance-auto transition-none hover:bg-transparent hover:text-neutral-100 hover:transition-[color] hover:duration-120 hover:ease-[ease] focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0"
                :aria-expanded="nodesExpanded"
                @click="nodesExpanded = !nodesExpanded"
              >
                <ChevronRight
                  :size="14"
                  class="load-snapshot-disclosure__chevron transition-transform duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:[transform:rotate(90deg)] motion-reduce:transition-none"
                  aria-hidden="true"
                />
                <span
                  >{{ $t('snapshots.customNodes') }} ({{
                    preview.newestSnapshot.customNodes.length
                  }})</span
                >
              </Button>
              <div
                class="load-snapshot-disclosure__wrap grid grid-rows-[0fr] transition-[grid-template-rows] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:grid-rows-[1fr] motion-reduce:transition-none"
              >
                <div
                  class="load-snapshot-disclosure__body min-h-0 overflow-hidden opacity-0 [transform:translateY(-4px)] transition-[opacity,transform] [transition-duration:220ms,260ms] [transition-timing-function:ease,cubic-bezier(0.22,1,0.36,1)] [transition-delay:60ms,40ms] group-[.is-open]/disclosure:mt-2.5 group-[.is-open]/disclosure:opacity-100 group-[.is-open]/disclosure:[transform:translateY(0)] motion-reduce:transition-none"
                >
                  <div
                    v-if="preview.newestSnapshot.customNodes.length > 0"
                    class="load-snapshot-recessed-list flex max-h-60 flex-col gap-[3px] overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
                  >
                    <div
                      v-for="node in preview.newestSnapshot.customNodes"
                      :key="node.id"
                      class="load-snapshot-node-row flex items-center gap-2 py-0.5 text-[13px]"
                    >
                      <span
                        class="load-snapshot-node-status size-[7px] shrink-0 rounded-[50%]"
                        :class="node.enabled ? 'bg-[var(--info)]' : 'bg-text-muted'"
                      />
                      <span
                        class="load-snapshot-node-name min-w-0 flex-1 truncate text-text select-text"
                        >{{ node.id }}</span
                      >
                      <span
                        class="load-snapshot-node-type shrink-0 rounded-[3px] border border-solid border-[var(--border)] px-[5px] py-px text-[11px] font-semibold text-text-muted uppercase"
                        >{{ node.type }}</span
                      >
                      <span
                        class="load-snapshot-node-version shrink-0 text-[13px] [font-family:monospace] text-text-muted select-text"
                        :title="formatNodeVersion(node)"
                      >
                        {{ formatNodeVersion(node) }}
                      </span>
                    </div>
                  </div>
                  <div v-else class="load-snapshot-empty text-[14px] text-text-muted">—</div>
                </div>
              </div>
            </div>

            <div
              class="load-snapshot-disclosure group/disclosure border-t border-solid border-[var(--brand-surface-border)] pt-[var(--takeover-gap-md)]"
              :class="{ 'is-open': pipExpanded }"
            >
              <Button
                variant="textonly"
                size="unset"
                type="button"
                class="load-snapshot-disclosure__summary static inline-flex items-center gap-1.5 rounded-lg border-none bg-transparent px-0 py-1 text-[length:var(--takeover-fs-body)] leading-[1.5] font-normal whitespace-normal text-neutral-200 appearance-auto transition-none hover:bg-transparent hover:text-neutral-100 hover:transition-[color] hover:duration-120 hover:ease-[ease] focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0"
                :aria-expanded="pipExpanded"
                @click="pipExpanded = !pipExpanded"
              >
                <ChevronRight
                  :size="14"
                  class="load-snapshot-disclosure__chevron transition-transform duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:[transform:rotate(90deg)] motion-reduce:transition-none"
                  aria-hidden="true"
                />
                <span
                  >{{ $t('snapshots.pipPackages') }} ({{
                    preview.newestSnapshot.pipPackageCount
                  }})</span
                >
              </Button>
              <div
                class="load-snapshot-disclosure__wrap grid grid-rows-[0fr] transition-[grid-template-rows] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:grid-rows-[1fr] motion-reduce:transition-none"
              >
                <div
                  class="load-snapshot-disclosure__body min-h-0 overflow-hidden opacity-0 [transform:translateY(-4px)] transition-[opacity,transform] [transition-duration:220ms,260ms] [transition-timing-function:ease,cubic-bezier(0.22,1,0.36,1)] [transition-delay:60ms,40ms] group-[.is-open]/disclosure:mt-2.5 group-[.is-open]/disclosure:opacity-100 group-[.is-open]/disclosure:[transform:translateY(0)] motion-reduce:transition-none"
                >
                  <div
                    v-if="preview.newestSnapshot.pipPackageCount > 0"
                    class="load-snapshot-recessed-list flex max-h-60 flex-col gap-[3px] overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
                  >
                    <div
                      v-for="(version, name) in preview.newestSnapshot.pipPackages"
                      :key="name"
                      class="load-snapshot-pip-row flex items-center justify-between py-0.5 text-[13px]"
                    >
                      <span
                        class="load-snapshot-pip-name min-w-0 flex-1 truncate text-text select-text"
                        >{{ name }}</span
                      >
                      <span
                        class="load-snapshot-pip-version ml-3 max-w-[50%] truncate [font-family:monospace] text-text-muted select-text"
                        :title="version"
                        >{{ version }}</span
                      >
                    </div>
                  </div>
                  <div v-else class="load-snapshot-empty text-[14px] text-text-muted">—</div>
                </div>
              </div>
            </div>

            <div
              class="load-snapshot-disclosure group/disclosure border-t border-solid border-[var(--brand-surface-border)] pt-[var(--takeover-gap-md)]"
              :class="{ 'is-open': timelineExpanded }"
            >
              <Button
                variant="textonly"
                size="unset"
                type="button"
                class="load-snapshot-disclosure__summary static inline-flex items-center gap-1.5 rounded-lg border-none bg-transparent px-0 py-1 text-[length:var(--takeover-fs-body)] leading-[1.5] font-normal whitespace-normal text-neutral-200 appearance-auto transition-none hover:bg-transparent hover:text-neutral-100 hover:transition-[color] hover:duration-120 hover:ease-[ease] focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0"
                :aria-expanded="timelineExpanded"
                @click="timelineExpanded = !timelineExpanded"
              >
                <ChevronRight
                  :size="14"
                  class="load-snapshot-disclosure__chevron transition-transform duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:[transform:rotate(90deg)] motion-reduce:transition-none"
                  aria-hidden="true"
                />
                <span>{{ $t('list.snapshotTimeline') }} ({{ preview.snapshotCount }})</span>
              </Button>
              <div
                class="load-snapshot-disclosure__wrap grid grid-rows-[0fr] transition-[grid-template-rows] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:grid-rows-[1fr] motion-reduce:transition-none"
              >
                <div
                  class="load-snapshot-disclosure__body min-h-0 overflow-hidden opacity-0 [transform:translateY(-4px)] transition-[opacity,transform] [transition-duration:220ms,260ms] [transition-timing-function:ease,cubic-bezier(0.22,1,0.36,1)] [transition-delay:60ms,40ms] group-[.is-open]/disclosure:mt-2.5 group-[.is-open]/disclosure:opacity-100 group-[.is-open]/disclosure:[transform:translateY(0)] motion-reduce:transition-none"
                >
                  <div
                    class="load-snapshot-timeline flex max-h-[200px] flex-col gap-1 overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--surface)] p-1.5"
                  >
                    <div
                      v-for="(snap, i) in preview.snapshots"
                      :key="snap.filename"
                      class="load-snapshot-timeline-item flex items-center gap-2 rounded-[5px] bg-[var(--bg)] px-2.5 py-1.5 text-[13px]"
                    >
                      <span
                        class="load-snapshot-trigger shrink-0 rounded-[3px] bg-[var(--surface)] px-1.5 py-px text-[11px] font-semibold tracking-[0.3px] uppercase"
                        :class="triggerTone(snap.trigger)"
                      >
                        {{ triggerCopy(snap.trigger) }}
                      </span>
                      <span
                        v-if="i === 0"
                        class="load-snapshot-current-tag shrink-0 text-[11px] font-semibold text-[var(--accent)]"
                        >{{ $t('snapshots.current') }}</span
                      >
                      <span class="load-snapshot-meta min-w-0 flex-1 truncate text-text-muted">
                        {{ snap.comfyuiVersion }} ·
                        {{ $t('snapshots.nodesCount', { count: snap.nodeCount }) }} ·
                        {{ $t('snapshots.packagesCount', { count: snap.pipPackageCount }) }}
                      </span>
                      <span class="load-snapshot-time shrink-0 text-[13px] text-text-muted">{{
                        formatDate(snap.createdAt)
                      }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div
          v-if="preview"
          class="load-snapshot-card__footer flex flex-none items-center justify-end gap-3 border-t border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-5 py-3.5"
        >
          <Button
            variant="textonly"
            size="unset"
            class="load-snapshot-ghost static inline-flex items-center justify-center gap-0 border border-solid px-4 py-2.5 text-[length:var(--takeover-fs-body)] leading-[1.5] font-medium whitespace-normal appearance-auto transition-[background,border-color,color] duration-120 ease-[ease] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 rounded-md border-transparent bg-transparent text-neutral-300 hover:bg-transparent enabled:hover:bg-[var(--brand-surface-bg)] enabled:hover:text-neutral-100 load-snapshot-back mr-auto"
            type="button"
            @click="handleClearPreview"
          >
            {{ $t('common.back') }}
          </Button>
          <Button
            variant="textonly"
            size="unset"
            class="load-snapshot-primary static inline-flex items-center justify-center gap-0 border border-solid px-4 py-2.5 text-[length:var(--takeover-fs-body)] leading-[1.5] font-medium whitespace-normal appearance-auto transition-[background,border-color,color] duration-120 ease-[ease] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 rounded-[var(--radius-control)] border-[var(--comfy-yellow)] bg-[var(--comfy-yellow)] text-neutral-900 hover:bg-[var(--comfy-yellow)] enabled:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] enabled:hover:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] focus-visible:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))] load-snapshot-create"
            :disabled="creating || !selectedVariant"
            @click="handleCreate"
          >
            {{ creating ? `${$t('newInstall.installing')}…` : $t('list.snapshotCreateInstall') }}
          </Button>
        </div>
      </div>
    </div>
    <template #footer-left>
      <TakeoverBack
        class="load-snapshot-back-to-dashboard absolute left-[clamp(1.25rem,2vw,2rem)] bottom-[clamp(1.25rem,2vw,2rem)] z-2"
        :label="$t('common.backToDashboard')"
        @back="emit('close')"
      />
    </template>
  </BrandTakeoverLayout>
</template>
