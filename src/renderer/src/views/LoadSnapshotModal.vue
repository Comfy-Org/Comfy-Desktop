<script setup lang="ts">
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'
import { ref, computed, watch, toRaw, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ChevronRight, Upload } from 'lucide-vue-next'
import { useModal } from '../composables/useModal'

import type { SnapshotFilePreview, FieldOption, GPUInfo, ShowProgressOpts } from '../types/ipc'
import { getVariantGpuLabel, sortedCardOptions, findBestVariant } from '../lib/variants'
import { triggerLabel as _triggerLabel, formatDate, formatNodeVersion } from '../lib/snapshots'
import SetupModal from '../components/SetupModal.vue'
import SetupFormRow from '../components/SetupFormRow.vue'
import InstallLocationRow from '../components/InstallLocationRow.vue'
import SetupOptionCards from '../components/SetupOptionCards.vue'
import { toHardwareCards } from '../lib/setupOptionCards'
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
const replacingSnapshot = ref(false)

const cardRef = ref<HTMLElement | null>(null)

const sortedVariants = computed(() => sortedCardOptions(variantOptions.value))
const variantCards = computed(() => toHardwareCards(sortedVariants.value))

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
    label: opt.label,
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

    const options = await window.api.getFieldOptions(
      'standalone',
      'release',
      {},
      { includeLatestStable: true }
    )
    if (gen !== optionsGeneration) return
    releaseOptions.value = options

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
  if (creating.value || replacingSnapshot.value) return
  replacingSnapshot.value = true
  try {
    await browseSnapshotFile()
  } finally {
    replacingSnapshot.value = false
  }
}

async function browseSnapshotFile(): Promise<void> {
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

function revealSnapshotFile(): void {
  if (preview.value) window.api.revealPath(preview.value.filePath)
}

function selectVariant(option: FieldOption): void {
  selectedVariant.value = option
  emitTelemetryAction('comfy.desktop.install.variant.selected', {
    variant_bucket: toVariantBucket((option.data?.variantId as string | undefined) || option.value),
    recommended: !!option.recommended,
    flow: 'snapshot'
  })
}

function selectVariantByValue(value: string): void {
  const option = variantOptions.value.find((candidate) => candidate.value === value)
  if (option) selectVariant(option)
}

async function handleCreate(): Promise<void> {
  if (!preview.value || creating.value || replacingSnapshot.value) return
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

onMounted(() => {
  document.addEventListener('dragover', preventNav)
  document.addEventListener('drop', preventNav)
})
onUnmounted(() => {
  document.removeEventListener('dragover', preventNav)
  document.removeEventListener('drop', preventNav)
})
defineExpose({ open })
</script>

<template>
  <SetupModal
    v-if="isOpen"
    :dialog-label="$t('loadSnapshot.grandTitle')"
    :title="$t('loadSnapshot.grandTitle')"
    :lead="$t('loadSnapshot.grandSubtitle')"
    dismiss-on-escape
    data-testid="load-snapshot-modal"
    @close="emit('close')"
  >
    <div
      ref="cardRef"
      class="load-snapshot-card mt-4 flex flex-col"
      @dragover="!preview && handleDragOver($event)"
      @dragleave="!preview && handleDragLeave($event)"
      @drop="!preview && handleDrop($event)"
    >
      <div
        v-if="!preview"
        class="load-snapshot-dropzone my-3 flex min-h-[220px] flex-col items-center justify-center gap-2.5 rounded-[14px] border-2 border-dashed p-8 text-neutral-200 transition-[border-color,background] duration-160 ease-[ease] motion-reduce:transition-none"
        :class="[
          dragging
            ? 'load-snapshot-dropzone--active border-white/40 bg-white/6'
            : 'border-white/12 bg-white/3',
          { 'load-snapshot-dropzone--loading pointer-events-none opacity-60': loading }
        ]"
      >
        <div
          v-if="loading"
          class="load-snapshot-dropzone__loading text-[13px] text-text-muted flex items-center gap-2.5 before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-white/15 before:border-t-neutral-100 before:[animation-duration:0.6s] before:content-['']"
        >
          {{ $t('newInstall.loading') }}
        </div>
        <template v-else>
          <Upload
            :size="28"
            class="load-snapshot-dropzone__icon mb-1 text-text-muted"
            aria-hidden="true"
          />
          <div class="load-snapshot-dropzone__hint text-center text-[13px] text-neutral-100">
            {{ $t('list.snapshotDropHint') }}
          </div>
          <div class="load-snapshot-dropzone__or text-[12px] text-text-muted">
            {{ $t('common.or') }}
          </div>
          <Button
            size="md"
            variant="secondary"
            type="button"
            class="load-snapshot-tertiary px-3"
            @click="handleBrowse"
          >
            {{ $t('common.browse') }}
          </Button>
        </template>
      </div>

      <template v-else>
        <InstallLocationRow
          class="load-snapshot-file"
          :label="$t('loadSnapshot.file')"
          :path="preview.filePath"
          @browse="handleBrowse"
          @open="revealSnapshotFile"
        />

        <SetupFormRow :label="$t('common.name')" label-for="ls-name">
          <InputGroup class="config-input">
            <InputGroupInput
              id="ls-name"
              v-model="installName"
              data-initial-focus
              class="load-snapshot-input"
              type="text"
              :placeholder="$t('common.namePlaceholder')"
            />
          </InputGroup>
          <p
            v-if="nameHasInvalidChars"
            class="load-snapshot-hint load-snapshot-hint--warn m-0 mt-1 text-[12px] leading-4 text-[var(--warning)]"
          >
            {{ $t('list.snapshotNameHint') }}
          </p>
        </SetupFormRow>

        <SetupFormRow :label="$t('list.snapshotRelease')">
          <BaseSelect
            :model-value="selectedRelease?.value ?? ''"
            :options="releaseSelectOptions"
            :placeholder="releasePlaceholder"
            :disabled="releaseLoading || releaseOptions.length === 0"
            :aria-label="$t('list.snapshotRelease')"
            @update:model-value="onReleaseChange"
          />
          <p
            v-if="preview.newestSnapshot.comfyui.releaseTag"
            class="load-snapshot-hint m-0 mt-1 text-[12px] leading-4 text-text-muted"
          >
            {{
              $t('list.snapshotOriginalRelease', {
                tag: preview.newestSnapshot.comfyui.releaseTag
              })
            }}
          </p>
        </SetupFormRow>

        <SetupFormRow :label="$t('list.snapshotDevice')" control-height="cards">
          <div
            v-if="variantLoading"
            class="load-snapshot-loading py-2 text-[13px] text-text-muted flex items-center gap-2.5 before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-white/15 before:border-t-neutral-100 before:[animation-duration:0.6s] before:content-['']"
          >
            {{ $t('newInstall.loading') }}
          </div>
          <SetupOptionCards
            v-else-if="variantOptions.length > 0"
            :options="variantCards"
            :selected-value="selectedVariant?.value"
            :aria-label="$t('list.snapshotDevice')"
            @select="selectVariantByValue"
          />
          <div v-else class="load-snapshot-loading py-2 text-[13px] text-text-muted">
            {{ $t('newInstall.noOptions') }}
          </div>
          <p
            v-if="hardwareMismatch"
            class="load-snapshot-hw-warning m-0 mt-2 text-[12px] leading-4 text-[var(--warning)]"
          >
            {{
              $t('list.snapshotHardwareMismatch', {
                snapshotDevice: snapshotGpuLabel,
                detectedDevice: detectedGpuLabel
              })
            }}
          </p>
        </SetupFormRow>

        <SetupFormRow :label="$t('loadSnapshot.contents')" control-height="cards">
          <div class="load-snapshot-contents flex flex-col gap-3 rounded-[14px] bg-white/4 p-4">
            <dl class="load-snapshot-summary m-0 grid grid-cols-2 gap-x-6 gap-y-3">
              <div
                v-for="entry in summaryEntries"
                :key="entry.label"
                class="load-snapshot-summary__row flex min-w-0 flex-col"
              >
                <dt class="config-label text-[12px] leading-4 text-text-muted">
                  {{ entry.label }}
                </dt>
                <dd
                  class="load-snapshot-summary__value m-0 truncate text-[13px] leading-5 text-neutral-100"
                >
                  {{ entry.value }}
                </dd>
              </div>
            </dl>

            <div class="load-snapshot-details flex flex-col gap-1">
              <div
                class="load-snapshot-disclosure group/disclosure"
                :class="{ 'is-open': nodesExpanded }"
              >
                <Button
                  variant="textonly"
                  size="unset"
                  type="button"
                  class="load-snapshot-disclosure__summary static inline-flex items-center gap-1.5 rounded-md px-0 py-1 text-[13px] leading-5 font-medium text-text-muted hover:bg-transparent hover:text-neutral-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0"
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
                  :inert="!nodesExpanded"
                  :aria-hidden="!nodesExpanded"
                >
                  <div
                    class="load-snapshot-disclosure__body min-h-0 overflow-hidden opacity-0 [transform:translateY(-4px)] transition-[opacity,transform] [transition-duration:220ms,260ms] [transition-timing-function:ease,cubic-bezier(0.22,1,0.36,1)] [transition-delay:60ms,40ms] group-[.is-open]/disclosure:mt-2 group-[.is-open]/disclosure:opacity-100 group-[.is-open]/disclosure:[transform:translateY(0)] motion-reduce:transition-none"
                  >
                    <div
                      v-if="preview.newestSnapshot.customNodes.length > 0"
                      class="load-snapshot-recessed-list flex max-h-60 flex-col gap-[3px] overflow-y-auto rounded-[10px] bg-black/15 p-1.5"
                    >
                      <div
                        v-for="node in preview.newestSnapshot.customNodes"
                        :key="node.id"
                        class="load-snapshot-node-row flex items-center gap-2 px-1.5 py-0.5 text-[13px]"
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
                          class="load-snapshot-node-type shrink-0 rounded-[4px] bg-white/8 px-[5px] py-px text-[11px] font-semibold text-text-muted uppercase"
                          >{{ node.type }}</span
                        >
                        <span
                          class="load-snapshot-node-version shrink-0 text-[13px] [font-family:monospace] text-text-muted select-text"
                          :title="formatNodeVersion(node)"
                          >{{ formatNodeVersion(node) }}</span
                        >
                      </div>
                    </div>
                    <div v-else class="load-snapshot-empty text-[13px] text-text-muted">—</div>
                  </div>
                </div>
              </div>
              <div
                class="load-snapshot-disclosure group/disclosure"
                :class="{ 'is-open': pipExpanded }"
              >
                <Button
                  variant="textonly"
                  size="unset"
                  type="button"
                  class="load-snapshot-disclosure__summary static inline-flex items-center gap-1.5 rounded-md px-0 py-1 text-[13px] leading-5 font-medium text-text-muted hover:bg-transparent hover:text-neutral-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0"
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
                  :inert="!pipExpanded"
                  :aria-hidden="!pipExpanded"
                >
                  <div
                    class="load-snapshot-disclosure__body min-h-0 overflow-hidden opacity-0 [transform:translateY(-4px)] transition-[opacity,transform] [transition-duration:220ms,260ms] [transition-timing-function:ease,cubic-bezier(0.22,1,0.36,1)] [transition-delay:60ms,40ms] group-[.is-open]/disclosure:mt-2 group-[.is-open]/disclosure:opacity-100 group-[.is-open]/disclosure:[transform:translateY(0)] motion-reduce:transition-none"
                  >
                    <div
                      v-if="preview.newestSnapshot.pipPackageCount > 0"
                      class="load-snapshot-recessed-list flex max-h-60 flex-col gap-[3px] overflow-y-auto rounded-[10px] bg-black/15 p-1.5"
                    >
                      <div
                        v-for="(version, name) in preview.newestSnapshot.pipPackages"
                        :key="name"
                        class="load-snapshot-pip-row flex items-center justify-between px-1.5 py-0.5 text-[13px]"
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
                    <div v-else class="load-snapshot-empty text-[13px] text-text-muted">—</div>
                  </div>
                </div>
              </div>
              <div
                class="load-snapshot-disclosure group/disclosure"
                :class="{ 'is-open': timelineExpanded }"
              >
                <Button
                  variant="textonly"
                  size="unset"
                  type="button"
                  class="load-snapshot-disclosure__summary static inline-flex items-center gap-1.5 rounded-md px-0 py-1 text-[13px] leading-5 font-medium text-text-muted hover:bg-transparent hover:text-neutral-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0"
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
                  :inert="!timelineExpanded"
                  :aria-hidden="!timelineExpanded"
                >
                  <div
                    class="load-snapshot-disclosure__body min-h-0 overflow-hidden opacity-0 [transform:translateY(-4px)] transition-[opacity,transform] [transition-duration:220ms,260ms] [transition-timing-function:ease,cubic-bezier(0.22,1,0.36,1)] [transition-delay:60ms,40ms] group-[.is-open]/disclosure:mt-2 group-[.is-open]/disclosure:opacity-100 group-[.is-open]/disclosure:[transform:translateY(0)] motion-reduce:transition-none"
                  >
                    <div
                      class="load-snapshot-timeline flex max-h-[200px] flex-col gap-1 overflow-y-auto rounded-[10px] bg-black/15 p-1.5"
                    >
                      <div
                        v-for="(snap, i) in preview.snapshots"
                        :key="snap.filename"
                        class="load-snapshot-timeline-item flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[13px]"
                      >
                        <span
                          class="load-snapshot-trigger shrink-0 rounded-[4px] bg-white/8 px-1.5 py-px text-[11px] font-semibold tracking-[0.3px] uppercase"
                          :class="triggerTone(snap.trigger)"
                        >
                          {{ triggerCopy(snap.trigger) }}
                        </span>
                        <span
                          v-if="i === 0"
                          class="load-snapshot-current-tag shrink-0 text-[11px] font-semibold text-neutral-100"
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
            </div>
          </div>
        </SetupFormRow>
      </template>
    </div>

    <template v-if="preview" #footer>
      <span class="flex-1" />
      <Button
        type="button"
        size="lg"
        variant="inverted"
        class="load-snapshot-create h-9 min-w-[104px] rounded-[10px]"
        :disabled="creating || replacingSnapshot || !selectedVariant"
        @click="handleCreate"
      >
        {{ creating ? `${$t('newInstall.installing')}…` : $t('list.snapshotCreateInstall') }}
      </Button>
    </template>
  </SetupModal>
</template>
