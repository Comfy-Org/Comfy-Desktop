<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModal } from '../../composables/useModal'
import GlobalSettingsMicroSection from './GlobalSettingsMicroSection.vue'
import SharedFoldersList, { type SharedFolderRow } from './SharedFoldersList.vue'
import StorageDirRow from '../../views/comfyUISettings/StorageDirRow.vue'
import { samePath } from '../../lib/pathCompare'
import type { DetailField } from '../../types/ipc'

interface ModelsDir {
  path: string
  isPrimary: boolean
}

export interface GlobalStorageSnapshot {
  installLocationFields: Record<string, unknown>[]
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

const installDirField = computed<DetailField | undefined>(() => {
  const fields = props.snapshot.installLocationFields as unknown as DetailField[]
  return fields.find((f) => f.id === 'installDir') ?? fields[0]
})

const sharedFolderRows = computed<SharedFolderRow[]>(() => {
  const rows: SharedFolderRow[] = props.snapshot.modelsDirs.map((dir, index) => ({
    key: `models:${index}:${dir.path}`,
    kind: 'models',
    path: dir.path,
    isDownloads: dir.isPrimary,
    removable: !dir.isPrimary
  }))
  if (sharedInputField.value) {
    rows.push({ key: 'input', kind: 'input', path: sharedFieldPath(sharedInputField.value) })
  }
  if (sharedOutputField.value) {
    rows.push({ key: 'output', kind: 'output', path: sharedFieldPath(sharedOutputField.value) })
  }
  return rows
})

function modelsDirIndex(row: SharedFolderRow): number {
  return props.snapshot.modelsDirs.findIndex((d) => d.path === row.path)
}

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

async function handleBrowseInstallDir(): Promise<void> {
  const field = installDirField.value
  if (!field) return
  const picked = await bridge?.globalSettingsBrowseFolder(sharedFieldPath(field) || undefined)
  if (!picked || picked === field.value) return
  await bridge?.globalSettingsUpdateField(field.id, picked)
}

function handleOpenRow(row: SharedFolderRow): void {
  handleOpenPath(row.path)
}

function handleBrowseRow(row: SharedFolderRow): void {
  if (row.kind === 'input') void browseSharedDir(sharedInputField.value)
  else if (row.kind === 'output') void browseSharedDir(sharedOutputField.value)
  else void handleChangeModelsDir(modelsDirIndex(row))
}

function handleUseForDownloads(row: SharedFolderRow): void {
  void handleMakePrimary(modelsDirIndex(row))
}

function handleRemoveRow(row: SharedFolderRow): void {
  void handleRemoveModelsDir(modelsDirIndex(row))
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
  if (index <= 0) return
  emit('touched')
  const dirs = props.snapshot.modelsDirs.map((d) => d.path)
  const moved = dirs.splice(index, 1)[0]
  if (typeof moved !== 'string') return
  dirs.unshift(moved)
  await bridge?.globalSettingsSetModelsDirs(dirs)
}

async function handleChangeModelsDir(index: number): Promise<void> {
  if (index < 0) return
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
  <GlobalSettingsMicroSection
    :title="t('settings.installLocation')"
    :tooltip="t('tooltips.installDir')"
  >
    <StorageDirRow
      v-if="installDirField"
      :path="sharedFieldPath(installDirField)"
      @open="handleOpenPath(sharedFieldPath(installDirField))"
      @browse="handleBrowseInstallDir"
    />
  </GlobalSettingsMicroSection>

  <GlobalSettingsMicroSection
    :title="t('settings.sharedFolders')"
    :tooltip="t('tooltips.sharedFolders')"
  >
    <p class="gs-storage-hint m-0 text-[12.5px] text-text-muted">
      {{ t('settings.storageSharedHint') }}
    </p>
    <SharedFoldersList
      :rows="sharedFolderRows"
      @open="handleOpenRow"
      @browse="handleBrowseRow"
      @use-for-downloads="handleUseForDownloads"
      @remove="handleRemoveRow"
      @add="handleAddModelsDir"
    />
  </GlobalSettingsMicroSection>
</template>
