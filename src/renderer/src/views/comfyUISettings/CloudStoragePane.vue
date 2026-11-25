<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import GlobalSettingsMicroSection from '../../comfyTitlePopup/globalSettings/GlobalSettingsMicroSection.vue'
import BaseSelect, { type BaseSelectOption } from '../../components/ui/BaseSelect.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import BooleanToggle from './BooleanToggle.vue'
import StorageDirRow from './StorageDirRow.vue'
import type { StorageSnapshot } from './StoragePane.vue'
import type { DetailField, DetailSection } from '../../types/ipc'

interface Props {
  snapshot: StorageSnapshot
  sections: DetailSection[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update-field': [field: DetailField, value: unknown]
}>()

const { t } = useI18n()

const fields = computed<DetailField[]>(() => props.sections.flatMap((s) => s.fields ?? []))

function findField(id: string): DetailField | undefined {
  return fields.value.find((f) => f.id === id)
}

const browserPartitionField = computed(() => findField('browserPartition'))
const autoDownloadField = computed(() => findField('autoDownloadOutputs'))
const useSharedOutputDirField = computed(() => findField('useSharedOutputDir'))
const outputDirField = computed(() => findField('outputDir'))

const autoDownloadEnabled = computed(() => autoDownloadField.value?.value !== false)
const sharedOutputEnabled = computed(() => useSharedOutputDirField.value?.value !== false)

const browserPartitionOptions = computed<BaseSelectOption[]>(() =>
  (browserPartitionField.value?.options ?? []).map((opt) => ({
    value: opt.value,
    label: opt.label
  }))
)
const browserPartitionValue = computed(() => {
  const v = browserPartitionField.value?.value
  return typeof v === 'string' ? v : ''
})

function asPath(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const sharedOutputPath = computed(() =>
  asPath(
    (props.snapshot.sharedDirectoriesFields as unknown as DetailField[]).find(
      (f) => f.id === 'outputDir'
    )?.value
  )
)

const outputPath = computed(() =>
  sharedOutputEnabled.value ? sharedOutputPath.value : asPath(outputDirField.value?.value)
)

const headerToggleClass =
  'storage-header-toggle flex min-w-0 cursor-pointer items-center gap-1.5 [&>span]:truncate [&>.bt-switch]:ml-1.5'
const cardClass = 'storage-dir-card flex flex-col gap-3 rounded-[14px] bg-card px-1.5 py-[10px]'

function updateField(field: DetailField | undefined, value: unknown): void {
  if (field) emit('update-field', field, value)
}

async function handleBrowseOutputDir(): Promise<void> {
  const field = outputDirField.value
  if (!field) return
  const picked = await window.api.browseFolder(outputPath.value || undefined)
  if (picked) emit('update-field', field, picked)
}

function handleOpenOutputDir(): void {
  if (outputPath.value) void window.api.openPath(outputPath.value)
}

function handleManageSharedDirs(): void {
  window.api.openGlobalSettings('storage')
}
</script>

<template>
  <div class="cloud-storage-pane flex max-w-3xl flex-col gap-2.5" data-testid="cloud-storage-pane">
    <GlobalSettingsMicroSection v-if="autoDownloadField" :title="t('settings.outputStorage')">
      <template #actions>
        <label
          v-if="autoDownloadEnabled && useSharedOutputDirField"
          :class="headerToggleClass"
          data-testid="cloud-storage-shared-output"
        >
          <span>{{ t('comfyUISettings.useSharedOutput') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedOutputDir')" />
          <BooleanToggle
            :field="useSharedOutputDirField"
            @update="(v) => updateField(useSharedOutputDirField, v)"
          />
        </label>
        <label :class="headerToggleClass" data-testid="cloud-storage-auto-download">
          <span>{{ t('common.autoDownloadOutputs') }}</span>
          <InfoTooltip :text="t('tooltips.autoDownloadOutputs')" />
          <BooleanToggle
            :field="autoDownloadField"
            @update="(v) => updateField(autoDownloadField, v)"
          />
        </label>
      </template>
      <div :class="cardClass">
        <StorageDirRow
          v-if="autoDownloadEnabled"
          data-testid="cloud-storage-output-dir"
          list-aligned
          :path="outputPath"
          :shared="sharedOutputEnabled"
          :tag="sharedOutputEnabled ? '' : t('models.instanceOnly')"
          :browsable="!sharedOutputEnabled && !!outputDirField"
          :manageable="sharedOutputEnabled"
          @open="handleOpenOutputDir"
          @browse="handleBrowseOutputDir"
          @manage="handleManageSharedDirs"
        />
        <p
          v-else
          class="m-0 px-3 py-[7px] text-[13px] leading-[18px] text-text-muted"
          data-testid="cloud-storage-outputs-stay"
        >
          {{ t('comfyUISettings.cloudOutputsStay') }}
        </p>
      </div>
    </GlobalSettingsMicroSection>

    <GlobalSettingsMicroSection
      v-if="browserPartitionField"
      :title="browserPartitionField.label"
      data-testid="cloud-storage-browser-cache"
    >
      <template #actions>
        <BaseSelect
          class="h-8 w-40"
          compact
          :model-value="browserPartitionValue"
          :options="browserPartitionOptions"
          :aria-label="browserPartitionField.label"
          @update:model-value="(v: string) => updateField(browserPartitionField, v)"
        />
      </template>
      <p class="m-0 text-[13px] leading-[1.45] text-text-muted">
        {{ t('comfyUISettings.browserCacheHint') }}
      </p>
    </GlobalSettingsMicroSection>
  </div>
</template>
