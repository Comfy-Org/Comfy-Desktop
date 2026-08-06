<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Info } from 'lucide-vue-next'
import { useModal } from '../../composables/useModal'
import GlobalSettingsMicroSection from '../../comfyTitlePopup/globalSettings/GlobalSettingsMicroSection.vue'
import ModelsDirList from '../../comfyTitlePopup/globalSettings/ModelsDirList.vue'
import StorageDirRow from './StorageDirRow.vue'
import BooleanToggle from './BooleanToggle.vue'
import ExtraModelPathsModal, { type ExtraModelPathSection } from './ExtraModelPathsModal.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import type { DetailField, DetailSection, Installation } from '../../types/ipc'

/** Storage tab pane for the instance-picker settings. Composes the global
 *  shared-models UI (via the popup's `__comfyTitlePopup.globalSettings*`
 *  bridge) with the per-install storage section from `props.sections`. The
 *  `Use Shared *` toggles live inside their respective Models / Input-Output
 *  groups. */

interface ModelsDir {
  path: string
  isPrimary: boolean
  locked?: boolean
  promotable?: boolean
  /** Read-only rows (the included global shared dirs) can't be removed or
   *  browsed/replaced from the instance pane, but stay promotable. */
  readonly?: boolean
  /** Read-only row for the install's `extra_model_paths.yaml` file (opens a modal). */
  kind?: 'extra'
  /** Globally-shared dir -> shows the shared badge on its icon. */
  shared?: boolean
}

export interface StorageSnapshot {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: ModelsDir[]
  modelsSystemDefault: string
}

interface GlobalSettingsBridge {
  globalSettingsUpdateField(
    fieldId: string,
    value: unknown
  ): Promise<{ ok: boolean; message?: string }>
  globalSettingsBrowseFolder(defaultPath?: string): Promise<string | null>
  globalSettingsOpenPath(path: string): void
  globalSettingsRevealPath(path: string): void
  globalSettingsSetModelsDirs(dirs: string[]): Promise<{ ok: boolean }>
  /** Close this popup and reopen Global Desktop Settings (where the shared
   *  directories themselves are managed). Optional for older bridges. */
  openSettingsTab?(tab: 'comfy' | 'directories' | 'downloads' | 'global'): void
  platform?: string
}

interface Props {
  installation: Installation | null
  /** Global snapshot fields, passed as a prop so the picker doesn't subscribe twice. */
  snapshot: StorageSnapshot
  /** Per-install storage sections; git installs omit them entirely. */
  sections: DetailSection[]
  pendingRestartFieldIds: Set<string>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update-field': [field: DetailField, value: unknown]
  /** Ask the parent to re-fetch detail sections (refreshes custom-paths on-disk
   *  status, computed once per fetch in the main process). */
  refresh: []
}>()

const { t } = useI18n()
const modal = useModal()

const bridge = (window as unknown as { __comfyTitlePopup?: GlobalSettingsBridge }).__comfyTitlePopup

/** Platform-aware path equality. Renderer paths are already absolute (browse
 *  results, backend-computed defaults, stored dirs), so no resolve is needed. */
function samePath(a: string, b: string): boolean {
  if (!a || !b) return false
  return bridge?.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether any global field was touched this session. Writes persist
 *  immediately; this is just the signal driving the top-of-tab warning swap. */
const globalTouched = ref(false)

watch(
  () => props.installation?.id ?? null,
  () => {
    globalTouched.value = false
  }
)

/** Edits to these per-install fields also trigger the restart prompt. */
const PER_INSTALL_STORAGE_FIELD_IDS = [
  'useSharedModels',
  'useSharedInput',
  'useSharedOutput',
  'modelDirs',
  'modelDirsPrimary',
  'inputDir',
  'outputDir'
]

const showRestartWarning = computed(() => {
  if (globalTouched.value) return true
  return PER_INSTALL_STORAGE_FIELD_IDS.some((id) => props.pendingRestartFieldIds.has(id))
})

// Computed (not inlined `:is`) so `<script setup>` counts the icon imports as used.
const noteIcon = computed(() => (showRestartWarning.value ? AlertTriangle : Info))

/** Global shared input/output fields from the snapshot, keyed by id so the
 *  shared-on rows render with the same readonly path-row style as shared-off. */
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

/** Read-only dirs from the install's `extra_model_paths.yaml`, resolved in the
 *  main process and passed as a hidden field, grouped by section. */
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

/** The install's `extra_model_paths.yaml` as a single read-only row (its
 *  sections are shown in the detail modal). ComfyUI loads this file regardless
 *  of the shared-models toggle, so the row appends to both lists. */
const extraModelRows = computed<ModelsDir[]>(() =>
  extraSections.value.length > 0
    ? [{ path: extraModelPaths.value.yamlPath, isPrimary: false, kind: 'extra' }]
    : []
)

// --- Custom model paths detail modal --------------------------------------

// The modal reads `extraSections` live, so a refresh updates it in place.
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

/** `useSharedModels` toggle (defaults on). When on, the global shared dirs are
 *  included in the unified list below as read-only rows; the per-instance dirs
 *  are always shown and editable either way. */
const useSharedModelsField = computed(() => findField('useSharedModels'))
const useSharedModelsEnabled = computed<boolean>(() => {
  const f = useSharedModelsField.value
  return f ? f.value !== false : true
})

/** Independent `useSharedInput` / `useSharedOutput` toggles (default on). Each
 *  swaps its row between the global shared folder and the per-install one. */
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

// --- Unified per-instance model directory list -----------------------------
// One list for everything this instance reads: the included global shared
// dirs (read-only here, shared badge), the per-instance extras (editable),
// the install's own models dir (locked), and the extra_model_paths.yaml row.

function currentExtras(): string[] {
  const v = findField('modelDirs')?.value
  return Array.isArray(v) ? (v as string[]) : []
}

/** The install's own models dir, computed by the backend (never persisted). */
const installOwnModelsDir = computed<string>(() => {
  const v = findField('installModelsDir')?.value
  return typeof v === 'string' ? v : ''
})

/** Global shared dir paths this instance includes; empty when the toggle is off. */
const includedSharedPaths = computed<string[]>(() =>
  useSharedModelsEnabled.value ? props.snapshot.modelsDirs.map((d) => d.path) : []
)

/** Per-instance extras, hiding duplicates of an included shared dir (the
 *  backend dedupes the effective set the same way - shared dirs first). */
const visibleExtras = computed<string[]>(() =>
  currentExtras().filter((p) => !includedSharedPaths.value.some((s) => samePath(s, p)))
)

/** Effective primary, mirroring the backend's `resolveLauncherModelDirs`: a
 *  persisted `modelDirsPrimary` present in the effective dirs wins, else the
 *  first included shared dir, else null (= the install's own models dir). */
const effectivePrimary = computed<string | null>(() => {
  const raw = findField('modelDirsPrimary')?.value
  if (typeof raw === 'string') {
    const known =
      includedSharedPaths.value.some((d) => samePath(d, raw)) ||
      currentExtras().some((d) => samePath(d, raw))
    if (known) return raw
  }
  return includedSharedPaths.value[0] ?? null
})

/** Combined list with the primary on top: shared rows, then instance extras,
 *  then the locked install-own row (which leads only while it's the primary),
 *  then the read-only extra_model_paths.yaml row. */
const modelDirRows = computed<ModelsDir[]>(() => {
  const primary = effectivePrimary.value
  const own = installOwnModelsDir.value
  // While shared dirs are included, `modelDirsPrimary: null` resolves to the
  // first shared dir, so the install-own row can't be promoted to primary.
  const ownRow: ModelsDir | null = own
    ? {
        path: own,
        isPrimary: primary === null,
        locked: true,
        promotable: includedSharedPaths.value.length === 0
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

/** Whether a picked path already appears somewhere in the effective set. */
function isKnownModelDir(path: string): boolean {
  return (
    samePath(path, installOwnModelsDir.value) ||
    includedSharedPaths.value.some((d) => samePath(d, path)) ||
    currentExtras().some((d) => samePath(d, path))
  )
}

/** Add always targets the per-instance `modelDirs`, never the global list. */
async function handleAddModelDir(): Promise<void> {
  const picked = await bridge?.globalSettingsBrowseFolder()
  if (!picked || isKnownModelDir(picked)) return
  persistField('modelDirs', [...currentExtras(), picked])
}

async function handleRemoveModelDir(index: number): Promise<void> {
  const row = modelDirRows.value[index]
  // Only per-instance extras are removable here; shared dirs are managed in
  // Global Desktop Settings.
  if (!row || row.locked || row.readonly || row.kind === 'extra') return
  const extras = currentExtras()
  if (!extras.some((d) => samePath(d, row.path))) return
  const ok = await modal.confirm({
    title: t('models.removeInstanceDirTitle', 'Remove model directory?'),
    message: t(
      'models.removeInstanceDirConfirm',
      "This won't delete any files. You can re-add the directory later from this list."
    ),
    confirmLabel: t('models.removeDir', 'Remove'),
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

/** Browse-replace a per-instance extra in place. */
async function handleChangeModelDir(index: number): Promise<void> {
  const row = modelDirRows.value[index]
  if (!row || row.locked || row.readonly || row.kind === 'extra') return
  const picked = await bridge?.globalSettingsBrowseFolder(row.path)
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
  // The locked install-own row becoming primary means "no explicit primary".
  persistField('modelDirsPrimary', row.locked ? null : row.path)
}

function handleOpenModelDir(index: number): void {
  const dir = modelDirRows.value[index]
  if (dir) bridge?.globalSettingsOpenPath(dir.path)
}

/** The shared dirs themselves are edited in Global Desktop Settings; this
 *  closes the picker popup and opens that surface. */
const canManageSharedDirs = computed(() => typeof bridge?.openSettingsTab === 'function')
function handleManageSharedDirs(): void {
  bridge?.openSettingsTab?.('global')
}

// --- Per-instance input / output dirs (shared I/O off) --------------------

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
  const picked = await bridge?.globalSettingsBrowseFolder(current || undefined)
  if (!picked) return
  // Selecting the computed default clears the override so a clone derives its
  // own path instead of pointing back at this install.
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
  if (path) bridge?.globalSettingsOpenPath(path)
}
function handleRevealPath(path: string): void {
  if (path) bridge?.globalSettingsRevealPath(path)
}

// --- Shared input/output dirs (edited globally) ----------------------------

async function browseSharedDir(field: DetailField | undefined): Promise<void> {
  if (!field) return
  const picked = await bridge?.globalSettingsBrowseFolder(sharedFieldPath(field) || undefined)
  if (!picked || picked === field.value) return
  globalTouched.value = true
  await bridge?.globalSettingsUpdateField(field.id, picked)
}

function handleBrowseSharedInput(): void {
  void browseSharedDir(sharedInputField.value)
}
function handleBrowseSharedOutput(): void {
  void browseSharedDir(sharedOutputField.value)
}
</script>

<template>
  <div class="storage-pane">
    <div class="storage-note" :class="{ 'is-warning': showRestartWarning }" role="status">
      <component :is="noteIcon" :size="14" class="storage-note-icon" aria-hidden="true" />
      <p class="storage-note-text">
        <template v-if="showRestartWarning">
          {{
            t(
              'comfyUISettings.storageRestartNote',
              'Restart the application (or close and reopen) for these changes to take effect.'
            )
          }}
        </template>
        <template v-else>
          {{
            t(
              'comfyUISettings.storageGlobalNote',
              'Changes here apply to all of your ComfyUI instances.'
            )
          }}
        </template>
      </p>
    </div>

    <!-- Models group: one unified list. The toggle only controls whether the
         global shared dirs are included (read-only rows); the per-instance
         dirs below it are always shown and editable. -->
    <GlobalSettingsMicroSection
      :title="t('settings.modelStorage', 'Models')"
      :tooltip="t('tooltips.instanceModels')"
    >
      <div v-if="useSharedModelsField" class="storage-toggle-row">
        <label class="storage-toggle-label">
          <span>{{ t('common.useSharedModels', 'Include Shared Model Directories') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedModels')" />
        </label>
        <BooleanToggle
          :field="useSharedModelsField"
          @update="(v) => handleToggleField(useSharedModelsField, v)"
        />
      </div>

      <ModelsDirList
        :dirs="modelDirRows"
        @change="handleChangeModelDir"
        @remove="handleRemoveModelDir"
        @make-primary="handleMakeModelPrimary"
        @open="handleOpenModelDir"
        @details="handleModelDetails"
        @add="handleAddModelDir"
      />

      <!-- Shared dirs are read-only here; they're managed globally. -->
      <button
        v-if="useSharedModelsEnabled && canManageSharedDirs"
        type="button"
        class="storage-manage-link"
        @click="handleManageSharedDirs"
      >
        {{ t('comfyUISettings.manageSharedDirs', 'Manage Shared Directories in Desktop Settings') }}
      </button>
    </GlobalSettingsMicroSection>

    <!-- Input/Output group: independent per-folder shared toggles. Each row
         shows the effective folder for its source - the global shared folder
         (edited globally) or the per-install one. -->
    <GlobalSettingsMicroSection :title="t('settings.inputOutputStorage', 'Input & Output')">
      <div v-if="useSharedInputField" class="storage-toggle-row">
        <label class="storage-toggle-label">
          <span>{{ t('common.useSharedInput', 'Use Shared Input Folder') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedInput')" />
        </label>
        <BooleanToggle
          :field="useSharedInputField"
          @update="(v) => handleToggleField(useSharedInputField, v)"
        />
      </div>
      <template v-if="useSharedInputEnabled">
        <StorageDirRow
          v-if="sharedInputField"
          :label="sharedInputField.label || t('common.perInstallInputDir', 'Input Directory')"
          :path="sharedFieldPath(sharedInputField)"
          shared
          @open="handleOpenPath(sharedFieldPath(sharedInputField))"
          @browse="handleBrowseSharedInput"
        />
      </template>
      <StorageDirRow
        v-else
        :label="t('common.perInstallInputDir', 'Input Directory')"
        :path="effectiveInputDir"
        :tag="!inputOverridden ? t('models.default', 'default') : ''"
        :resettable="inputOverridden"
        @open="handleOpenPath(effectiveInputDir)"
        @browse="handleBrowseInputDir"
        @reset="handleResetInputDir"
      />

      <div v-if="useSharedOutputField" class="storage-toggle-row">
        <label class="storage-toggle-label">
          <span>{{ t('common.useSharedOutput', 'Use Shared Output Folder') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedOutput')" />
        </label>
        <BooleanToggle
          :field="useSharedOutputField"
          @update="(v) => handleToggleField(useSharedOutputField, v)"
        />
      </div>
      <template v-if="useSharedOutputEnabled">
        <StorageDirRow
          v-if="sharedOutputField"
          :label="sharedOutputField.label || t('common.perInstallOutputDir', 'Output Directory')"
          :path="sharedFieldPath(sharedOutputField)"
          shared
          @open="handleOpenPath(sharedFieldPath(sharedOutputField))"
          @browse="handleBrowseSharedOutput"
        />
      </template>
      <StorageDirRow
        v-else
        :label="t('common.perInstallOutputDir', 'Output Directory')"
        :path="effectiveOutputDir"
        :tag="!outputOverridden ? t('models.default', 'default') : ''"
        :resettable="outputOverridden"
        @open="handleOpenPath(effectiveOutputDir)"
        @browse="handleBrowseOutputDir"
        @reset="handleResetOutputDir"
      />
    </GlobalSettingsMicroSection>

    <!-- Read-only details for the install's extra_model_paths.yaml file,
         opened from its row in the models list above. -->
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

<style scoped>
.storage-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.storage-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--brand-surface-bg);
  border: 1px solid var(--chooser-surface-border);
  color: var(--text-muted);
  transition:
    color 160ms ease,
    background-color 160ms ease,
    border-color 160ms ease;
}

.storage-note-icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.storage-note-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

/* Warning state. Icon `color` is explicit to override the base 0.85 opacity. */
.storage-note.is-warning {
  color: var(--warning);
  border-color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  font-weight: 500;
}

.storage-note.is-warning .storage-note-icon {
  color: var(--warning);
  opacity: 1;
}

/* Use-Shared-* toggle row sitting at the top of each storage group. */
.storage-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
}

.storage-toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  font-size: 13px;
  color: var(--neutral-100);
}

.storage-toggle-label > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Link-style affordance to the global Desktop Settings storage surface. */
.storage-manage-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: underline;
  cursor: pointer;
}

.storage-manage-link:hover,
.storage-manage-link:focus-visible {
  color: var(--accent);
  outline: none;
}
</style>
