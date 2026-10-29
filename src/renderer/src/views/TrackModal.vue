<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { TID } from '../../../shared/testIds'
import { HardDrive } from 'lucide-vue-next'
import { useModal } from '../composables/useModal'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import TakeoverBack from '../components/TakeoverBack.vue'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { BaseSelect, type BaseSelectOption } from '../components/ui'

import type { ProbeResult } from '../types/ipc'
import { emitTelemetryAction, toCountBucket } from '../lib/telemetry'

const emit = defineEmits<{
  close: []
  'navigate-list': []
}>()

const brandInputClass =
  'flex w-full items-center gap-2.5 rounded-md border border-solid border-[var(--color-border)] bg-[var(--brand-surface-bg)] text-[length:var(--takeover-fs-body)] text-neutral-100 [font-family:inherit] transition-[border-color,background] duration-[120ms] ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] has-[input:focus-visible]:[box-shadow:0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)]'
const inputClass =
  '[:where(&)]:[all:unset] m-0 min-w-0 w-auto flex-auto cursor-text appearance-none border-none bg-transparent p-0 text-inherit [font:inherit] outline-none placeholder:text-neutral-400'
const browseClass =
  'static flex h-10 items-center justify-center rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-3.5 py-0 text-[13px] leading-[inherit] font-medium whitespace-normal text-neutral-100 appearance-auto touch-auto [&]:[appearance:button] transition-[background,border-color,color] duration-[120ms] ease-[ease] enabled:hover:border-[var(--brand-surface-border-hover)] enabled:hover:bg-[var(--brand-surface-bg-hover)] focus-visible:[box-shadow:none] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55'

const { t } = useI18n()
const modal = useModal()

const isOpen = ref(false)
const trackPath = ref('')
const trackName = ref('')
const suggestedName = ref('')
const probeResults = ref<ProbeResult[]>([])
const selectedProbe = ref<ProbeResult | null>(null)
const venvOverride = ref<string | null>(null)
const probing = ref(false)

const cardRef = ref<HTMLElement | null>(null)
let returnFocusTo: HTMLElement | null = null

const saveDisabled = computed(() => !trackPath.value || !selectedProbe.value)

/** Generation counter — bumped on every probe so stale async responses
 *  from an earlier path are discarded once the field changes again. */
let probeGeneration = 0

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

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus()
  returnFocusTo = null
})

function open(): void {
  // Bump so any probe still in flight from a previous session is
  // discarded by `probe()`'s generation check and can't populate the
  // freshly-reset state.
  probeGeneration++
  trackPath.value = ''
  trackName.value = ''
  probeResults.value = []
  selectedProbe.value = null
  venvOverride.value = null
  suggestedName.value = ''
  probing.value = false
  isOpen.value = true
  void window.api
    .getUniqueName(DEFAULT_INSTALL_NAME)
    .then((name) => {
      suggestedName.value = name
    })
    .catch(() => {})
}

async function handleBrowse(): Promise<void> {
  const dir = await window.api.browseFolder(trackPath.value || undefined)
  if (dir) {
    trackPath.value = dir
    await probe(dir)
  }
}

function handleOpenTrackPath(): void {
  if (trackPath.value) void window.api.openPath(trackPath.value)
}

async function probe(dirPath: string): Promise<void> {
  const generation = ++probeGeneration
  probing.value = true
  selectedProbe.value = null
  probeResults.value = []

  let results: ProbeResult[]
  try {
    results = await window.api.probeInstallation(dirPath)
  } finally {
    // Discard if the field moved on while this probe was in flight.
    if (generation === probeGeneration) probing.value = false
  }

  // Stale response from an earlier path — drop it.
  if (generation !== probeGeneration) return
  probeResults.value = results
  if (results.length > 0) {
    selectedProbe.value = results[0] ?? null
  }
}

function onProbeSelect(value: string): void {
  const idx = parseInt(value, 10)
  selectedProbe.value = probeResults.value[idx] ?? null
  venvOverride.value = null
}

const probeOptions = computed<BaseSelectOption[]>(() =>
  probeResults.value.map((r, i) => ({ value: String(i), label: r.sourceLabel }))
)

const selectedProbeValue = computed(() => {
  if (!selectedProbe.value) return ''
  const idx = probeResults.value.indexOf(selectedProbe.value)
  return idx >= 0 ? String(idx) : ''
})

const selectPlaceholder = computed(() => {
  if (probing.value) return t('track.detecting')
  if (probeResults.value.length > 0) return ''
  return trackPath.value ? t('track.noDetected') : t('track.browseDirFirst')
})

interface DetailFieldEntry {
  label: string
  value: string
}

const detailFields = computed<DetailFieldEntry[]>(() => {
  if (!selectedProbe.value) return []
  const p = selectedProbe.value
  const fields: DetailFieldEntry[] = []
  if (p.version && p.version !== 'unknown') {
    fields.push({ label: t('track.version'), value: p.version })
  }
  if (p.repo) {
    fields.push({ label: t('track.repository'), value: p.repo })
  }
  if (p.branch) {
    fields.push({ label: t('track.branch'), value: p.branch })
  }
  return fields
})

const showVenvField = computed(() => {
  if (!selectedProbe.value) return false
  return selectedProbe.value.sourceId === 'git'
})

const effectiveVenvPath = computed(() => {
  if (venvOverride.value !== null) return venvOverride.value
  return (selectedProbe.value?.venvPath as string | undefined) || ''
})

const effectiveVenvName = computed(() => {
  const p = effectiveVenvPath.value
  if (!p) return ''
  const sep = p.includes('\\') ? '\\' : '/'
  return p.split(sep).pop() || ''
})

async function handleBrowseVenv(): Promise<void> {
  const defaultPath = effectiveVenvPath.value || trackPath.value || undefined
  const dir = await window.api.browseFolder(defaultPath)
  if (dir) {
    venvOverride.value = dir
  }
}

async function handleSave(): Promise<void> {
  if (!selectedProbe.value) return

  const name = trackName.value.trim() || DEFAULT_INSTALL_NAME

  const rawProbe = JSON.parse(JSON.stringify(toRaw(selectedProbe.value))) as Record<string, unknown>
  if (venvOverride.value !== null) {
    rawProbe.venvPath = venvOverride.value
  }
  // A probe may resolve the real install root when the user pointed at a nested
  // folder (e.g. the `ComfyUI/` dir of a standalone/portable install). Prefer
  // that over the raw picked path so runtime paths resolve correctly.
  const installPath = (rawProbe.installPath as string | undefined) || trackPath.value
  const data: Record<string, unknown> = {
    name,
    ...rawProbe,
    installPath
  }

  const result = await window.api.trackInstallation(data)
  if (!result.ok) {
    await modal.alert({
      title: t('track.cannotTrack'),
      message: result.message || ''
    })
    return
  }
  emitTelemetryAction('comfy.desktop.track_existing.saved', {
    detected_source_label: selectedProbe.value.sourceLabel || 'unknown',
    probe_count_bucket: toCountBucket(probeResults.value.length),
    custom_name_used: trackName.value.trim().length > 0
  })
  isOpen.value = false
  emit('close')
  emit('navigate-list')
}

defineExpose({ open })
</script>

<template>
  <BrandTakeoverLayout v-if="isOpen">
    <div
      class="track-shell mx-auto flex h-full max-h-full min-h-0 w-full max-w-[640px] flex-col items-center justify-center self-stretch py-[clamp(1.5rem,4vh,3rem)] text-center"
      data-testid="track-modal"
    >
      <h1
        class="track-title m-0 text-[length:var(--takeover-fs-title)] leading-[1.15] font-extrabold text-white [font-family:var(--font-display)] opacity-85 text-center"
      >
        {{ $t('track.grandTitle') }}
      </h1>
      <p
        class="track-lead mt-[var(--takeover-gap-md)] mr-0 mb-[var(--takeover-gap-lg)] ml-0 text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-200 [font-family:var(--font-sans)] text-center"
      >
        {{ $t('track.grandSubtitle') }}
      </p>
      <div
        ref="cardRef"
        class="track-card flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] text-left [backdrop-filter:blur(var(--brand-surface-blur))]"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('track.grandTitle')"
        tabindex="-1"
      >
        <div
          class="track-card-body flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div class="track-field flex flex-col gap-2 [&_.ui-select-trigger]:text-[14px]">
            <label class="track-label text-[13px] text-neutral-200">{{
              $t('track.installDir')
            }}</label>
            <div class="track-path-row flex items-stretch gap-2">
              <div :class="[brandInputClass, 'track-path-input h-10 min-w-0 flex-auto px-3 py-0']">
                <HardDrive :size="14" aria-hidden="true" />
                <Button
                  v-if="trackPath"
                  variant="textonly"
                  size="unset"
                  type="button"
                  class="track-path-open static block min-w-0 flex-[0_1_auto] cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 text-left text-ellipsis whitespace-nowrap text-inherit [font:inherit] appearance-auto touch-auto [&]:[appearance:button] transition-none hover:bg-transparent hover:text-inherit hover:underline focus-visible:bg-transparent focus-visible:text-inherit focus-visible:underline focus-visible:[box-shadow:none] focus-visible:outline-none"
                  :title="$t('actions.openDirectory', 'Open Directory')"
                  :aria-label="`${$t('actions.openDirectory', 'Open Directory')}: ${trackPath}`"
                  @click="handleOpenTrackPath"
                >
                  {{ trackPath }}
                </Button>
                <span
                  v-else
                  class="track-path-placeholder min-w-0 flex-[0_1_auto] cursor-default overflow-hidden border-none bg-transparent p-0 text-left text-ellipsis whitespace-nowrap text-neutral-400 [font:inherit]"
                  >{{ $t('track.selectDir') }}</span
                >
              </div>
              <Button
                variant="textonly"
                size="unset"
                :class="browseClass"
                :data-testid="TID.trackBrowse"
                type="button"
                @click="handleBrowse"
              >
                {{ $t('common.browse') }}
              </Button>
            </div>
          </div>

          <div class="track-field flex flex-col gap-2 [&_.ui-select-trigger]:text-[14px]">
            <label class="track-label text-[13px] text-neutral-200" for="track-name">{{
              $t('common.name')
            }}</label>
            <div :class="[brandInputClass, 'px-3.5 py-2.5']">
              <input
                id="track-name"
                v-model="trackName"
                type="text"
                :class="inputClass"
                :placeholder="suggestedName || $t('common.namePlaceholder')"
              />
            </div>
          </div>

          <div class="track-field flex flex-col gap-2 [&_.ui-select-trigger]:text-[14px]">
            <label class="track-label text-[13px] text-neutral-200">{{
              $t('track.detectedType')
            }}</label>
            <BaseSelect
              :model-value="selectedProbeValue"
              :options="probeOptions"
              :placeholder="selectPlaceholder"
              :disabled="probing || probeResults.length <= 1"
              :aria-label="$t('track.detectedType')"
              @update:model-value="onProbeSelect"
            />
          </div>

          <div
            v-if="detailFields.length > 0"
            class="track-summary flex flex-col gap-0.5 rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-4 py-3.5"
          >
            <div
              v-for="field in detailFields"
              :key="field.label"
              class="track-summary-row flex items-baseline justify-between gap-3 py-1.5 text-[length:var(--takeover-fs-body)] [&+&]:border-t [&+&]:border-solid [&+&]:border-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)]"
            >
              <span class="track-summary-label flex-none text-neutral-300">{{ field.label }}</span>
              <span class="track-summary-value max-w-[60%] truncate font-medium text-neutral-100">{{
                field.value
              }}</span>
            </div>
          </div>

          <div
            v-if="showVenvField"
            class="track-field flex flex-col gap-2 [&_.ui-select-trigger]:text-[14px]"
          >
            <label class="track-label text-[13px] text-neutral-200">{{ $t('git.venv') }}</label>
            <div class="track-path-row flex items-stretch gap-2">
              <div :class="[brandInputClass, 'track-path-input h-10 min-w-0 flex-auto px-3 py-0']">
                <HardDrive :size="14" aria-hidden="true" />
                <input
                  type="text"
                  :class="inputClass"
                  :value="effectiveVenvName || $t('git.venvNotFound')"
                  disabled
                />
              </div>
              <Button
                variant="textonly"
                size="unset"
                :class="browseClass"
                type="button"
                @click="handleBrowseVenv"
              >
                {{ $t('common.browse') }}
              </Button>
            </div>
          </div>
        </div>

        <div
          class="track-card-footer flex flex-none items-center justify-end gap-3 border-t border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-5 py-3.5"
        >
          <Button
            variant="inverted"
            size="unset"
            class="track-save static inline-flex min-w-[120px] items-center justify-center rounded-lg border border-solid border-comfy-yellow bg-comfy-yellow px-4 py-2.5 text-[length:var(--takeover-fs-body)] leading-[inherit] font-medium whitespace-normal text-neutral-900 appearance-auto touch-auto [&]:[appearance:button] transition-[background,border-color,color] duration-[120ms] ease-[ease] enabled:hover:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] enabled:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] focus-visible:[box-shadow:none] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))] focus-visible:outline-offset-2 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-comfy-yellow"
            :disabled="saveDisabled"
            @click="handleSave"
          >
            {{ $t('track.trackInstallation') }}
          </Button>
        </div>
      </div>
    </div>
    <template #footer-left>
      <TakeoverBack
        class="track-back-to-dashboard absolute bottom-[clamp(1.25rem,2vw,2rem)] left-[clamp(1.25rem,2vw,2rem)] z-2"
        :label="$t('common.backToDashboard')"
        @back="emit('close')"
      />
    </template>
  </BrandTakeoverLayout>
</template>
