<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle } from 'lucide-vue-next'
import { useModal } from '../../composables/useModal'
import GlobalSettingsMicroSection from '../../comfyTitlePopup/globalSettings/GlobalSettingsMicroSection.vue'
import ModelsDirList from '../../comfyTitlePopup/globalSettings/ModelsDirList.vue'
import StorageDirRow from './StorageDirRow.vue'
import BooleanToggle from './BooleanToggle.vue'
import ExtraModelPathsModal, { type ExtraModelPathSection } from './ExtraModelPathsModal.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import type { DetailField, DetailSection } from '../../types/ipc'

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

/** Canonicalize a path for comparison, matching the backend's `isSamePath`
 *  (`path.resolve` + case-insensitive on Windows) as closely as the renderer
 *  can without fs/cwd access: unify separators, collapse repeats, resolve
 *  `.`/`..` segments lexically, drop trailing separators, and ignore case on
 *  Windows. Renderer paths are already absolute (browse results,
 *  backend-computed defaults, stored dirs); a drive-relative form like
 *  `C:foo` needs the main process's per-drive cwd, so it is left as-is. */
function canonPath(p: string): string {
  const win = bridge?.platform === 'win32'
  const sep = win ? '\\' : '/'
  let rest = win ? p.replace(/\//g, '\\') : p
  // Drive-relative forms ("C:", "C:foo") resolve against the drive's cwd,
  // which only the main process knows: normalize case but leave segments.
  if (win && /^[a-zA-Z]:/.test(rest) && rest[2] !== '\\') {
    return rest.toLowerCase()
  }
  let root = ''
  let clampDepth = 0
  if (win) {
    if (rest.startsWith('\\\\')) {
      root = '\\\\'
      rest = rest.slice(2)
      clampDepth = 2 // \\server\share is the UNC root; ".." can't climb past it
    } else if (/^[a-zA-Z]:\\/.test(rest)) {
      root = rest.slice(0, 2) + '\\'
      rest = rest.slice(2)
    }
  } else if (rest.startsWith('/')) {
    root = '/'
  }
  const parts: string[] = []
  for (const seg of rest.split(sep)) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > clampDepth && parts[parts.length - 1] !== '..') parts.pop()
      else if (!root) parts.push('..')
      continue
    }
    parts.push(seg)
  }
  const out = root + parts.join(sep)
  return win ? out.toLowerCase() : out
}

/** Platform-aware path equality on canonicalized forms. */
function samePath(a: string, b: string): boolean {
  if (!a || !b) return false
  return canonPath(a) === canonPath(b)
}

/** Edits to these per-install fields trigger the restart prompt. */
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

/** Whether a path is the install's own models dir, which always renders as
 *  the dedicated locked row (mirroring the backend, which excludes it from
 *  launcher-managed dirs), never as a shared/extra row. */
function isOwnModelsDir(p: string): boolean {
  return installOwnModelsDir.value !== '' && samePath(p, installOwnModelsDir.value)
}

/** Global shared dir paths this instance includes; empty when the toggle is off. */
const includedSharedPaths = computed<string[]>(() =>
  useSharedModelsEnabled.value
    ? props.snapshot.modelsDirs.map((d) => d.path).filter((p) => !isOwnModelsDir(p))
    : []
)

/** Per-instance extras, hiding the install-own dir (it has its own locked row)
 *  and duplicates of an included shared dir (the backend dedupes the effective
 *  set the same way - shared dirs first), and collapsing repeated stored paths
 *  into one row (remove/replace already update every matching stored entry via
 *  `samePath`). */
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

/** Effective primary, mirroring the backend's `resolveLauncherModelDirs`: a
 *  persisted `modelDirsPrimary` naming the install's own models dir means the
 *  built-in folder is the explicit target (null); a persisted path present in
 *  the effective dirs wins; else the first included shared dir, else null
 *  (= the install's own models dir). */
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

/** Combined list with the primary on top: shared rows, then instance extras,
 *  then the locked install-own row (which leads only while it's the primary),
 *  then the read-only extra_model_paths.yaml row. */
const modelDirRows = computed<ModelsDir[]>(() => {
  const primary = effectivePrimary.value
  const own = installOwnModelsDir.value
  // The install-own row is always promotable: promoting it persists its own
  // path, which the backend reads as "built-in folder is the explicit target".
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
  // Persisting the row's path also covers the locked install-own row: the
  // backend treats its own models dir as "built-in folder is the target".
  persistField('modelDirsPrimary', row.path)
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

// Shared input/output dirs are read-only here; the manage action on their
// rows routes to Global Desktop Settings (same as the models link).
</script>

<template>
  <div class="storage-pane">
    <!-- Only shown when a change is pending; sharing scope is conveyed inline
         (shared badges, header toggles, manage actions), not by a banner. -->
    <div v-if="showRestartWarning" class="storage-note is-warning" role="status">
      <AlertTriangle :size="14" class="storage-note-icon" aria-hidden="true" />
      <p class="storage-note-text">
        {{
          t(
            'comfyUISettings.storageRestartNote',
            'Restart the application (or close and reopen) for these changes to take effect.'
          )
        }}
      </p>
    </div>

    <!-- Models group: one unified list. The header toggle only controls
         whether the global shared dirs are included (read-only rows); the
         per-instance dirs below it are always shown and editable. -->
    <GlobalSettingsMicroSection
      :title="t('settings.modelStorage', 'Models')"
      :tooltip="t('tooltips.instanceModels')"
    >
      <template v-if="useSharedModelsField" #actions>
        <label class="storage-header-toggle">
          <span>{{ t('comfyUISettings.includeSharedDirs', 'Include Shared Directories') }}</span>
          <InfoTooltip :text="t('tooltips.useSharedModels')" />
          <BooleanToggle
            :field="useSharedModelsField"
            @update="(v) => handleToggleField(useSharedModelsField, v)"
          />
        </label>
      </template>

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

    <!-- Input / Output: one compact section each, with the shared toggle
         inlined in the header. Shared rows are read-only (their manage action
         opens Global Desktop Settings); per-instance rows stay browsable. -->
    <GlobalSettingsMicroSection :title="t('settings.inputStorage', 'Input')">
      <template v-if="useSharedInputField" #actions>
        <label class="storage-header-toggle">
          <span>{{ t('common.useSharedFolder', 'Use Shared Folder') }}</span>
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
          :manageable="canManageSharedDirs"
          @open="handleOpenPath(sharedFieldPath(sharedInputField))"
          @manage="handleManageSharedDirs"
        />
      </template>
      <StorageDirRow
        v-else
        :path="effectiveInputDir"
        :tag="!inputOverridden ? t('models.default', 'default') : ''"
        :resettable="inputOverridden"
        @open="handleOpenPath(effectiveInputDir)"
        @browse="handleBrowseInputDir"
        @reset="handleResetInputDir"
      />
    </GlobalSettingsMicroSection>

    <GlobalSettingsMicroSection :title="t('settings.outputStorage', 'Output')">
      <template v-if="useSharedOutputField" #actions>
        <label class="storage-header-toggle">
          <span>{{ t('common.useSharedFolder', 'Use Shared Folder') }}</span>
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
          :manageable="canManageSharedDirs"
          @open="handleOpenPath(sharedFieldPath(sharedOutputField))"
          @manage="handleManageSharedDirs"
        />
      </template>
      <StorageDirRow
        v-else
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

/* Use-Shared-* toggle inlined in a section header (right-aligned there). */
.storage-header-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}

.storage-header-toggle > span {
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
