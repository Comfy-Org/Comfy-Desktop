<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppsGallery from './AppsGallery.vue'
import AppsHost from './AppsHost.vue'
import OutputDetailDialog from './OutputDetailDialog.vue'
import type { OutputDetailItem } from './OutputDetailDialog.vue'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import type { AppOutputAction, AppOutputs, AssetKind, CatalogApp } from '../types/ipc'

interface ShownAppOutputs {
  items: OutputDetailItem[]
  backdropUrl: string | null
}

const {
  growBy = 0,
  sidebarMenuOpen = false,
  obscured = false
} = defineProps<{
  growBy?: number
  sidebarMenuOpen?: boolean
  obscured?: boolean
}>()

const emit = defineEmits<{
  'app-open': [open: boolean]
  'app-entered': [entered: boolean]
  'view-in-assets': [name: string]
}>()

const { t } = useI18n()
const loadFailedUrl = ref<string | null>(null)
const openApp = ref<CatalogApp | null>(null)
const appEntered = ref(false)
const appOutputs = ref<ShownAppOutputs | null>(null)
const appOutputIndex = ref(0)
const appOutputsShown = ref(0)

watch(openApp, (app) => {
  if (!app) {
    appEntered.value = false
    closeAppOutputs()
  }
  emit('app-open', app !== null)
})
watch(appEntered, (entered) => emit('app-entered', entered))

const sidebarBackdropUrl = ref<string | null>(null)
const coveredBySidebar = ref(false)
let sidebarCoverRequest = 0

function releaseSidebarBackdrop(): void {
  if (sidebarBackdropUrl.value) URL.revokeObjectURL(sidebarBackdropUrl.value)
  sidebarBackdropUrl.value = null
}

watch(
  () => sidebarMenuOpen && openApp.value !== null,
  async (cover) => {
    const request = ++sidebarCoverRequest
    if (!cover) {
      coveredBySidebar.value = false
      releaseSidebarBackdrop()
      return
    }
    const backdrop = await window.api.captureApps().catch(() => null)
    if (request !== sidebarCoverRequest) return
    releaseSidebarBackdrop()
    if (backdrop) {
      sidebarBackdropUrl.value = URL.createObjectURL(new Blob([backdrop], { type: 'image/jpeg' }))
    }
    coveredBySidebar.value = true
  }
)

const appFillsPage = computed(() => openApp.value !== null && appEntered.value)

function openCatalogApp(app: CatalogApp): void {
  loadFailedUrl.value = null
  openApp.value = app
}

function closeApp(open: boolean): void {
  if (!open) openApp.value = null
}

function appFailed(url: string): void {
  openApp.value = null
  loadFailedUrl.value = url
}

function outputKind(mimeType: string): AssetKind | null {
  const kind = mimeType.split('/')[0]
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null
}

function showAppOutputs(outputs: AppOutputs): void {
  closeAppOutputs()
  appOutputs.value = {
    items: outputs.items.map((output, i) => ({
      key: `${i}:${output.name}`,
      name: output.name,
      kind: outputKind(output.mimeType),
      sizeBytes: output.bytes.byteLength,
      createdAt: null,
      tags: output.tags,
      previewUrl: URL.createObjectURL(new Blob([output.bytes], { type: output.mimeType })),
      workflow: output.workflow,
      savedIn: output.savedOn === 'computer' ? (output.folder ?? null) : null,
      inCloud: output.savedOn === 'cloud'
    })),
    backdropUrl: outputs.backdrop
      ? URL.createObjectURL(new Blob([outputs.backdrop], { type: 'image/jpeg' }))
      : null
  }
  appOutputIndex.value = outputs.index
  appOutputsShown.value++
}

function closeAppOutputs(): void {
  const shown = appOutputs.value
  if (!shown) return
  appOutputs.value = null
  void nextTick(() => {
    for (const item of shown.items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    if (shown.backdropUrl) URL.revokeObjectURL(shown.backdropUrl)
  })
}

function appOutputAction(action: AppOutputAction['action'], index: number): void {
  window.api.appsOutputAction({ action, index })
  if (action === 'open-workflow') closeAppOutputs()
}

function viewInAssets(index: number): void {
  const name = appOutputs.value?.items[index]?.name
  closeAppOutputs()
  if (name) emit('view-in-assets', name)
}

onBeforeUnmount(() => {
  sidebarCoverRequest++
  releaseSidebarBackdrop()
  closeAppOutputs()
  if (openApp.value) emit('app-open', false)
  if (appEntered.value) emit('app-entered', false)
})
</script>

<template>
  <OutputDetailDialog
    v-if="appOutputs"
    :key="appOutputsShown"
    v-model:index="appOutputIndex"
    :items="appOutputs.items"
    @close="closeAppOutputs"
    @download="appOutputAction('download', $event)"
    @open-workflow="appOutputAction('open-workflow', $event)"
    @show-in-folder="appOutputAction('show-in-folder', $event)"
    @view-in-assets="viewInAssets"
  />
  <div
    class="flex min-h-0 w-full flex-auto flex-col overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="apps-view"
  >
    <header v-if="!appFillsPage" class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
      <h1 class="m-0 font-display text-display font-semibold text-foreground">
        {{ t('sidebar.apps') }}
      </h1>
    </header>
    <AppsGallery v-show="!appFillsPage" :load-failed-url="loadFailedUrl" @open="openCatalogApp" />
  </div>
  <AppsHost
    v-if="openApp"
    :key="openApp.id"
    class="absolute inset-0"
    :url="openApp.url"
    :grow-by="growBy"
    :covered="appOutputs !== null || coveredBySidebar"
    :backdrop="appOutputs?.backdropUrl ?? sidebarBackdropUrl"
    :obscured="obscured"
    @failed="appFailed"
    @outputs="showAppOutputs"
    @app-open="closeApp"
    @entered="appEntered = true"
  />
</template>
