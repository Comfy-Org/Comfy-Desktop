<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { AlertTriangle } from 'lucide-vue-next'
import { useModal } from '../../composables/useModal'
import ModelsDirList from '../../comfyTitlePopup/globalSettings/ModelsDirList.vue'
import StorageDirRow from './StorageDirRow.vue'
import BuildSettingsSection from './BuildSettingsSection.vue'
import BooleanToggle from './BooleanToggle.vue'
import ExtraModelPathsModal, { type ExtraModelPathSection } from './ExtraModelPathsModal.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import { samePath as samePathOn } from '../../lib/pathCompare'
import type { DetailField, DetailSection } from '../../types/ipc'

interface ModelsDir {
  path: string
  isPrimary: boolean
  locked?: boolean
  promotable?: boolean
  readonly?: boolean
  kind?: 'extra'
  shared?: boolean
}

export interface StorageSnapshot {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: ModelsDir[]
  modelsSystemDefault: string
}

interface Props {
  snapshot: StorageSnapshot
  sections: DetailSection[]
  pendingRestartFieldIds: Set<string>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update-field': [field: DetailField, value: unknown]
  refresh: []
}>()

const { t } = useI18n()
const modal = useModal()

function samePath(a: string, b: string): boolean {
  return samePathOn(a, b, window.api.platform === 'win32')
}

const PER_INSTALL_STORAGE_FIELD_IDS = [
  'useSharedModels',
  'useSharedInput',
  'useSharedOutput',
  'modelDirs',
  'modelDirsPrimary',
  'inputDir',
  'outputDir'
]

const showRestartWarning = computed(() =>
  PER_INSTALL_STORAGE_FIELD_IDS.some((id) => props.pendingRestartFieldIds.has(id))
)

const sharedDirFields = computed<Record<string, DetailField>>(() => {
  const map: Record<string, DetailField> = {}
  for (const f of props.snapshot.sharedDirectoriesFields as unknown as DetailField[]) {
    map[f.id] = f
  }
  return map
})
const sharedInputField = computed(() => sharedDirFields.value.inputDir)
const sharedOutputField = computed(() => sharedDirFields.value.outputDir)

function sharedFieldPath(field: DetailField | undefined): string {
  return typeof field?.value === 'string' ? field.value : ''
}

const perInstallFields = computed<DetailField[]>(() =>
  props.sections.flatMap((s) => s.fields ?? [])
)

function findField(id: string): DetailField | undefined {
  return perInstallFields.value.find((f) => f.id === id)
}

interface ExtraModelPathsView {
  yamlPath: string
  exists: boolean
  sections: ExtraModelPathSection[]
}
const extraModelPaths = computed<ExtraModelPathsView>(() => {
  const v = findField('extraModelPaths')?.value as ExtraModelPathsView | undefined
  return v ?? { yamlPath: '', exists: false, sections: [] }
})
const extraSections = computed<ExtraModelPathSection[]>(() => extraModelPaths.value.sections)

const extraModelRows = computed<ModelsDir[]>(() =>
  extraSections.value.length > 0
    ? [{ path: extraModelPaths.value.yamlPath, isPrimary: false, kind: 'extra' }]
    : []
)

const extraModalOpen = ref(false)

function openExtraDetails(row: ModelsDir | undefined): void {
  if (row?.kind === 'extra') extraModalOpen.value = true
}

function handleModelDetails(index: number): void {
  openExtraDetails(modelDirRows.value[index])
}
function closeExtraModal(): void {
  extraModalOpen.value = false
}
function handleRefreshExtraPaths(): void {
  emit('refresh')
}

function persistField(id: string, value: unknown): void {
  const field = findField(id)
  if (field) emit('update-field', field, value)
}

const useSharedModelsField = computed(() => findField('useSharedModels'))
const useSharedModelsEnabled = computed<boolean>(() => {
  const f = useSharedModelsField.value
  return f ? f.value !== false : true
})

const useSharedInputField = computed(() => findField('useSharedInput'))
const useSharedInputEnabled = computed<boolean>(() => {
  const f = useSharedInputField.value
  return f ? f.value !== false : true
})
const useSharedOutputField = computed(() => findField('useSharedOutput'))
const useSharedOutputEnabled = computed<boolean>(() => {
  const f = useSharedOutputField.value
  return f ? f.value !== false : true
})

function handleToggleField(field: DetailField | undefined, value: boolean): void {
  if (field) emit('update-field', field, value)
}

function currentExtras(): string[] {
  const v = findField('modelDirs')?.value
  return Array.isArray(v) ? (v as string[]) : []
}

const installOwnModelsDir = computed<string>(() => {
  const v = findField('installModelsDir')?.value
  return typeof v === 'string' ? v : ''
})

function isOwnModelsDir(p: string): boolean {
  return installOwnModelsDir.value !== '' && samePath(p, installOwnModelsDir.value)
}

const includedSharedPaths = computed<string[]>(() =>
  useSharedModelsEnabled.value
    ? props.snapshot.modelsDirs.map((d) => d.path).filter((p) => !isOwnModelsDir(p))
    : []
)

const visibleExtras = computed<string[]>(() => {
  const out: string[] = []
  for (const p of currentExtras()) {
    if (isOwnModelsDir(p)) continue
    if (includedSharedPaths.value.some((s) => samePath(s, p))) continue
    if (out.some((s) => samePath(s, p))) continue
    out.push(p)
  }
  return out
})

const effectivePrimary = computed<string | null>(() => {
  const raw = findField('modelDirsPrimary')?.value
  if (typeof raw === 'string') {
    if (installOwnModelsDir.value && samePath(raw, installOwnModelsDir.value)) return null
    const known =
      includedSharedPaths.value.some((d) => samePath(d, raw)) ||
      currentExtras().some((d) => samePath(d, raw))
    if (known) return raw
  }
  return includedSharedPaths.value[0] ?? null
})

const modelDirRows = computed<ModelsDir[]>(() => {
  const primary = effectivePrimary.value
  const own = installOwnModelsDir.value
  const ownRow: ModelsDir | null = own
    ? {
        path: own,
        isPrimary: primary === null,
        locked: true
      }
    : null
  const rest: ModelsDir[] = [
    ...includedSharedPaths.value.map((p) => ({
      path: p,
      isPrimary: primary !== null && samePath(p, primary),
      shared: true,
      readonly: true
    })),
    ...visibleExtras.value.map((p) => ({
      path: p,
      isPrimary: primary !== null && samePath(p, primary)
    }))
  ]
  const primaryIdx = rest.findIndex((r) => r.isPrimary)
  if (primaryIdx > 0) rest.unshift(...rest.splice(primaryIdx, 1))
  const base = ownRow?.isPrimary ? [ownRow, ...rest] : ownRow ? [...rest, ownRow] : rest
  return [...base, ...extraModelRows.value]
})

function isKnownModelDir(path: string): boolean {
  return (
    samePath(path, installOwnModelsDir.value) ||
    includedSharedPaths.value.some((d) => samePath(d, path)) ||
    currentExtras().some((d) => samePath(d, path))
  )
}

async function handleAddModelDir(): Promise<void> {
  const picked = await window.api.browseFolder()
  if (!picked || isKnownModelDir(picked)) return
  persistField('modelDirs', [...currentExtras(), picked])
}

async function handleRemoveModelDir(index: number): Promise<void> {
  const row = modelDirRows.value[index]
  if (!row || row.locked || row.readonly || row.kind === 'extra') return
  const extras = currentExtras()
  if (!extras.some((d) => samePath(d, row.path))) return
  const ok = await modal.confirm({
    title: t('models.removeInstanceDirTitle'),
    message: t('models.removeInstanceDirConfirm'),
    confirmLabel: t('models.removeDir'),
    confirmStyle: 'danger'
  })
  if (!ok) return
  const persistedPrimary = findField('modelDirsPrimary')?.value
  if (typeof persistedPrimary === 'string' && samePath(row.path, persistedPrimary)) {
    persistField('modelDirsPrimary', null)
  }
  persistField(
    'modelDirs',
    extras.filter((d) => !samePath(d, row.path))
  )
}

async function handleChangeModelDir(index: number): Promise<void> {
  const row = modelDirRows.value[index]
  if (!row || row.locked || row.readonly || row.kind === 'extra') return
  const picked = await window.api.browseFolder(row.path)
  if (!picked || samePath(picked, row.path) || isKnownModelDir(picked)) return
  const persistedPrimary = findField('modelDirsPrimary')?.value
  if (typeof persistedPrimary === 'string' && samePath(row.path, persistedPrimary)) {
    persistField('modelDirsPrimary', picked)
  }
  persistField(
    'modelDirs',
    currentExtras().map((d) => (samePath(d, row.path) ? picked : d))
  )
}

function handleMakeModelPrimary(index: number): void {
  const row = modelDirRows.value[index]
  if (!row || row.kind === 'extra') return
  persistField('modelDirsPrimary', row.path)
}

function handleOpenModelDir(index: number): void {
  const dir = modelDirRows.value[index]
  if (dir) void window.api.openPath(dir.path)
}

function handleManageSharedDirs(): void {
  window.api.openGlobalSettings('storage')
}

function effectiveDir(storedId: string, defaultId: string): string {
  const stored = findField(storedId)?.value
  if (typeof stored === 'string' && stored.trim()) return stored
  const def = findField(defaultId)?.value
  return typeof def === 'string' ? def : ''
}

function isOverridden(storedId: string): boolean {
  const stored = findField(storedId)?.value
  return typeof stored === 'string' && stored.trim().length > 0
}

const effectiveInputDir = computed(() => effectiveDir('inputDir', 'inputDirDefault'))
const effectiveOutputDir = computed(() => effectiveDir('outputDir', 'outputDirDefault'))
const inputOverridden = computed(() => isOverridden('inputDir'))
const outputOverridden = computed(() => isOverridden('outputDir'))

function defaultOf(defaultId: string): string {
  const v = findField(defaultId)?.value
  return typeof v === 'string' ? v : ''
}

async function browseDir(storedId: string, defaultId: string, current: string): Promise<void> {
  const picked = await window.api.browseFolder(current || undefined)
  if (!picked) return
  persistField(storedId, samePath(picked, defaultOf(defaultId)) ? '' : picked)
}

function handleBrowseInputDir(): void {
  void browseDir('inputDir', 'inputDirDefault', effectiveInputDir.value)
}
function handleBrowseOutputDir(): void {
  void browseDir('outputDir', 'outputDirDefault', effectiveOutputDir.value)
}
function handleResetInputDir(): void {
  persistField('inputDir', '')
}
function handleResetOutputDir(): void {
  persistField('outputDir', '')
}
function handleOpenPath(path: string): void {
  if (path) void window.api.openPath(path)
}
function handleRevealPath(path: string): void {
  if (path) window.api.revealPath(path)
}
</script>

<template>
  <div class="storage-pane @container/build-settings flex flex-col gap-8">
    <div
      v-if="showRestartWarning"
      class="storage-note is-warning m-0 flex items-center gap-2.5 rounded-[14px] bg-[color-mix(in_srgb,var(--text)_6%,transparent)] px-4 py-3 text-neutral-100"
      role="status"
    >
      <AlertTriangle
        :size="14"
        class="storage-note-icon shrink-0 text-text-muted"
        aria-hidden="true"
      />
      <p class="storage-note-text m-0 text-[13px] leading-[1.45]">
        {{ t('comfyUISettings.storageRestartNote') }}
      </p>
    </div>

    <BuildSettingsSection :title="t('settings.modelStorage')" :hint="t('tooltips.instanceModels')">
      <template v-if="useSharedModelsField" #actions>
        <label
          class="storage-header-toggle flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-[13px] leading-[18px] text-text-muted [&>span]:truncate [&>.bt-switch]:ml-auto"
        >
          <span>{{ t('comfyUISettings.includeSharedDirs') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedModels')" />
          <BooleanToggle
            :field="useSharedModelsField"
            @update="(v) => handleToggleField(useSharedModelsField, v)"
          />
        </label>
      </template>

      <ModelsDirList
        :dirs="modelDirRows"
        :add-label="t('models.addInstanceDir')"
        @change="handleChangeModelDir"
        @remove="handleRemoveModelDir"
        @make-primary="handleMakeModelPrimary"
        @open="handleOpenModelDir"
        @details="handleModelDetails"
        @add="handleAddModelDir"
      >
        <template v-if="useSharedModelsEnabled" #footer>
          <Button
            type="button"
            variant="textonly"
            size="unset"
            class="storage-manage-link static inline-block min-w-0 gap-0 rounded-none border-none bg-transparent p-0 text-left text-[12px] leading-[1.5] font-normal whitespace-normal text-text-muted underline underline-offset-2 appearance-auto hover:bg-transparent hover:text-neutral-100 focus-visible:bg-transparent focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0"
            @click="handleManageSharedDirs"
          >
            {{ t('comfyUISettings.manageSharedDirs') }}
          </Button>
        </template>
      </ModelsDirList>
    </BuildSettingsSection>

    <BuildSettingsSection :title="t('settings.inputStorage')">
      <template v-if="useSharedInputField" #actions>
        <label
          class="storage-header-toggle flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-[13px] leading-[18px] text-text-muted [&>span]:truncate [&>.bt-switch]:ml-auto"
        >
          <span>{{ t('comfyUISettings.useSharedInput') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedInput')" />
          <BooleanToggle
            :field="useSharedInputField"
            @update="(v) => handleToggleField(useSharedInputField, v)"
          />
        </label>
      </template>
      <template v-if="useSharedInputEnabled">
        <StorageDirRow
          v-if="sharedInputField"
          :path="sharedFieldPath(sharedInputField)"
          shared
          :browsable="false"
          manageable
          @open="handleOpenPath(sharedFieldPath(sharedInputField))"
          @manage="handleManageSharedDirs"
        />
      </template>
      <StorageDirRow
        v-else
        :path="effectiveInputDir"
        :tag="!inputOverridden ? t('models.default') : ''"
        :resettable="inputOverridden"
        @open="handleOpenPath(effectiveInputDir)"
        @browse="handleBrowseInputDir"
        @reset="handleResetInputDir"
      />
    </BuildSettingsSection>

    <BuildSettingsSection :title="t('settings.outputStorage')">
      <template v-if="useSharedOutputField" #actions>
        <label
          class="storage-header-toggle flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-[13px] leading-[18px] text-text-muted [&>span]:truncate [&>.bt-switch]:ml-auto"
        >
          <span>{{ t('comfyUISettings.useSharedOutput') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedOutput')" />
          <BooleanToggle
            :field="useSharedOutputField"
            @update="(v) => handleToggleField(useSharedOutputField, v)"
          />
        </label>
      </template>
      <template v-if="useSharedOutputEnabled">
        <StorageDirRow
          v-if="sharedOutputField"
          :path="sharedFieldPath(sharedOutputField)"
          shared
          :browsable="false"
          manageable
          @open="handleOpenPath(sharedFieldPath(sharedOutputField))"
          @manage="handleManageSharedDirs"
        />
      </template>
      <StorageDirRow
        v-else
        :path="effectiveOutputDir"
        :tag="!outputOverridden ? t('models.default') : ''"
        :resettable="outputOverridden"
        @open="handleOpenPath(effectiveOutputDir)"
        @browse="handleBrowseOutputDir"
        @reset="handleResetOutputDir"
      />
    </BuildSettingsSection>

    <ExtraModelPathsModal
      :open="extraModalOpen"
      :sections="extraSections"
      :yaml-path="extraModelPaths.yamlPath"
      @close="closeExtraModal"
      @open-path="handleOpenPath"
      @reveal-path="handleRevealPath"
      @refresh="handleRefreshExtraPaths"
    />
  </div>
</template>
