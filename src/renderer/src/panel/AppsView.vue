<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppsGallery from './AppsGallery.vue'
import AppsHost from './AppsHost.vue'
import TemplatesGallery from './TemplatesGallery.vue'
import { Search } from 'lucide-vue-next'
import BaseInput from '../components/ui/BaseInput.vue'
import ExploreFilter from './ExploreFilter.vue'
import ExploreViewOptions from './ExploreViewOptions.vue'
import type { CardSize, ExploreView, FilterGroup } from './exploreCards'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import { useAppsEnabled } from '../composables/useAppsEnabled'
import type { ExploreTab } from './exploreTab'
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
  obscured = false,
  initialTab = 'apps',
  launchApp = null
} = defineProps<{
  growBy?: number
  obscured?: boolean
  initialTab?: ExploreTab
  launchApp?: CatalogApp | null
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
const appsEnabled = useAppsEnabled()
const tab = ref<ExploreTab>(initialTab)
const shownTab = computed<ExploreTab>(() => (appsEnabled.value ? tab.value : 'templates'))
const visitedTabs = ref(new Set<ExploreTab>())
const tabOptions = computed(() => [
  { value: 'apps' as const, label: t('explore.apps') },
  { value: 'templates' as const, label: t('explore.templates') }
])
let pendingLaunch = launchApp

const views = ref<Record<ExploreTab, ExploreView>>({
  apps: { query: '', picks: {}, sort: 'recommended' },
  templates: { query: '', picks: {}, sort: 'recommended' }
})
const groups = ref<Record<ExploreTab, FilterGroup[]>>({ apps: [], templates: [] })
const cardSize = ref<CardSize>('medium')
const shownView = computed(() => views.value[shownTab.value])
function setView(patch: Partial<ExploreView>): void {
  views.value = { ...views.value, [shownTab.value]: { ...shownView.value, ...patch } }
}
function setGroups(on: ExploreTab, value: FilterGroup[]): void {
  groups.value = { ...groups.value, [on]: value }
}
const searchLabel = computed(() =>
  shownTab.value === 'apps' ? t('explore.searchApps') : t('explore.searchWorkflows')
)

watch(
  [appsEnabled, shownTab],
  ([enabled, shown]) => {
    if (enabled === null) return
    visitedTabs.value = new Set(visitedTabs.value).add(shown)
    if (!enabled) {
      openApp.value = null
      pendingLaunch = null
    } else if (pendingLaunch) {
      openCatalogApp(pendingLaunch)
      pendingLaunch = null
    }
  },
  { immediate: true }
)

watch(openApp, (app) => {
  if (!app) {
    appEntered.value = false
    closeAppOutputs()
  }
  emit('app-open', app !== null)
})
watch(appEntered, (entered) => emit('app-entered', entered))

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
        {{ t('explore.title') }}
      </h1>
    </header>
    <div
      v-if="!appFillsPage"
      class="mx-auto flex w-full max-w-300 items-center gap-3 px-10 py-3"
      data-testid="explore-toolbar"
    >
      <SegmentedControl
        v-if="appsEnabled"
        v-model="tab"
        :options="tabOptions"
        :label="t('explore.sections')"
        data-testid="explore-tabs"
      />
      <div class="ml-auto flex items-center gap-2">
        <ExploreFilter
          :model-value="shownView.picks"
          :groups="groups[shownTab]"
          @update:model-value="setView({ picks: $event })"
        />
        <div class="w-[220px]">
          <BaseInput
            :model-value="shownView.query"
            class="h-8 [&_input]:text-ui"
            :placeholder="searchLabel"
            :aria-label="searchLabel"
            data-testid="explore-search"
            @update:model-value="setView({ query: String($event ?? '') })"
          >
            <template #leading><Search :size="14" /></template>
          </BaseInput>
        </div>
        <ExploreViewOptions
          v-model:size="cardSize"
          :sort="shownView.sort"
          @update:sort="setView({ sort: $event })"
        />
      </div>
    </div>
    <AppsGallery
      v-if="visitedTabs.has('apps')"
      v-show="shownTab === 'apps' && !appFillsPage"
      :load-failed-url="loadFailedUrl"
      :view="views.apps"
      :size="cardSize"
      @open="openCatalogApp"
      @groups="setGroups('apps', $event)"
    />
    <TemplatesGallery
      v-if="visitedTabs.has('templates')"
      v-show="shownTab === 'templates'"
      :view="views.templates"
      :size="cardSize"
      @groups="setGroups('templates', $event)"
    />
  </div>
  <AppsHost
    v-if="openApp"
    :key="openApp.id"
    class="absolute inset-0"
    :url="openApp.url"
    :grow-by="growBy"
    :covered="appOutputs !== null"
    :backdrop="appOutputs?.backdropUrl ?? null"
    :obscured="obscured"
    @failed="appFailed"
    @outputs="showAppOutputs"
    @app-open="closeApp"
    @entered="appEntered = true"
  />
</template>
