<script setup lang="ts">
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'
import { ref, computed, toRaw, type Component } from 'vue'
import { Box, GitBranch, GitFork, Package, ScanSearch, Tag } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { TID } from '../../../shared/testIds'
import { useModal } from '../composables/useModal'
import SetupModal from '../components/SetupModal.vue'
import SetupFormRow from '../components/SetupFormRow.vue'
import InstallLocationRow from '../components/InstallLocationRow.vue'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { BaseSelect, type BaseSelectOption } from '../components/ui'

import type { ProbeResult } from '../types/ipc'
import { emitTelemetryAction, toCountBucket } from '../lib/telemetry'

const emit = defineEmits<{
  close: []
  'navigate-list': []
}>()

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

const saveDisabled = computed(() => !trackPath.value || !selectedProbe.value)

let probeGeneration = 0

function open(): void {
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
    if (generation === probeGeneration) probing.value = false
  }

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
  icon: Component
  label: string
  value: string
}

const detailFields = computed<DetailFieldEntry[]>(() => {
  if (!selectedProbe.value) return []
  const p = selectedProbe.value
  const fields: DetailFieldEntry[] = []
  if (p.version && p.version !== 'unknown') {
    fields.push({ icon: Package, label: t('track.version'), value: p.version })
  }
  if (p.repo) {
    fields.push({ icon: GitFork, label: t('track.repository'), value: p.repo })
  }
  if (p.branch) {
    fields.push({ icon: GitBranch, label: t('track.branch'), value: p.branch })
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

function handleOpenVenvPath(): void {
  if (effectiveVenvPath.value) void window.api.openPath(effectiveVenvPath.value)
}

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
  <SetupModal
    v-if="isOpen"
    :dialog-label="$t('track.grandTitle')"
    :title="$t('track.grandTitle')"
    :lead="$t('track.grandSubtitle')"
    dismiss-on-escape
    data-testid="track-modal"
    @close="emit('close')"
  >
    <div class="track-form mt-4 flex flex-col">
      <InstallLocationRow
        class="track-location"
        :label="$t('track.installDir')"
        :path="trackPath"
        :placeholder="$t('track.selectDir')"
        :browse-test-id="TID.trackBrowse"
        @browse="handleBrowse"
        @open="handleOpenTrackPath"
      />

      <SetupFormRow :label="$t('common.name')" :icon="Tag" label-for="track-name">
        <InputGroup class="config-input">
          <InputGroupInput
            id="track-name"
            v-model="trackName"
            class="text-[13px] text-neutral-100"
            data-initial-focus
            type="text"
            :placeholder="suggestedName || $t('common.namePlaceholder')"
          />
        </InputGroup>
      </SetupFormRow>

      <SetupFormRow :label="$t('track.detectedType')" :icon="ScanSearch">
        <BaseSelect
          class="text-[13px]"
          :model-value="selectedProbeValue"
          :options="probeOptions"
          :placeholder="selectPlaceholder"
          :disabled="probing || probeResults.length <= 1"
          :aria-label="$t('track.detectedType')"
          @update:model-value="onProbeSelect"
        />
      </SetupFormRow>

      <SetupFormRow
        v-for="field in detailFields"
        :key="field.label"
        class="track-summary-row"
        :label="field.label"
        :icon="field.icon"
        control-height="line"
      >
        <span class="track-summary-value truncate text-[13px] leading-5 text-neutral-100">{{
          field.value
        }}</span>
      </SetupFormRow>

      <InstallLocationRow
        v-if="showVenvField"
        class="track-venv"
        data-testid="track-venv-field"
        :label="$t('git.venv')"
        :icon="Box"
        :path="effectiveVenvPath"
        :placeholder="$t('git.venvNotFound')"
        @browse="handleBrowseVenv"
        @open="handleOpenVenvPath"
      />
    </div>

    <template #footer>
      <span class="flex-1" />
      <Button
        type="button"
        size="lg"
        variant="inverted"
        class="track-save h-9 min-w-[104px] rounded-[10px]"
        :disabled="saveDisabled"
        @click="handleSave"
      >
        {{ $t('track.trackInstallation') }}
      </Button>
    </template>
  </SetupModal>
</template>
