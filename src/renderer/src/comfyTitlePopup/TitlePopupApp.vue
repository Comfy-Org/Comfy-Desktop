<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import MenuView from './MenuView.vue'
import DownloadsView from './DownloadsView.vue'
import DownloadsFullView from './DownloadsFullView.vue'
import InstancePickerView from './InstancePickerView.vue'
import GlobalSettingsView from './GlobalSettingsView.vue'
import ModalDialog from '../components/ModalDialog.vue'
import DialogHost from '../components/DialogHost.vue'
import { useModal } from '../composables/useModal'
import { dismissPickerModals } from './dismissPickerModals'
import { popupLocaleSource } from './pickerSettingsApiShim'
import { useAppLocale } from '../lib/useAppLocale'
import type { DetailSection, SnapshotListData } from '../types/ipc'
import type { PopupDownloadsState as DownloadsState } from '../../../preload/comfyTitlePopupPreload'

interface MenuItem {
  id?: string
  label?: string
  labelKey?: string
  kind?: 'separator'
}

interface PickerInstall {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  version?: string
  lastLaunchedAt?: number
  installPath?: string
  status?: string
  statusTag?: { style: string; label: string; detail?: string }
}

interface PickerStorageDir {
  path: string
  isPrimary: boolean
}

interface PickerStorageSlice {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: PickerStorageDir[]
  modelsSystemDefault: string
}

interface PickerSnapshot {
  installs: PickerInstall[]
  activeInstallationId: string | null
  runningInstallationIds: string[]
  launchingInstallationIds: string[]
  selectedInstallationId: string | null
  pickerSelectionEpoch?: number
  selectedSettings: DetailSection[] | null
  selectedSnapshots: SnapshotListData | null
  storage: PickerStorageSlice
}

interface GlobalSettingsModelsDir {
  path: string
  isPrimary: boolean
}

interface GlobalSettingsSnapshot {
  initialTab: 'general' | 'updates' | 'storage' | 'advanced' | 'logs' | null
  highlightFieldId: string | null
  generalFields: Record<string, unknown>[]
  languageFields: Record<string, unknown>[]
  telemetryFields: Record<string, unknown>[]
  desktopUpdateFields: Record<string, unknown>[]
  cacheFields: Record<string, unknown>[]
  advancedFields: Record<string, unknown>[]
  sharedDirectoriesFields: Record<string, unknown>[]
  installLocationFields: Record<string, unknown>[]
  modelsDirs: GlobalSettingsModelsDir[]
  modelsSystemDefault: string
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

type PopupConfig =
  | {
      kind: 'menu'
      items: MenuItem[]
      theme: { bg: string; text: string }
    }
  | {
      kind: 'downloads'
      theme: { bg: string; text: string }
    }
  | {
      kind: 'downloads-full'
      theme: { bg: string; text: string }
    }
  | {
      kind: 'instance-picker'
      snapshot: PickerSnapshot
      theme: { bg: string; text: string }
    }
  | {
      kind: 'global-settings'
      snapshot: GlobalSettingsSnapshot
      theme: { bg: string; text: string }
    }

interface Bridge {
  activate(id: string): void
  close(): void
  ready(): void
  notifyRendered(): void
  onConfig(cb: (config: PopupConfig) => void): () => void
  onDownloadsChanged(cb: (state: DownloadsState) => void): () => void
  onInstancePickerSnapshot(cb: (snapshot: PickerSnapshot) => void): () => void
  onGlobalSettingsSnapshot(cb: (snapshot: GlobalSettingsSnapshot) => void): () => void
  requestSize(height: number): void
  onWillShow(cb: (info: { kind: PopupConfig['kind'] }) => void): () => void
  onDismissModals(cb: () => void): () => void
}

const bridge = (window as unknown as { __comfyTitlePopup?: Bridge }).__comfyTitlePopup

const kind = ref<PopupConfig['kind']>('menu')
const items = ref<MenuItem[]>([])
const pickerSnapshot = ref<PickerSnapshot>({
  installs: [],
  activeInstallationId: null,
  runningInstallationIds: [],
  launchingInstallationIds: [],
  selectedInstallationId: null,
  pickerSelectionEpoch: 0,
  selectedSettings: null,
  selectedSnapshots: null,
  storage: { sharedDirectoriesFields: [], modelsDirs: [], modelsSystemDefault: '' }
})
const globalSettingsSnapshot = ref<GlobalSettingsSnapshot>({
  initialTab: null,
  highlightFieldId: null,
  generalFields: [],
  languageFields: [],
  telemetryFields: [],
  desktopUpdateFields: [],
  cacheFields: [],
  advancedFields: [],
  sharedDirectoriesFields: [],
  installLocationFields: [],
  modelsDirs: [],
  modelsSystemDefault: '',
  telemetryGranted: false,
  appUpdate: {
    state: { kind: null, version: null, autoUpdate: true },
    progress: null,
    isDownloading: false,
    capabilities: { systemManaged: false, canSelfUpdate: true },
    installedVersion: '',
    platform: 'darwin',
    lastCheckedAt: null
  },
  githubUrl: '',
  githubStars: null,
  githubStarsLoading: false,
  i18n: {
    overview: 'General',
    updates: 'Updates',
    storage: 'Storage',
    models: 'Models',
    advanced: 'Advanced',
    logs: 'Logs',
    sharedDirectories: 'Shared Directories'
  }
})
const downloadsState = ref<DownloadsState>({ active: [], recent: [] })

function handleActivate(id: string): void {
  bridge?.activate(id)
}

const { state: modalState } = useModal()

const { syncLocale } = useAppLocale(popupLocaleSource())

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (modalState.visible) return
  event.preventDefault()
  bridge?.close()
}

let unsubConfig: (() => void) | undefined
let unsubDownloads: (() => void) | undefined
let unsubInstancePicker: (() => void) | undefined
let unsubGlobalSettings: (() => void) | undefined
let unsubWillShow: (() => void) | undefined
let unsubDismissModals: (() => void) | undefined

let renderSeq = 0

function measureAndRequestSize(): void {
  if (kind.value === 'downloads') {
    const headEl = document.querySelector('.downloads-head') as HTMLElement | null
    const listEl = document.querySelector('.downloads-list, .downloads-empty') as HTMLElement | null
    const footEl = document.querySelector('.downloads-foot') as HTMLElement | null
    if (!footEl || !listEl) return
    let listH: number
    if (listEl.classList.contains('downloads-list')) {
      let childrenH = 0
      for (const child of listEl.children) {
        childrenH += (child as HTMLElement).offsetHeight
      }
      const cs = getComputedStyle(listEl)
      listH = childrenH + parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
    } else {
      listH = listEl.offsetHeight
    }
    const total = (headEl?.offsetHeight ?? 0) + listH + footEl.offsetHeight + 2
    bridge?.requestSize(total)
    return
  }
  if (kind.value === 'instance-picker') {
    const rootEl = document.querySelector('.picker') as HTMLElement | null
    if (!rootEl) return
    bridge?.requestSize(rootEl.offsetHeight + 2)
  }
}

onMounted(() => {
  void syncLocale()
  unsubConfig = bridge?.onConfig((cfg) => {
    if (cfg.kind === 'instance-picker') {
      dismissPickerModals()
    }
    kind.value = cfg.kind
    items.value = cfg.kind === 'menu' ? cfg.items : []
    if (cfg.kind === 'instance-picker') {
      pickerSnapshot.value = cfg.snapshot
    } else if (cfg.kind === 'global-settings') {
      globalSettingsSnapshot.value = cfg.snapshot
    }
    const seq = ++renderSeq
    void nextTick(() => {
      requestAnimationFrame(() => {
        if (seq !== renderSeq) return
        measureAndRequestSize()
        bridge?.notifyRendered()
      })
    })
  })
  unsubDownloads = bridge?.onDownloadsChanged((next) => {
    downloadsState.value = next
  })
  unsubInstancePicker = bridge?.onInstancePickerSnapshot((snapshot) => {
    pickerSnapshot.value = snapshot
  })
  unsubGlobalSettings = bridge?.onGlobalSettingsSnapshot((snapshot) => {
    globalSettingsSnapshot.value = snapshot
  })
  unsubWillShow = bridge?.onWillShow(({ kind: showKind }) => {
    if (showKind === 'instance-picker') return
    dismissPickerModals()
  })
  unsubDismissModals = bridge?.onDismissModals(() => {
    dismissPickerModals()
  })
  window.addEventListener('keydown', handleKeydown)
  bridge?.ready()
})

watch(
  downloadsState,
  () => {
    void nextTick(() => {
      requestAnimationFrame(() => {
        measureAndRequestSize()
      })
    })
  },
  { deep: true }
)
watch(
  pickerSnapshot,
  () => {
    void nextTick(() => {
      requestAnimationFrame(() => {
        measureAndRequestSize()
      })
    })
  },
  { deep: true }
)
onUnmounted(() => {
  unsubConfig?.()
  unsubDownloads?.()
  unsubInstancePicker?.()
  unsubGlobalSettings?.()
  unsubWillShow?.()
  unsubDismissModals?.()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    class="popup box-border m-0 h-full w-full overflow-hidden border border-solid border-border text-text select-none"
    :class="{
      'is-menu rounded-lg bg-popover text-xs': kind === 'menu',
      'rounded-card bg-neutral-800 [box-shadow:var(--shadow-highlight)]': kind !== 'menu',
      'is-picker': kind === 'instance-picker',
      'is-global-settings': kind === 'global-settings',
      'is-downloads-full': kind === 'downloads-full',
      'rounded-panel border-[var(--modal-surface-border)] bg-[var(--modal-surface-bg)]':
        kind === 'instance-picker' || kind === 'global-settings' || kind === 'downloads-full'
    }"
  >
    <MenuView v-if="kind === 'menu'" :items="items" @activate="handleActivate" />
    <DownloadsView v-else-if="kind === 'downloads'" :state="downloadsState" />
    <DownloadsFullView v-else-if="kind === 'downloads-full'" :state="downloadsState" />
    <InstancePickerView v-else-if="kind === 'instance-picker'" :snapshot="pickerSnapshot" />
    <GlobalSettingsView v-else :snapshot="globalSettingsSnapshot" />
    <ModalDialog />
    <DialogHost />
  </div>
</template>
