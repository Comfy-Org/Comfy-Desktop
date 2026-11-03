<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import Tabs from '@comfyorg/design-system/tabs/Tabs'
import TabsList from '@comfyorg/design-system/tabs/TabsList'
import TabsTrigger from '@comfyorg/design-system/tabs/TabsTrigger'
import TabsContent from '@comfyorg/design-system/tabs/TabsContent'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, HardDrive, RefreshCcw, Settings2, SlidersHorizontal, X } from 'lucide-vue-next'
import UpdatesSection from './globalSettings/UpdatesSection.vue'
import GlobalSettingsMicroSection from './globalSettings/GlobalSettingsMicroSection.vue'
import GlobalStorageSections from './globalSettings/GlobalStorageSections.vue'
import GitHubLinkCard from './globalSettings/GitHubLinkCard.vue'
import SettingsSectionList from '../views/comfyUISettings/SettingsSectionList.vue'
import StorageDirRow from '../views/comfyUISettings/StorageDirRow.vue'
import { withMinDuration } from '../lib/uiTiming'
import type {
  AppUpdateDownloadProgress,
  AppUpdateState,
  DetailField,
  DetailSection
} from '../types/ipc'

/**
 * Global Settings popup view — two-pane tabbed card (desktop-only).
 *
 * Receives a `snapshot` prop built main-side by `buildGlobalSettingsSnapshot`
 * in `src/main/popups/titlePopup.ts` and dispatches mutations through
 * `window.__comfyTitlePopup`.
 */

interface ModelsDir {
  path: string
  isPrimary: boolean
}

interface Snapshot {
  /** Tab to land on; non-null only on the open push (rebroadcasts carry
   *  null so live data refreshes never retarget the user's tab). */
  initialTab?: 'general' | 'updates' | 'storage' | 'advanced' | 'logs' | null
  /** Field id to scroll to and flash; same per-open semantics as
   *  `initialTab`, so rebroadcasts (which carry null) never re-flash. */
  highlightFieldId?: string | null
  languageFields: Record<string, unknown>[]
  generalFields: Record<string, unknown>[]
  telemetryFields: Record<string, unknown>[]
  desktopUpdateFields: Record<string, unknown>[]
  cacheFields: Record<string, unknown>[]
  advancedFields: Record<string, unknown>[]
  sharedDirectoriesFields: Record<string, unknown>[]
  installLocationFields: Record<string, unknown>[]
  modelsDirs: ModelsDir[]
  modelsSystemDefault: string
  /** Explicit telemetry consent. Gates opting into beta features. */
  telemetryGranted: boolean
  appUpdate: {
    state: Record<string, unknown>
    progress: Record<string, unknown> | null
    isDownloading: boolean
    capabilities: { systemManaged: boolean; canSelfUpdate: boolean }
    installedVersion: string
    platform: string
    lastCheckedAt: number | null
  }
  githubUrl: string
  githubStars: number | null
  githubStarsLoading: boolean
  i18n: {
    overview: string
    updates: string
    storage: string
    models: string
    advanced: string
    logs: string
    sharedDirectories: string
  }
}

interface GlobalSettingsBridge {
  close(): void
  globalSettingsUpdateField(
    fieldId: string,
    value: unknown
  ): Promise<{ ok: boolean; message?: string }>
  globalSettingsBrowseFolder(defaultPath?: string): Promise<string | null>
  globalSettingsOpenPath(path: string): void
  globalSettingsOpenLogsFolder(): void
  globalSettingsOpenExternal(url: string): void
  globalSettingsSetModelsDirs(dirs: string[]): Promise<{ ok: boolean }>
  globalSettingsCheckForUpdate(): Promise<{ available: boolean; version?: string; error?: string }>
  globalSettingsDownloadUpdate(): Promise<void>
  globalSettingsInstallUpdate(): void
  globalSettingsSetLastCheckedAt(value: number): void
}

const props = defineProps<{ snapshot: Snapshot }>()
const { t } = useI18n()
const bridge = (window as unknown as { __comfyTitlePopup?: GlobalSettingsBridge }).__comfyTitlePopup

const LAST_CHECKED_KEY = 'globalSettings.lastCheckedAt'

type TabId = 'general' | 'updates' | 'storage' | 'advanced' | 'logs'
const activeTab = ref<TabId>('general')

// Each open pushes a fresh snapshot object, so watching by identity lets a
// reopen re-apply its requested tab. Rebroadcasts carry initialTab null and
// are ignored, so a live refresh never yanks the user off their tab.
watch(
  () => props.snapshot,
  (snap) => {
    if (snap.initialTab) activeTab.value = snap.initialTab
    if (snap.highlightFieldId) void flashField(snap.highlightFieldId)
  },
  { immediate: true }
)

/** How long the flashed row keeps its ring. Long enough to catch the eye after
 *  the scroll settles, short enough that the row is back to normal before the
 *  user reaches for it. */
const HIGHLIGHT_MS = 2200
let highlightTimer: ReturnType<typeof setTimeout> | null = null
/** The element the live timer belongs to, so a second flash can strip the class off the first
 *  rather than leaving it ringed — which matters under `prefers-reduced-motion`, where the
 *  class holds a static ring instead of a finishing animation. */
let highlightEl: HTMLElement | null = null

function clearHighlight(): void {
  if (highlightTimer !== null) clearTimeout(highlightTimer)
  highlightTimer = null
  highlightEl?.classList.remove('gs-field-flash')
  highlightEl = null
}

onUnmounted(clearHighlight)

/**
 * Scroll a settings row into view and flash it.
 *
 * Deep links land on a tab, not a control, and the Privacy rows sit well below
 * the fold on the General tab — so "we opened Settings for you" can still leave
 * the user hunting. Queried from the document rather than a template ref
 * because the rows are rendered by `SettingsSectionList` several components down,
 * which exposes them only as `data-field-id`.
 */
async function flashField(fieldId: string): Promise<void> {
  // Two ticks: the first flushes the tab switch this same watch may have just
  // requested, the second the field list that tab renders.
  await nextTick()
  await nextTick()
  const el = document.querySelector(`[data-field-id="${CSS.escape(fieldId)}"]`)
  if (!(el instanceof HTMLElement)) return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
  clearHighlight()
  // Re-added rather than toggled so a second flash of the same row restarts the
  // animation instead of being swallowed as "class already present".
  el.classList.remove('gs-field-flash')
  void el.offsetWidth
  el.classList.add('gs-field-flash')
  // Keyboard focus follows the link to the control it points at, instead of dropping to <body>
  // when the popup swaps to this view.
  el.querySelector<HTMLElement>('button, input, select, textarea')?.focus({ preventScroll: true })
  highlightEl = el
  highlightTimer = setTimeout(() => {
    el.classList.remove('gs-field-flash')
    highlightTimer = null
    highlightEl = null
  }, HIGHLIGHT_MS)
}

const tabs = computed(() => [
  { id: 'general' as const, label: props.snapshot.i18n.overview, icon: Settings2 },
  { id: 'updates' as const, label: props.snapshot.i18n.updates, icon: RefreshCcw },
  { id: 'storage' as const, label: props.snapshot.i18n.storage, icon: HardDrive },
  { id: 'advanced' as const, label: props.snapshot.i18n.advanced, icon: SlidersHorizontal },
  { id: 'logs' as const, label: props.snapshot.i18n.logs, icon: FileText }
])

const storageSnapshot = computed(() => ({
  sharedDirectoriesFields: props.snapshot.sharedDirectoriesFields,
  modelsDirs: props.snapshot.modelsDirs,
  modelsSystemDefault: props.snapshot.modelsSystemDefault
}))

const languageSections = computed<DetailSection[]>(() => [
  { fields: props.snapshot.languageFields as unknown as DetailField[] }
])
const generalSections = computed<DetailSection[]>(() => [
  { fields: props.snapshot.generalFields as unknown as DetailField[] }
])
/** Opting in is gated on telemetry consent (opting *out* never is), and consent
 *  is live snapshot state rather than a property of the settings field — so the
 *  gate is derived here instead of main-side, where `toDetailField` would have
 *  to learn about it. */
const BETA_FEATURES_FIELD_ID = 'betaFeaturesEnabled'
const telemetrySections = computed<DetailSection[]>(() => [
  {
    fields: (props.snapshot.telemetryFields as unknown as DetailField[]).map((field) =>
      field.id === BETA_FEATURES_FIELD_ID
        ? {
            ...field,
            turnOnDisabled: !props.snapshot.telemetryGranted,
            turnOnDisabledTooltipKey: 'tooltips.betaFeaturesNeedTelemetry'
          }
        : field
    )
  }
])
const desktopUpdatePreferenceFields = computed<DetailField[]>(
  () => props.snapshot.desktopUpdateFields as unknown as DetailField[]
)
/** The cache directory path field, rendered as a readonly path row (same UI as
 *  the shared input/output dirs) instead of a generic textbox. */
const cacheDirField = computed<DetailField | undefined>(() => {
  const fields = props.snapshot.cacheFields as unknown as DetailField[]
  return fields.find((f) => f.id === 'cacheDir') ?? fields[0]
})

function fieldPath(field: DetailField | undefined): string {
  return typeof field?.value === 'string' ? field.value : ''
}

async function handleBrowseCacheDir(): Promise<void> {
  const field = cacheDirField.value
  if (!field) return
  const picked = await bridge?.globalSettingsBrowseFolder(fieldPath(field) || undefined)
  if (!picked || picked === field.value) return
  await bridge?.globalSettingsUpdateField(field.id, picked)
}

function handleOpenCacheDir(): void {
  handleOpenPath(fieldPath(cacheDirField.value))
}
const advancedSections = computed<DetailSection[]>(() => [
  { fields: props.snapshot.advancedFields as unknown as DetailField[] }
])

/** The default install-location path field, rendered as a readonly path row
 *  (same UI as the cache + shared input/output dirs) instead of a textbox. */
const installDirField = computed<DetailField | undefined>(() => {
  const fields = props.snapshot.installLocationFields as unknown as DetailField[]
  return fields.find((f) => f.id === 'installDir') ?? fields[0]
})

async function handleBrowseInstallDir(): Promise<void> {
  const field = installDirField.value
  if (!field) return
  const picked = await bridge?.globalSettingsBrowseFolder(fieldPath(field) || undefined)
  if (!picked || picked === field.value) return
  await bridge?.globalSettingsUpdateField(field.id, picked)
}

function handleOpenInstallDir(): void {
  handleOpenPath(fieldPath(installDirField.value))
}

function handleOpenPath(path: string): void {
  if (path) bridge?.globalSettingsOpenPath(path)
}
const appUpdateState = computed<AppUpdateState>(
  () => props.snapshot.appUpdate.state as unknown as AppUpdateState
)
const appUpdateProgress = computed<AppUpdateDownloadProgress | null>(
  () => props.snapshot.appUpdate.progress as unknown as AppUpdateDownloadProgress | null
)

async function handleUpdateField(field: DetailField, value: unknown): Promise<void> {
  await bridge?.globalSettingsUpdateField(field.id, value)
}

function handleOpenExternal(url: string): void {
  if (!url) return
  bridge?.globalSettingsOpenExternal(url)
}

function handleOpenLogsFolder(): void {
  bridge?.globalSettingsOpenLogsFolder()
}

async function handleUpdateNow(): Promise<void> {
  const kind = (appUpdateState.value as AppUpdateState).kind
  if (kind === 'ready') {
    bridge?.globalSettingsInstallUpdate()
    return
  }
  if (kind === 'available') {
    await bridge?.globalSettingsDownloadUpdate()
    return
  }
  await handleCheckForUpdate()
}

const isChecking = ref(false)

async function handleCheckForUpdate(): Promise<void> {
  isChecking.value = true
  try {
    // Floor the busy state so a sub-frame response still flashes "Checking…".
    await withMinDuration(async () => {
      await bridge?.globalSettingsCheckForUpdate()
    })
  } finally {
    const now = Date.now()
    try {
      window.localStorage.setItem(LAST_CHECKED_KEY, String(now))
    } catch {
      /* noop */
    }
    bridge?.globalSettingsSetLastCheckedAt(now)
    isChecking.value = false
  }
}

onMounted(() => {
  if (!props.snapshot.appUpdate.lastCheckedAt) {
    try {
      const raw = window.localStorage.getItem(LAST_CHECKED_KEY)
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) bridge?.globalSettingsSetLastCheckedAt(n)
      }
    } catch {
      /* noop */
    }
  }
})
</script>

<template>
  <div
    class="global-settings flex size-full flex-col text-[14px] text-neutral-100 [&_.ui-input]:min-h-7 [&_.ui-input]:rounded-md [&_.ui-select-trigger]:min-h-7 [&_.ui-select-trigger]:rounded-md [&_.ui-select-trigger]:text-[13px] [&_.ui-input-control]:text-[13px] [&_.ui-input-trailing_button]:size-[26px]"
  >
    <header
      class="gs-header flex flex-none items-center justify-between border-b border-solid border-border py-2.5 pr-3 pl-5"
    >
      <h2 class="gs-title m-0 font-sans text-[length:var(--text-heading)] font-semibold text-text">
        {{ t('settingsModal.tabGlobal', 'Desktop Settings') }}
      </h2>
      <Button
        type="button"
        variant="textonly"
        size="icon"
        class="gs-close shrink-0"
        :aria-label="t('common.close', 'Close')"
        @click="bridge?.close()"
      >
        <X :size="16" aria-hidden="true" />
      </Button>
    </header>

    <Tabs
      v-model="activeTab"
      orientation="vertical"
      class="gs-body min-h-0 flex-auto flex-row gap-0"
    >
      <TabsList
        class="gs-tabs w-40 flex-[0_0_160px] flex-col items-stretch gap-px overflow-y-auto border-r border-solid border-border p-2"
        :aria-label="t('settingsModal.tabGlobal', 'Desktop Settings')"
      >
        <TabsTrigger
          v-for="tab in tabs"
          :key="tab.id"
          :value="tab.id"
          class="gs-tab justify-start text-left"
          :class="{ active: activeTab === tab.id }"
        >
          <component :is="tab.icon" :size="14" aria-hidden="true" />
          <span>{{ tab.label }}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent
        :key="activeTab"
        :value="activeTab"
        class="gs-pane flex min-w-0 flex-auto flex-col gap-2.5 overflow-y-auto px-3 py-2 [&_.settings-v2-sections]:gap-2 [&_.settings-v2-section]:gap-1 [&_.settings-v2-boolean-row]:min-h-7 [&_.settings-v2-boolean-row]:p-0 [&_.settings-v2-field]:gap-1 [&_.gs-field-flash]:rounded-md [&_.gs-field-flash]:animate-[gs-field-flash_2.2s_ease-out] motion-reduce:[&_.gs-field-flash]:animate-none motion-reduce:[&_.gs-field-flash]:shadow-[0_0_0_2px_var(--accent)]"
      >
        <template v-if="activeTab === 'general'">
          <!-- Locale picker first, no microsection header — it's a single
               control and the lone "Language" label on it is enough. -->
          <SettingsSectionList
            :sections="languageSections"
            @update-field="handleUpdateField"
            @open-path="handleOpenPath"
          />

          <GlobalSettingsMicroSection :title="t('settings.appBehavior', 'App Behavior')">
            <SettingsSectionList
              :sections="generalSections"
              @update-field="handleUpdateField"
              @open-path="handleOpenPath"
            />
          </GlobalSettingsMicroSection>

          <GlobalSettingsMicroSection :title="t('settings.privacy', 'Privacy')">
            <SettingsSectionList
              :sections="telemetrySections"
              @update-field="handleUpdateField"
              @open-path="handleOpenPath"
            />
          </GlobalSettingsMicroSection>

          <GlobalSettingsMicroSection :title="t('settings.community', 'Community')">
            <GitHubLinkCard
              :url="snapshot.githubUrl"
              :stars="snapshot.githubStars"
              :loading="snapshot.githubStarsLoading"
              @open="handleOpenExternal"
            />
          </GlobalSettingsMicroSection>
        </template>

        <template v-else-if="activeTab === 'updates'">
          <UpdatesSection
            :state="appUpdateState"
            :progress="appUpdateProgress"
            :is-downloading="snapshot.appUpdate.isDownloading"
            :checking="isChecking"
            :last-checked-at="snapshot.appUpdate.lastCheckedAt"
            :installed-version="snapshot.appUpdate.installedVersion"
            :system-managed="snapshot.appUpdate.capabilities.systemManaged"
            :preference-fields="desktopUpdatePreferenceFields"
            @update-now="handleUpdateNow"
            @check-for-update="handleCheckForUpdate"
            @update-field="handleUpdateField"
            @open-path="handleOpenPath"
          />
        </template>

        <template v-else-if="activeTab === 'storage'">
          <GlobalStorageSections :snapshot="storageSnapshot" />
        </template>

        <template v-else-if="activeTab === 'advanced'">
          <GlobalSettingsMicroSection
            :title="t('settings.installLocation', 'Default Install Location')"
            :tooltip="t('tooltips.installDir')"
          >
            <StorageDirRow
              v-if="installDirField"
              :label="installDirField.label"
              :path="fieldPath(installDirField)"
              @open="handleOpenInstallDir"
              @browse="handleBrowseInstallDir"
            />
          </GlobalSettingsMicroSection>

          <GlobalSettingsMicroSection :title="snapshot.i18n.advanced">
            <SettingsSectionList
              :sections="advancedSections"
              @update-field="handleUpdateField"
              @open-path="handleOpenPath"
            />
          </GlobalSettingsMicroSection>

          <GlobalSettingsMicroSection :title="t('settings.cache', 'Cache')">
            <StorageDirRow
              v-if="cacheDirField"
              :label="cacheDirField.label || t('settings.cacheDir', 'Cache Directory')"
              :path="fieldPath(cacheDirField)"
              @open="handleOpenCacheDir"
              @browse="handleBrowseCacheDir"
            />
          </GlobalSettingsMicroSection>
        </template>

        <template v-else-if="activeTab === 'logs'">
          <GlobalSettingsMicroSection :title="t('settings.diagnostics', 'Diagnostics')">
            <Button
              type="button"
              variant="secondary"
              size="md"
              class="gs-logs-btn"
              @click="handleOpenLogsFolder"
            >
              <FileText :size="14" aria-hidden="true" />
              <span>{{ t('settings.openLogsFolder', 'Open logs folder') }}</span>
            </Button>
          </GlobalSettingsMicroSection>
        </template>
      </TabsContent>
    </Tabs>
  </div>
</template>

<style>
/* Deep-linked controls keep their timed highlight without affecting layout. */
@keyframes gs-field-flash {
  0%,
  55% {
    box-shadow: 0 0 0 2px var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  100% {
    box-shadow: 0 0 0 2px transparent;
    background: transparent;
  }
}
</style>
