<script setup lang="ts">
import { ref, computed, onMounted, toRaw, watch, type Component } from 'vue'
import { Box, GitBranch, GitFork, Package, ScanSearch, Tag } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { TID } from '../../../shared/testIds'
import { useModal } from '../composables/useModal'
import SetupFormRow from './SetupFormRow.vue'
import InstallLocationRow from './InstallLocationRow.vue'
import InstallNameInput from './InstallNameInput.vue'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { BaseSelect, type BaseSelectOption } from './ui'

import type { ProbeResult } from '../types/ipc'
import { emitTelemetryAction, toCountBucket } from '../lib/telemetry'

const emit = defineEmits<{ saved: [] }>()

const name = defineModel<string>('name', { default: '' })

const { t } = useI18n()
const modal = useModal()

const trackPath = ref('')
const suggestedName = ref('')
const probeResults = ref<ProbeResult[]>([])
const selectedProbe = ref<ProbeResult | null>(null)
const venvOverride = ref<string | null>(null)
const probing = ref(false)
const saving = ref(false)
const nameTaken = ref(false)

const nameError = computed(() => {
  if (name.value.length > 0 && name.value.trim().length === 0) return t('newInstall.nameWhitespace')
  if (nameTaken.value) return t('errors.duplicateName', { name: name.value.trim() })
  return ''
})

const canSave = computed(
  () => !!trackPath.value && !!selectedProbe.value && !saving.value && !nameError.value
)

let nameCheck = 0
watch(
  () => name.value.trim(),
  (typed) => {
    const check = ++nameCheck
    nameTaken.value = false
    if (!typed) return
    void window.api
      .getUniqueName(typed)
      .then((unique) => {
        if (check === nameCheck) nameTaken.value = unique !== typed
      })
      .catch(() => {})
  },
  { immediate: true }
)

let probeGeneration = 0

onMounted(() => {
  void window.api
    .getUniqueName(DEFAULT_INSTALL_NAME)
    .then((unique) => {
      suggestedName.value = unique
    })
    .catch(() => {})
})

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
  venvOverride.value = null

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

async function save(): Promise<void> {
  const probed = selectedProbe.value
  if (!probed || saving.value) return
  saving.value = true
  try {
    await trackProbedInstall(probed)
  } finally {
    saving.value = false
  }
}

async function trackProbedInstall(probed: ProbeResult): Promise<void> {
  const typedName = name.value.trim()
  const probeCount = probeResults.value.length
  const rawProbe = JSON.parse(JSON.stringify(toRaw(probed))) as Record<string, unknown>
  if (venvOverride.value !== null) {
    rawProbe.venvPath = venvOverride.value
  }
  const installPath = (rawProbe.installPath as string | undefined) || trackPath.value
  const finalName = await window.api.getUniqueName(typedName || DEFAULT_INSTALL_NAME)
  if (typedName && finalName !== typedName) {
    if (name.value.trim() === typedName) {
      nameCheck++
      nameTaken.value = true
    }
    return
  }

  const data: Record<string, unknown> = {
    name: finalName,
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
    detected_source_label: probed.sourceLabel || 'unknown',
    probe_count_bucket: toCountBucket(probeCount),
    custom_name_used: typedName.length > 0
  })
  emit('saved')
}

defineExpose({ save, canSave })
</script>

<template>
  <div class="track-form flex flex-col">
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
      <InstallNameInput
        v-model="name"
        input-id="track-name"
        initial-focus
        :placeholder="suggestedName || $t('common.namePlaceholder')"
        :error="nameError"
      />
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
</template>
