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
  Layers,
  LayoutGrid,
  LayoutDashboard,
  List,
  Monitor,
  Play,
  RefreshCw,
  Search
} from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import BaseInput from '../components/ui/BaseInput.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import StatusChip from '../components/ui/StatusChip.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { formatBytes } from '../lib/downloadFormatters'
import { formatRelativeFromMs } from '../lib/datetime'
import type { AssetKind, AssetSummary, Installation } from '../types/ipc'

type KindFilter = 'all' | AssetKind
type Layout = 'masonry' | 'grid' | 'list'
type SortOrder = 'newest' | 'oldest'

const EVERYWHERE = 'everywhere'

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

const assets = ref<AssetSummary[]>([])
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
  { value: 'grid' as const, label: t('assets.layout.grid'), icon: LayoutGrid },
  { value: 'list' as const, label: t('assets.layout.list'), icon: List }
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
    const results = await Promise.all(scopedBuildIds.value.map((id) => window.api.listAssets(id)))
    if (current === requestId) assets.value = results.flat()
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

function selectScope(id: string): void {
  scope.value = id
  scopeMenuOpen.value = false
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
  <div class="flex min-h-0 w-full flex-auto flex-col overflow-y-auto" data-testid="assets-view">
    <div class="w-full px-10 pb-24">
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
              class="gap-2 px-3 text-ui"
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

      <div
        v-if="loading && assets.length === 0"
        class="flex items-center justify-center p-6 text-ui text-muted-foreground"
        role="status"
      >
        {{ t('common.loading') }}
      </div>

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
        :class="{
          'columns-[200px] gap-4 [&>li]:mb-4 [&>li]:break-inside-avoid': layout === 'masonry',
          'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4': layout === 'grid',
          'flex flex-col gap-1': layout === 'list'
        }"
        data-testid="assets-grid"
      >
        <li
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="overflow-hidden rounded-xl bg-secondary"
          :class="layout === 'list' && 'flex items-center gap-3 rounded-lg p-1.5'"
          :data-testid="`asset-${asset.id}`"
        >
          <div
            class="relative overflow-hidden bg-secondary"
            :class="
              layout === 'list'
                ? 'size-10 shrink-0 rounded-md'
                : layout === 'grid' || !asset.previewUrl || asset.kind !== 'image'
                  ? 'aspect-video'
                  : ''
            "
          >
            <img
              v-if="asset.previewUrl && asset.kind === 'image'"
              :src="asset.previewUrl"
              :alt="asset.name"
              loading="lazy"
              class="block w-full object-cover"
              :class="layout !== 'masonry' && 'h-full'"
            />
            <video
              v-else-if="asset.previewUrl && asset.kind === 'video'"
              :src="asset.previewUrl"
              preload="metadata"
              muted
              class="block size-full object-cover"
            />
            <div
              v-else
              class="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground"
            >
              <AudioLines v-if="asset.kind === 'audio'" :size="layout === 'list' ? 16 : 28" />
              <Box v-else :size="layout === 'list' ? 16 : 28" />
              <span v-if="layout !== 'list'" class="text-ui">{{ extensionOf(asset.name) }}</span>
            </div>
            <span
              v-if="asset.kind === 'video' && layout !== 'list'"
              class="absolute bottom-2 left-2 flex size-6 items-center justify-center rounded-md bg-media-overlay text-foreground"
            >
              <Play :size="12" aria-hidden="true" />
            </span>
          </div>
          <div
            v-if="showName || showDetails"
            class="flex min-w-0 flex-col gap-0.5"
            :class="layout === 'list' ? 'flex-1' : 'px-3 py-2.5'"
          >
            <span v-if="showName" class="truncate text-ui font-medium text-foreground">{{
              asset.name
            }}</span>
            <span v-if="showDetails" class="truncate text-ui text-subtle-foreground">{{
              assetDetails(asset)
            }}</span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
