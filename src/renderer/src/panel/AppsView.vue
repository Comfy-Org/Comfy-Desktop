<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalStorage, useScroll } from '@vueuse/core'
import { DropdownMenuRadioGroup } from 'reka-ui'
import {
  AudioLines,
  Box,
  Check,
  Download,
  Ellipsis,
  File,
  LayoutGrid,
  LayoutDashboard,
  ListFilter,
  Play,
  RefreshCw,
  Search,
  ZoomIn
} from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import BaseInput from '../components/ui/BaseInput.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import AppsGallery from './AppsGallery.vue'
import AppsHost from './AppsHost.vue'
import OutputDetailDialog from './OutputDetailDialog.vue'
import type { OutputDetailItem } from './OutputDetailDialog.vue'
import { useModal } from '../composables/useModal'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { formatBytes } from '../lib/downloadFormatters'
import { formatRelativeFromMs } from '../lib/datetime'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import type {
  AppOutputAction,
  AppOutputs,
  AssetKind,
  AssetSummary,
  CatalogApp,
  Installation
} from '../types/ipc'

interface GalleryAsset extends AssetSummary {
  installationId: string
  buildName: string
}

interface ShownAppOutputs {
  items: OutputDetailItem[]
  backdropUrl: string | null
}

type AppsTab = 'all' | 'files'
type KindFilter = 'all' | AssetKind
type Layout = 'masonry' | 'grid'
type SortOrder = 'newest' | 'oldest'

const SKELETON_COUNT = 8
const NAME_TOOLTIP_DELAY_MS = 600

const { t } = useI18n()
const modal = useModal()
const authStore = useAuthStore()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()

const tab = useLocalStorage<AppsTab>('comfy.desktop.apps.tab', 'all')
const appsLoadFailedUrl = ref<string | null>(null)
const { growBy = 0 } = defineProps<{
  growBy?: number
}>()
const openApp = ref<CatalogApp | null>(null)
const appEntered = ref(false)
const emit = defineEmits<{
  'app-open': [open: boolean]
  'app-entered': [entered: boolean]
}>()
watch(openApp, (app) => {
  if (!app) appEntered.value = false
  emit('app-open', app !== null)
})
watch(appEntered, (entered) => emit('app-entered', entered))
watch(tab, (next) => {
  if (next === 'all') appsLoadFailedUrl.value = null
  else openApp.value = null
})
const appFillsPage = computed(
  () => tab.value === 'all' && openApp.value !== null && appEntered.value
)

function openCatalogApp(app: CatalogApp): void {
  appsLoadFailedUrl.value = null
  openApp.value = app
}

function closeApp(open: boolean): void {
  if (!open) openApp.value = null
}

function appFailed(url: string): void {
  openApp.value = null
  appsLoadFailedUrl.value = url
}
const kindFilter = ref<KindFilter>('all')
const searchQuery = ref('')
const signingIn = ref(false)
const layout = useLocalStorage<Layout>('comfy.desktop.assets.layout', 'masonry')
const sortOrder = useLocalStorage<SortOrder>('comfy.desktop.assets.sort', 'newest')
const showName = useLocalStorage('comfy.desktop.assets.showName', false)
const showDetails = useLocalStorage('comfy.desktop.assets.showDetails', false)

const assets = ref<GalleryAsset[]>([])
const detailKey = ref<string | null>(null)
const cardMenuOpenKey = ref<string | null>(null)
const appOutputs = ref<ShownAppOutputs | null>(null)
const appOutputIndex = ref(0)
const scroller = useTemplateRef<HTMLElement>('scroller')
const { y: scrollTop } = useScroll(scroller)
const nameTooltipsWarm = ref(false)
let warmTimer: ReturnType<typeof setTimeout> | undefined
const loading = ref(false)
const failed = ref(false)

function isCloudBuild(inst: Installation): boolean {
  return inst.sourceCategory === 'cloud'
}

function isReachable(inst: Installation): boolean {
  return isCloudBuild(inst) ? authStore.isSignedIn : sessionStore.isRunning(inst.id)
}

const reachableBuildIds = computed(() => {
  const reachable = installationStore.installations.filter(isReachable)
  const accountCloud = reachable.find(isCloudBuild)
  return reachable.filter((b) => !isCloudBuild(b) || b === accountCloud).map((b) => b.id)
})

const kindOptions = computed(() => [
  { value: 'all' as const, label: t('assets.kind.all') },
  { value: 'image' as const, label: t('assets.kind.image') },
  { value: 'video' as const, label: t('assets.kind.video') },
  { value: '3d' as const, label: t('assets.kind.3d') },
  { value: 'audio' as const, label: t('assets.kind.audio') }
])
const tabOptions = computed(() => [
  { value: 'all' as const, label: t('apps.tabs.all') },
  { value: 'files' as const, label: t('apps.tabs.files') }
])
const filterLabel = computed(() =>
  kindFilter.value === 'all'
    ? t('assets.filter')
    : (kindOptions.value.find((option) => option.value === kindFilter.value)?.label ?? '')
)
const layoutOptions = computed(() => [
  { value: 'masonry' as const, label: t('assets.layout.masonry'), icon: LayoutDashboard },
  { value: 'grid' as const, label: t('assets.layout.grid'), icon: LayoutGrid }
])
const sortOptions = computed(() => [
  { value: 'newest' as const, label: t('assets.sort.newest') },
  { value: 'oldest' as const, label: t('assets.sort.oldest') }
])

function createdMs(asset: AssetSummary): number {
  return asset.createdAt ? Date.parse(asset.createdAt) || 0 : 0
}

function cardKey(asset: GalleryAsset): string {
  return `${asset.installationId}:${asset.id}`
}

const layoutClass = computed(() =>
  layout.value === 'masonry'
    ? 'columns-[200px] gap-4 [&>li]:mb-4 [&>li]:break-inside-avoid'
    : 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-0.5'
)

const visibleAssets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const filtered = assets.value.filter(
    (asset) =>
      (kindFilter.value === 'all' || asset.kind === kindFilter.value) &&
      (!query || asset.name.toLowerCase().includes(query))
  )
  const direction = sortOrder.value === 'newest' ? -1 : 1
  return filtered.toSorted((a, b) => direction * (createdMs(a) - createdMs(b)))
})

interface EmptyState {
  title: string
  body: string
  action?: { label: string; run: () => void }
}

const emptyState = computed<EmptyState>(() => {
  if (failed.value) return { title: t('assets.loadFailed'), body: '' }
  if (assets.value.length > 0) {
    return { title: t('assets.noMatches'), body: t('assets.noMatchesHint') }
  }
  if (!authStore.isSignedIn) {
    return {
      title: t('assets.signedOutTitle'),
      body: t('assets.signedOutBody'),
      action: { label: t('assets.signIn'), run: () => void signIn() }
    }
  }
  return {
    title: t('assets.emptyTitle'),
    body: t('assets.emptyBody'),
    action: { label: t('assets.browseApps'), run: () => (tab.value = 'all') }
  }
})

let requestId = 0
async function loadAssets(): Promise<void> {
  const current = ++requestId
  loading.value = true
  failed.value = false
  try {
    const ids = reachableBuildIds.value
    const results = await Promise.allSettled(ids.map((id) => window.api.listAssets(id)))
    if (current !== requestId) return
    assets.value = results.flatMap((result, i) => {
      if (result.status === 'rejected') return []
      const installationId = ids[i]!
      const buildName = installationStore.getById(installationId)?.name ?? ''
      return result.value.map((asset) => ({ ...asset, installationId, buildName }))
    })
    failed.value = results.length > 0 && results.every((r) => r.status === 'rejected')
  } finally {
    if (current === requestId) loading.value = false
  }
}

watch(
  () => [tab.value, ...reachableBuildIds.value, authStore.status.workspaceId ?? ''].join('\n'),
  () => {
    if (tab.value === 'files') void loadAssets()
  },
  { immediate: true }
)
watch(visibleAssets, (list) => {
  if (detailKey.value !== null && !list.some((asset) => cardKey(asset) === detailKey.value))
    detailKey.value = null
})
const detailIndex = computed<number | null>({
  get: () => {
    if (detailKey.value === null) return null
    const index = visibleAssets.value.findIndex((asset) => cardKey(asset) === detailKey.value)
    return index >= 0 ? index : null
  },
  set: (index) => {
    const asset = index === null ? undefined : visibleAssets.value[index]
    detailKey.value = asset ? cardKey(asset) : null
  }
})

function warmNameTooltips(): void {
  clearTimeout(warmTimer)
  warmTimer = setTimeout(() => (nameTooltipsWarm.value = true), NAME_TOOLTIP_DELAY_MS)
}

function coolNameTooltips(): void {
  clearTimeout(warmTimer)
  nameTooltipsWarm.value = false
}

const fileItems = computed<OutputDetailItem[]>(() =>
  visibleAssets.value.map((asset) => ({
    key: cardKey(asset),
    name: asset.name,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
    tags: asset.tags,
    previewUrl: asset.previewUrl,
    workflow: null
  }))
)

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
      workflow: output.workflow
    })),
    backdropUrl: outputs.backdrop
      ? URL.createObjectURL(new Blob([outputs.backdrop], { type: 'image/jpeg' }))
      : null
  }
  appOutputIndex.value = outputs.index
}

function closeAppOutputs(): void {
  const shown = appOutputs.value
  if (!shown) return
  for (const item of shown.items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  if (shown.backdropUrl) URL.revokeObjectURL(shown.backdropUrl)
  appOutputs.value = null
}

function appOutputAction(action: AppOutputAction['action'], index: number): void {
  window.api.appsOutputAction({ action, index })
  if (action === 'open-workflow') closeAppOutputs()
}

onBeforeUnmount(() => {
  clearTimeout(warmTimer)
  closeAppOutputs()
})

async function signIn(): Promise<void> {
  if (signingIn.value) return
  signingIn.value = true
  try {
    await authStore.signIn()
  } catch {
    return
  } finally {
    signingIn.value = false
  }
}

function openDetail(asset: GalleryAsset): void {
  detailKey.value = cardKey(asset)
}

async function closeDetail(): Promise<void> {
  const viewedKey = detailKey.value ?? ''
  detailKey.value = null
  await nextTick()
  scroller.value?.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(viewedKey)}"]`)?.focus()
}

async function download(asset: GalleryAsset): Promise<void> {
  try {
    await window.api.downloadAsset(asset.installationId, asset.id, asset.name)
  } catch {
    await modal.alert({ title: t('assets.downloadFailed'), message: asset.name })
  }
}

function assetDetails(asset: AssetSummary): string {
  return [
    asset.createdAt ? formatRelativeFromMs(Date.parse(asset.createdAt), t) : null,
    asset.sizeBytes === null ? null : formatBytes(asset.sizeBytes)
  ]
    .filter(Boolean)
    .join(' · ')
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}
</script>

<template>
  <OutputDetailDialog
    v-if="detailIndex !== null && visibleAssets.length > 0"
    v-model:index="detailIndex"
    :items="fileItems"
    @close="closeDetail"
    @download="download(visibleAssets[$event]!)"
  />
  <OutputDetailDialog
    v-if="appOutputs"
    v-model:index="appOutputIndex"
    :items="appOutputs.items"
    @close="closeAppOutputs"
    @download="appOutputAction('download', $event)"
    @open-workflow="appOutputAction('open-workflow', $event)"
  />
  <div
    ref="scroller"
    class="flex min-h-0 w-full flex-auto flex-col overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="apps-view"
  >
    <header v-if="!appFillsPage" class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
      <h1 class="m-0 font-display text-display font-semibold text-foreground">
        {{ t('sidebar.apps') }}
      </h1>
    </header>

    <div
      v-if="!appFillsPage"
      class="sticky top-0 z-10 w-full shrink-0 transition-colors duration-200"
      :class="scrollTop > 0 && 'bg-content-background/75 backdrop-blur-lg'"
      data-testid="assets-toolbar"
    >
      <div class="mx-auto flex min-h-8 w-full max-w-300 flex-wrap items-center gap-2 px-10 py-3">
        <SegmentedControl v-model="tab" :options="tabOptions" :label="t('apps.tabsLabel')" />

        <div v-if="tab === 'files'" class="ml-auto flex items-center gap-2">
          <Button
            variant="muted-textonly"
            size="icon"
            type="button"
            :disabled="loading"
            :aria-label="t('assets.refresh')"
            :title="t('assets.refresh')"
            data-testid="assets-refresh"
            @click="loadAssets"
          >
            <RefreshCw
              :size="13"
              :class="loading && 'animate-spin [animation-duration:900ms]'"
              aria-hidden="true"
            />
          </Button>
          <Menu
            :modal="false"
            align="end"
            class="z-20 min-w-[180px]"
            :aria-label="t('assets.kindLabel')"
          >
            <template #trigger>
              <Button
                type="button"
                variant="secondary"
                size="md"
                class="gap-1.5 px-3 text-[13px]/5"
                data-testid="assets-filter"
              >
                <ListFilter :size="15" aria-hidden="true" />
                {{ filterLabel }}
              </Button>
            </template>
            <DropdownMenuRadioGroup :model-value="kindFilter">
              <MenuRadioItem
                v-for="option in kindOptions"
                :key="option.value"
                as="button"
                type="button"
                :value="option.value"
                class="w-full"
                :data-testid="`assets-filter-${option.value}`"
                @select="kindFilter = option.value"
              >
                <span class="flex-1 text-left">{{ option.label }}</span>
                <Check v-if="kindFilter === option.value" :size="15" aria-hidden="true" />
              </MenuRadioItem>
            </DropdownMenuRadioGroup>
          </Menu>
          <div class="w-[220px]">
            <BaseInput
              v-model="searchQuery"
              class="h-8 [&_input]:text-ui"
              :placeholder="t('assets.search')"
              :aria-label="t('assets.search')"
            >
              <template #leading><Search :size="14" /></template>
            </BaseInput>
          </div>
          <Menu
            :modal="false"
            align="end"
            class="z-20 min-w-[240px]"
            :aria-label="t('assets.viewOptions')"
          >
            <template #trigger>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                :aria-label="t('assets.viewOptions')"
                :title="t('assets.viewOptions')"
                data-testid="assets-view-options"
              >
                <LayoutGrid :size="15" aria-hidden="true" />
              </Button>
            </template>
            <div class="px-3 pt-2 pb-1 text-ui text-subtle-foreground">
              {{ t('assets.layoutLabel') }}
            </div>
            <DropdownMenuRadioGroup :model-value="layout">
              <MenuRadioItem
                v-for="option in layoutOptions"
                :key="option.value"
                as="button"
                type="button"
                :value="option.value"
                class="w-full gap-2.5"
                :data-testid="`assets-layout-${option.value}`"
                @select.prevent="layout = option.value"
              >
                <component :is="option.icon" :size="15" aria-hidden="true" />
                <span class="flex-1 text-left">{{ option.label }}</span>
                <Check v-if="layout === option.value" :size="15" aria-hidden="true" />
              </MenuRadioItem>
            </DropdownMenuRadioGroup>
            <MenuSeparator />
            <div class="px-3 pt-2 pb-1 text-ui text-subtle-foreground">
              {{ t('assets.sortLabel') }}
            </div>
            <DropdownMenuRadioGroup :model-value="sortOrder">
              <MenuRadioItem
                v-for="option in sortOptions"
                :key="option.value"
                as="button"
                type="button"
                :value="option.value"
                class="w-full"
                @select.prevent="sortOrder = option.value"
              >
                <span class="flex-1 text-left">{{ option.label }}</span>
                <Check v-if="sortOrder === option.value" :size="15" aria-hidden="true" />
              </MenuRadioItem>
            </DropdownMenuRadioGroup>
            <MenuSeparator />
            <div class="px-3 pt-2 pb-1 text-ui text-subtle-foreground">
              {{ t('assets.showLabel') }}
            </div>
            <MenuItem
              as="button"
              type="button"
              class="w-full"
              @select.prevent="showName = !showName"
            >
              <span class="flex-1 text-left">{{ t('assets.showName') }}</span>
              <Check v-if="showName" :size="15" aria-hidden="true" />
            </MenuItem>
            <MenuItem
              as="button"
              type="button"
              class="w-full"
              @select.prevent="showDetails = !showDetails"
            >
              <span class="flex-1 text-left">{{ t('assets.showDetails') }}</span>
              <Check v-if="showDetails" :size="15" aria-hidden="true" />
            </MenuItem>
          </Menu>
        </div>
      </div>
    </div>

    <AppsGallery
      v-if="tab === 'all'"
      v-show="!appFillsPage"
      :load-failed-url="appsLoadFailedUrl"
      @open="openCatalogApp"
    />
    <div v-if="tab === 'files'" class="mx-auto w-full max-w-300 px-10 pt-2 pb-24">
      <div v-if="loading && assets.length === 0" role="status" :aria-label="t('common.loading')">
        <ul class="m-0 list-none p-0" :class="layoutClass" data-testid="assets-skeleton">
          <li v-for="n in SKELETON_COUNT" :key="n" class="flex flex-col bg-secondary">
            <Skeleton
              class="w-full rounded-none"
              :class="layout === 'masonry' && n % 3 === 1 ? 'aspect-[3/4]' : 'aspect-video'"
            />
            <div v-if="showName || showDetails" class="flex flex-col gap-2 px-3 py-3">
              <Skeleton v-if="showName" class="h-2.5 w-3/4 rounded-full" />
              <Skeleton v-if="showDetails" class="h-2 w-2/5 rounded-full" />
            </div>
          </li>
        </ul>
      </div>

      <section
        v-else-if="failed || visibleAssets.length === 0"
        class="flex flex-col items-center gap-1.5 px-6 py-16 text-center"
        data-testid="assets-empty"
      >
        <h2 class="m-0 text-heading font-semibold text-foreground">
          {{ emptyState.title }}
        </h2>
        <p v-if="emptyState.body" class="m-0 text-ui text-muted-foreground">
          {{ emptyState.body }}
        </p>
        <Button
          v-if="emptyState.action"
          type="button"
          variant="inverted"
          size="md"
          class="mt-6 px-4 text-[13px]/5"
          :disabled="signingIn"
          data-testid="assets-empty-action"
          @click="emptyState.action.run"
        >
          {{ emptyState.action.label }}
        </Button>
      </section>

      <ul
        v-else
        class="m-0 list-none p-0"
        :class="layoutClass"
        data-testid="assets-grid"
        @pointerenter="warmNameTooltips"
        @pointerleave="coolNameTooltips"
      >
        <li
          v-for="asset in visibleAssets"
          :key="cardKey(asset)"
          class="group relative bg-secondary"
          :data-testid="`asset-${asset.id}`"
        >
          <Tooltip
            :text="asset.name"
            side="bottom"
            :delay-ms="nameTooltipsWarm ? 0 : NAME_TOOLTIP_DELAY_MS"
            class="w-full align-top"
          >
            <button
              type="button"
              class="block w-full cursor-pointer text-left"
              :aria-label="t('assets.inspect', { name: asset.name })"
              :data-testid="`asset-open-${asset.id}`"
              :data-card-key="cardKey(asset)"
              @click="openDetail(asset)"
            >
              <span
                class="relative block overflow-hidden"
                :class="
                  layout === 'grid' || !asset.previewUrl || asset.kind !== 'image'
                    ? 'aspect-video'
                    : ''
                "
              >
                <img
                  v-if="asset.previewUrl && asset.kind === 'image'"
                  :src="asset.previewUrl"
                  :alt="asset.name"
                  loading="lazy"
                  class="block w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  :class="layout === 'grid' && 'h-full'"
                />
                <video
                  v-else-if="asset.previewUrl && asset.kind === 'video'"
                  :src="asset.previewUrl"
                  preload="metadata"
                  muted
                  class="block size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
                <span
                  v-else
                  class="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                >
                  <AudioLines v-if="asset.kind === 'audio'" :size="28" aria-hidden="true" />
                  <Box v-else-if="asset.kind === '3d'" :size="28" aria-hidden="true" />
                  <File v-else :size="28" aria-hidden="true" />
                  <span class="text-ui">{{ extensionOf(asset.name) }}</span>
                </span>
                <span
                  v-if="asset.kind === 'video'"
                  class="absolute bottom-2 left-2 flex size-6 items-center justify-center rounded-md bg-media-overlay text-foreground"
                >
                  <Play :size="12" aria-hidden="true" />
                </span>
              </span>
              <span
                v-if="showName || showDetails"
                class="flex min-w-0 flex-col gap-0.5 px-3 py-2.5"
              >
                <span v-if="showName" class="truncate text-ui font-medium text-foreground">{{
                  asset.name
                }}</span>
                <span v-if="showDetails" class="truncate text-ui text-subtle-foreground">{{
                  assetDetails(asset)
                }}</span>
              </span>
            </button>
          </Tooltip>

          <div
            class="absolute top-2 right-2 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
            :class="cardMenuOpenKey === cardKey(asset) && 'opacity-100'"
          >
            <div class="flex items-center rounded-md bg-media-overlay">
              <Button
                type="button"
                variant="muted-textonly"
                size="icon"
                class="text-foreground"
                :aria-label="t('assets.download')"
                :title="t('assets.download')"
                @click="download(asset)"
              >
                <Download :size="14" aria-hidden="true" />
              </Button>
              <Menu
                :open="cardMenuOpenKey === cardKey(asset)"
                :modal="false"
                align="end"
                class="z-20 min-w-[180px]"
                :aria-label="t('assets.moreActions')"
                @update:open="cardMenuOpenKey = $event ? cardKey(asset) : null"
              >
                <template #trigger>
                  <Button
                    type="button"
                    variant="muted-textonly"
                    size="icon"
                    class="text-foreground"
                    :aria-label="t('assets.moreActions')"
                    :title="t('assets.moreActions')"
                    :data-testid="`asset-menu-${asset.id}`"
                  >
                    <Ellipsis :size="14" aria-hidden="true" />
                  </Button>
                </template>
                <MenuItem
                  as="button"
                  type="button"
                  class="w-full gap-2.5"
                  @select="openDetail(asset)"
                >
                  <ZoomIn :size="15" aria-hidden="true" />
                  {{ t('assets.inspectAsset') }}
                </MenuItem>
                <MenuItem
                  as="button"
                  type="button"
                  class="w-full gap-2.5"
                  @select="download(asset)"
                >
                  <Download :size="15" aria-hidden="true" />
                  {{ t('assets.download') }}
                </MenuItem>
              </Menu>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
  <AppsHost
    v-if="tab === 'all' && openApp"
    class="absolute inset-0"
    :url="openApp.url"
    :grow-by="growBy"
    :covered="appOutputs !== null"
    :backdrop="appOutputs?.backdropUrl ?? null"
    @failed="appFailed"
    @outputs="showAppOutputs"
    @app-open="closeApp"
    @entered="appEntered = true"
  />
</template>
