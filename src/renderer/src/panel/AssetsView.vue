<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import {
  AudioLines,
  Box,
  Check,
  ChevronDown,
  Cloud,
  Download,
  Ellipsis,
  Layers,
  LayoutGrid,
  LayoutDashboard,
  Monitor,
  Play,
  RefreshCw,
  Search,
  ZoomIn
} from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import BaseInput from '../components/ui/BaseInput.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import StatusChip from '../components/ui/StatusChip.vue'
import AssetDetailView from './AssetDetailView.vue'
import type { GalleryAsset } from './AssetDetailView.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { formatBytes } from '../lib/downloadFormatters'
import { formatRelativeFromMs } from '../lib/datetime'
import type { AssetKind, AssetSummary, Installation } from '../types/ipc'

type KindFilter = 'all' | AssetKind
type Layout = 'masonry' | 'grid'
type SortOrder = 'newest' | 'oldest'

const EVERYWHERE = 'everywhere'
const SKELETON_COUNT = 8

const { t } = useI18n()
const authStore = useAuthStore()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()

const scope = ref<string>(EVERYWHERE)
const kindFilter = ref<KindFilter>('all')
const searchQuery = ref('')
const scopeMenuOpen = ref(false)
const viewMenuOpen = ref(false)
const layout = useLocalStorage<Layout>('comfy.desktop.assets.layout', 'masonry')
const sortOrder = useLocalStorage<SortOrder>('comfy.desktop.assets.sort', 'newest')
const showName = useLocalStorage('comfy.desktop.assets.showName', true)
const showDetails = useLocalStorage('comfy.desktop.assets.showDetails', true)

const assets = ref<GalleryAsset[]>([])
const selectedIds = ref(new Set<string>())
const detailIndex = ref<number | null>(null)
const cardMenuOpenId = ref<string | null>(null)
const loading = ref(false)
const failed = ref(false)

function isCloudBuild(inst: Installation): boolean {
  return inst.sourceCategory === 'cloud'
}

function isReachable(inst: Installation): boolean {
  return isCloudBuild(inst) ? authStore.isSignedIn : sessionStore.isRunning(inst.id)
}

const builds = computed(() => installationStore.installations)
const reachableBuilds = computed(() => builds.value.filter(isReachable))
const scopedBuildIds = computed(() =>
  scope.value === EVERYWHERE ? reachableBuilds.value.map((b) => b.id) : [scope.value]
)
const scopeLabel = computed(() =>
  scope.value === EVERYWHERE
    ? t('assets.everywhere')
    : (installationStore.getById(scope.value)?.name ?? t('assets.everywhere'))
)
const scopeIcon = computed(() => {
  if (scope.value === EVERYWHERE) return Layers
  const inst = installationStore.getById(scope.value)
  return inst && isCloudBuild(inst) ? Cloud : Monitor
})

const kindOptions = computed(() => [
  { value: 'all' as const, label: t('assets.kind.all') },
  { value: 'image' as const, label: t('assets.kind.image') },
  { value: 'video' as const, label: t('assets.kind.video') },
  { value: '3d' as const, label: t('assets.kind.3d') },
  { value: 'audio' as const, label: t('assets.kind.audio') }
])
const layoutOptions = computed(() => [
  { value: 'masonry' as const, label: t('assets.layout.masonry'), icon: LayoutDashboard },
  { value: 'grid' as const, label: t('assets.layout.grid'), icon: LayoutGrid }
])
const sortOptions = computed(() => [
  { value: 'newest' as const, label: t('assets.sort.newest') },
  { value: 'oldest' as const, label: t('assets.sort.oldest') }
])

const visibleAssets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const filtered = assets.value.filter(
    (asset) =>
      (kindFilter.value === 'all' || asset.kind === kindFilter.value) &&
      (!query || asset.name.toLowerCase().includes(query))
  )
  const direction = sortOrder.value === 'newest' ? -1 : 1
  return filtered.toSorted(
    (a, b) => direction * (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  )
})

let requestId = 0
async function loadAssets(): Promise<void> {
  const current = ++requestId
  loading.value = true
  failed.value = false
  try {
    const ids = scopedBuildIds.value
    const results = await Promise.all(ids.map((id) => window.api.listAssets(id)))
    if (current === requestId) {
      assets.value = results.flatMap((list, i) => {
        const installationId = ids[i]!
        const buildName = installationStore.getById(installationId)?.name ?? ''
        return list.map((asset) => ({ ...asset, installationId, buildName }))
      })
    }
  } catch {
    if (current === requestId) {
      assets.value = []
      failed.value = true
    }
  } finally {
    if (current === requestId) loading.value = false
  }
}

watch(scopedBuildIds, loadAssets, { immediate: true })
watch(visibleAssets, (list) => {
  if (detailIndex.value !== null && detailIndex.value >= list.length) detailIndex.value = null
})

function selectScope(id: string): void {
  scope.value = id
  scopeMenuOpen.value = false
}

function toggleSelected(id: string): void {
  const next = new Set(selectedIds.value)
  if (!next.delete(id)) next.add(id)
  selectedIds.value = next
}

function openDetail(asset: GalleryAsset): void {
  detailIndex.value = visibleAssets.value.indexOf(asset)
}

function download(asset: GalleryAsset): void {
  void window.api.downloadAsset(asset.installationId, asset.id, asset.name)
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
  <AssetDetailView
    v-if="detailIndex !== null && visibleAssets.length > 0"
    v-model:index="detailIndex"
    :assets="visibleAssets"
    @close="detailIndex = null"
    @download="download"
  />
  <div
    v-else
    class="flex min-h-0 w-full flex-auto flex-col overflow-y-auto"
    data-testid="assets-view"
  >
    <div class="mx-auto w-full max-w-300 px-10 pb-24">
      <header class="pt-9 pb-6">
        <h1 class="m-0 font-display text-display font-semibold text-foreground">
          {{ t('sidebar.assets') }}
        </h1>
      </header>

      <div class="mb-5 flex min-h-8 flex-wrap items-center gap-2">
        <Menu
          v-model:open="scopeMenuOpen"
          :modal="false"
          align="start"
          class="z-20 min-w-[280px]"
          :aria-label="t('assets.browseAssetsOf')"
        >
          <template #trigger>
            <Button
              type="button"
              variant="secondary"
              size="md"
              class="gap-2 px-3 text-[13px]/5"
              data-testid="assets-scope-trigger"
            >
              <component :is="scopeIcon" :size="15" aria-hidden="true" />
              <span class="max-w-48 truncate">{{ scopeLabel }}</span>
              <ChevronDown :size="14" aria-hidden="true" />
            </Button>
          </template>
          <div
            class="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-subtle-foreground uppercase"
          >
            {{ t('assets.browseAssetsOf') }}
          </div>
          <MenuItem
            as="button"
            type="button"
            class="w-full gap-2.5"
            data-testid="assets-scope-everywhere"
            @select="selectScope(EVERYWHERE)"
          >
            <Layers :size="15" aria-hidden="true" />
            <span class="flex-1 text-left">{{ t('assets.everywhere') }}</span>
            <span class="text-ui text-subtle-foreground">{{ t('assets.runningBuilds') }}</span>
            <Check v-if="scope === EVERYWHERE" :size="15" aria-hidden="true" />
          </MenuItem>
          <MenuItem
            v-for="build in builds"
            :key="build.id"
            as="button"
            type="button"
            class="w-full gap-2.5"
            :disabled="!isReachable(build)"
            :data-testid="`assets-scope-${build.id}`"
            @select="selectScope(build.id)"
          >
            <component :is="isCloudBuild(build) ? Cloud : Monitor" :size="15" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-left">{{ build.name }}</span>
            <StatusChip :tone="isReachable(build) ? 'go' : 'quiet'">
              {{ isReachable(build) ? t('assets.running') : t('assets.stopped') }}
            </StatusChip>
            <Check v-if="scope === build.id" :size="15" aria-hidden="true" />
          </MenuItem>
        </Menu>

        <SegmentedControl
          v-model="kindFilter"
          :options="kindOptions"
          :label="t('assets.kindLabel')"
        />

        <div class="ml-auto flex items-center gap-2">
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
            v-model:open="viewMenuOpen"
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
            <div
              class="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-subtle-foreground uppercase"
            >
              {{ t('assets.layoutLabel') }}
            </div>
            <MenuItem
              v-for="option in layoutOptions"
              :key="option.value"
              as="button"
              type="button"
              class="w-full gap-2.5"
              :data-testid="`assets-layout-${option.value}`"
              @select.prevent="layout = option.value"
            >
              <component :is="option.icon" :size="15" aria-hidden="true" />
              <span class="flex-1 text-left">{{ option.label }}</span>
              <Check v-if="layout === option.value" :size="15" aria-hidden="true" />
            </MenuItem>
            <MenuSeparator />
            <div
              class="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-subtle-foreground uppercase"
            >
              {{ t('assets.sortLabel') }}
            </div>
            <MenuItem
              v-for="option in sortOptions"
              :key="option.value"
              as="button"
              type="button"
              class="w-full"
              @select.prevent="sortOrder = option.value"
            >
              <span class="flex-1 text-left">{{ option.label }}</span>
              <Check v-if="sortOrder === option.value" :size="15" aria-hidden="true" />
            </MenuItem>
            <MenuSeparator />
            <div
              class="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-subtle-foreground uppercase"
            >
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

      <ul
        v-if="loading && assets.length === 0"
        class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-0.5 p-0"
        role="status"
        :aria-label="t('common.loading')"
        data-testid="assets-skeleton"
      >
        <li v-for="n in SKELETON_COUNT" :key="n" class="flex flex-col bg-secondary">
          <Skeleton class="aspect-video w-full rounded-none" />
          <div class="flex flex-col gap-2 px-3 py-3">
            <Skeleton class="h-2.5 w-3/4 rounded-full" />
            <Skeleton class="h-2 w-2/5 rounded-full" />
          </div>
        </li>
      </ul>

      <section
        v-else-if="failed || visibleAssets.length === 0"
        class="flex flex-col items-center gap-1.5 px-6 py-16 text-center"
        data-testid="assets-empty"
      >
        <h2 class="m-0 text-heading font-semibold text-foreground">
          {{ failed ? t('assets.loadFailed') : t('assets.emptyTitle') }}
        </h2>
        <p class="m-0 text-ui text-muted-foreground">
          {{ scopedBuildIds.length === 0 ? t('assets.noRunningBuilds') : t('assets.emptyBody') }}
        </p>
      </section>

      <ul
        v-else
        class="m-0 list-none p-0"
        :class="
          layout === 'masonry'
            ? 'columns-[200px] gap-4 [&>li]:mb-4 [&>li]:break-inside-avoid'
            : 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-0.5'
        "
        data-testid="assets-grid"
      >
        <li
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="group relative bg-secondary"
          :class="selectedIds.has(asset.id) && 'outline-2 -outline-offset-2 outline-foreground'"
          :aria-selected="selectedIds.has(asset.id)"
          :data-testid="`asset-${asset.id}`"
        >
          <button
            type="button"
            class="block w-full cursor-pointer text-left"
            :aria-label="t('assets.inspect', { name: asset.name })"
            :data-testid="`asset-open-${asset.id}`"
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
                class="block w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
                :class="layout === 'grid' && 'h-full'"
              />
              <video
                v-else-if="asset.previewUrl && asset.kind === 'video'"
                :src="asset.previewUrl"
                preload="metadata"
                muted
                class="block size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
              />
              <span
                v-else
                class="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
              >
                <AudioLines v-if="asset.kind === 'audio'" :size="28" aria-hidden="true" />
                <Box v-else :size="28" aria-hidden="true" />
                <span class="text-ui">{{ extensionOf(asset.name) }}</span>
              </span>
              <span
                v-if="asset.kind === 'video'"
                class="absolute bottom-2 left-2 flex size-6 items-center justify-center rounded-md bg-media-overlay text-foreground"
              >
                <Play :size="12" aria-hidden="true" />
              </span>
            </span>
            <span v-if="showName || showDetails" class="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
              <span v-if="showName" class="truncate text-ui font-medium text-foreground">{{
                asset.name
              }}</span>
              <span v-if="showDetails" class="truncate text-ui text-subtle-foreground">{{
                assetDetails(asset)
              }}</span>
            </span>
          </button>

          <div
            class="absolute inset-x-2 top-2 flex items-start justify-between opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
            :class="(selectedIds.has(asset.id) || cardMenuOpenId === asset.id) && 'opacity-100'"
          >
            <Checkbox
              :model-value="selectedIds.has(asset.id)"
              class="size-5 rounded-full border-foreground bg-media-overlay"
              :aria-label="t('assets.select', { name: asset.name })"
              :data-testid="`asset-select-${asset.id}`"
              @update:model-value="toggleSelected(asset.id)"
            />
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
                :open="cardMenuOpenId === asset.id"
                :modal="false"
                align="end"
                class="z-20 min-w-[180px]"
                :aria-label="t('assets.moreActions')"
                @update:open="cardMenuOpenId = $event ? asset.id : null"
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
</template>
