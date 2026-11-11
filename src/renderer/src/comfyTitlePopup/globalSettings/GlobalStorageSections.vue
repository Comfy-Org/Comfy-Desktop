<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModal } from '../../composables/useModal'
import GlobalSettingsMicroSection from './GlobalSettingsMicroSection.vue'
import ModelsDirList from './ModelsDirList.vue'
import StorageDirRow from '../../views/comfyUISettings/StorageDirRow.vue'
import { samePath } from '../../lib/pathCompare'
import type { DetailField } from '../../types/ipc'

interface ModelsDir {
  path: string
  isPrimary: boolean
}

export interface GlobalStorageSnapshot {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: ModelsDir[]
  modelsSystemDefault: string
}

interface GlobalSettingsBridge {
  platform?: string
  globalSettingsUpdateField(
    fieldId: string,
    value: unknown
  ): Promise<{ ok: boolean; message?: string }>
  globalSettingsBrowseFolder(defaultPath?: string): Promise<string | null>
  globalSettingsOpenPath(path: string): void
  globalSettingsSetModelsDirs(dirs: string[]): Promise<{ ok: boolean }>
}

interface Props {
  snapshot: GlobalStorageSnapshot
}

const props = defineProps<Props>()

const emit = defineEmits<{
  touched: []
}>()

const { t } = useI18n()
const modal = useModal()

const bridge = (window as unknown as { __comfyTitlePopup?: GlobalSettingsBridge }).__comfyTitlePopup

const sharedDirFields = computed<Record<string, DetailField>>(() => {
  const map: Record<string, DetailField> = {}
  for (const f of props.snapshot.sharedDirectoriesFields as unknown as DetailField[]) {
    map[f.id] = f
  }
  return map
})
const sharedInputField = computed(() => sharedDirFields.value.inputDir)
const sharedOutputField = computed(() => sharedDirFields.value.outputDir)

const sharedModelDirs = computed(() =>
  props.snapshot.modelsDirs.map((d) => ({ ...d, shared: true }))
)

function sharedFieldPath(field: DetailField | undefined): string {
  return typeof field?.value === 'string' ? field.value : ''
}

function handleOpenPath(path: string): void {
  if (path) bridge?.globalSettingsOpenPath(path)
}

async function browseSharedDir(field: DetailField | undefined): Promise<void> {
  if (!field) return
  const picked = await bridge?.globalSettingsBrowseFolder(sharedFieldPath(field) || undefined)
  if (!picked || picked === field.value) return
  emit('touched')
  await bridge?.globalSettingsUpdateField(field.id, picked)
}

function handleBrowseSharedInput(): void {
  void browseSharedDir(sharedInputField.value)
}
function handleBrowseSharedOutput(): void {
  void browseSharedDir(sharedOutputField.value)
}

function handleOpenModelsDir(index: number): void {
  const dir = props.snapshot.modelsDirs[index]
  if (dir) bridge?.globalSettingsOpenPath(dir.path)
}

function isListedModelsDir(path: string): boolean {
  const win = bridge?.platform === 'win32'
  return props.snapshot.modelsDirs.some((d) => samePath(d.path, path, win))
}

async function handleAddModelsDir(): Promise<void> {
  const picked = await bridge?.globalSettingsBrowseFolder()
  if (!picked || isListedModelsDir(picked)) return
  emit('touched')
  const dirs = props.snapshot.modelsDirs.map((d) => d.path)
  dirs.push(picked)
  await bridge?.globalSettingsSetModelsDirs(dirs)
}

async function handleRemoveModelsDir(index: number): Promise<void> {
  const dir = props.snapshot.modelsDirs[index]
  if (!dir) return
  const ok = await modal.confirm({
    title: t('models.removeDirTitle'),
    message: t('models.removeDirConfirm'),
    confirmLabel: t('models.removeDir'),
    confirmStyle: 'danger'
  })
  if (!ok) return
  emit('touched')
  const dirs = props.snapshot.modelsDirs.map((d) => d.path)
  dirs.splice(index, 1)
  await bridge?.globalSettingsSetModelsDirs(dirs)
}

async function handleMakePrimary(index: number): Promise<void> {
  emit('touched')
  const dirs = props.snapshot.modelsDirs.map((d) => d.path)
  const moved = dirs.splice(index, 1)[0]
  if (typeof moved !== 'string') return
  dirs.unshift(moved)
  await bridge?.globalSettingsSetModelsDirs(dirs)
}

async function handleChangeModelsDir(index: number): Promise<void> {
  const current = props.snapshot.modelsDirs[index]?.path
  const picked = await bridge?.globalSettingsBrowseFolder(current)
  if (!picked || isListedModelsDir(picked)) return
  emit('touched')
  const dirs = props.snapshot.modelsDirs.map((d) => d.path)
  dirs[index] = picked
  await bridge?.globalSettingsSetModelsDirs(dirs)
}
</script>

<template>
  <p class="gs-storage-hint m-0 mb-2 text-[12.5px] text-text-muted">
    {{ t('settings.storageSharedHint') }}
  </p>
  <GlobalSettingsMicroSection :title="t('settings.models')" :tooltip="t('tooltips.sharedModels')">
    <ModelsDirList
      :dirs="sharedModelDirs"
      hide-shared-tag
      @change="handleChangeModelsDir"
      @remove="handleRemoveModelsDir"
      @make-primary="handleMakePrimary"
      @open="handleOpenModelsDir"
      @add="handleAddModelsDir"
    />
  </GlobalSettingsMicroSection>

  <GlobalSettingsMicroSection
    :title="t('settings.sharedDirectories')"
    :tooltip="t('tooltips.sharedDirectories')"
  >
    <div
      v-if="sharedInputField || sharedOutputField"
      class="gs-shared-dirs flex flex-col rounded-[14px] bg-white/5 p-1.5 [&_.storage-dir-row]:min-h-12 [&_.storage-dir-row]:rounded-[10px] [&_.storage-dir-row]:bg-transparent [&_.storage-dir-row]:pl-3"
    >
      <StorageDirRow
        v-if="sharedInputField"
        :tag="sharedInputField.label || t('media.inputDir')"
        :path="sharedFieldPath(sharedInputField)"
        shared
        hide-shared-tag
        @open="handleOpenPath(sharedFieldPath(sharedInputField))"
        @browse="handleBrowseSharedInput"
      />
      <StorageDirRow
        v-if="sharedOutputField"
        :tag="sharedOutputField.label || t('media.outputDir')"
        :path="sharedFieldPath(sharedOutputField)"
        shared
        hide-shared-tag
        @open="handleOpenPath(sharedFieldPath(sharedOutputField))"
        @browse="handleBrowseSharedOutput"
      />
    </div>
  </GlobalSettingsMicroSection>
</template>
