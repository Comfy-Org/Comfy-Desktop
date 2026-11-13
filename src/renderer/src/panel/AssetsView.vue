<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalStorage, useScroll } from '@vueuse/core'
import { DropdownMenuRadioGroup } from 'reka-ui'
import {
  AudioLines,
  Box,
  Check,
  Download,
  File,
  LayoutGrid,
  LayoutDashboard,
  ListFilter,
  Play,
  RefreshCw,
  Search
} from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import BaseInput from '../components/ui/BaseInput.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useModal } from '../composables/useModal'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useVirtualMasonry } from '../composables/useVirtualMasonry'
import { formatBytes } from '../lib/downloadFormatters'
import { formatRelativeFromMs } from '../lib/datetime'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { LOCAL_ASSETS_SOURCE } from '../types/ipc'
import type { AssetKind, AssetSummary, Installation } from '../types/ipc'

interface GalleryAsset extends AssetSummary {
  source: string
}

type KindFilter = 'all' | AssetKind
type Layout = 'masonry' | 'grid'
type SortOrder = 'newest' | 'oldest'

interface Shape {
  width: number
  height: number
}

const SKELETON_COUNT = 8
const NAME_TOOLTIP_DELAY_MS = 600
const MIN_CARD_WIDTH = 200
const CARD_GAP: Record<Layout, number> = { masonry: 16, grid: 2 }
const WIDE: Shape = { width: 16, height: 9 }
const SQUARE: Shape = { width: 1, height: 1 }
const TALL: Shape = { width: 3, height: 4 }
const CAPTION_PADDING_ESTIMATE = 20
const CAPTION_LINE_ESTIMATE = 20

const { t } = useI18n()
const modal = useModal()
const authStore = useAuthStore()
const installationStore = useInstallationStore()

const kindFilter = ref<KindFilter>('all')
const searchQuery = ref('')
const signingIn = ref(false)
const downloading = ref(new Set<string>())
const layout = useLocalStorage<Layout>('comfy.desktop.assets.layout', 'masonry')
const sortOrder = useLocalStorage<SortOrder>('comfy.desktop.assets.sort', 'newest')
const showName = useLocalStorage('comfy.desktop.assets.showName', false)
const showDetails = useLocalStorage('comfy.desktop.assets.showDetails', false)

const assets = ref<GalleryAsset[]>([])
const scroller = useTemplateRef<HTMLElement>('scroller')
const { y: scrollTop } = useScroll(scroller)
const nameTooltipsWarm = ref(false)
let warmTimer: ReturnType<typeof setTimeout> | undefined
const loading = ref(false)
const failed = ref(false)

function isCloudBuild(inst: Installation): boolean {
  return inst.sourceCategory === 'cloud'
}

const cloudBuildId = computed(() =>
  authStore.isSignedIn ? (installationStore.installations.find(isCloudBuild)?.id ?? null) : null
)

const kindOptions = computed(() => [
  { value: 'all' as const, label: t('assets.kind.all') },
  { value: 'image' as const, label: t('assets.kind.image') },
  { value: 'video' as const, label: t('assets.kind.video') },
  { value: '3d' as const, label: t('assets.kind.3d') },
  { value: 'audio' as const, label: t('assets.kind.audio') }
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
  return `${asset.source}:${asset.id}`
}

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

const showSkeleton = computed(() => loading.value && assets.value.length === 0)

function assetShape(asset: AssetSummary): Shape {
  if (layout.value === 'grid' || asset.kind !== 'image' || !asset.previewUrl) return WIDE
  return asset.width && asset.height ? { width: asset.width, height: asset.height } : SQUARE
}

function skeletonShape(index: number): Shape {
  return layout.value === 'masonry' && index % 3 === 0 ? TALL : WIDE
}

function aspectStyle(shape: Shape): { aspectRatio: string } {
  return { aspectRatio: `${shape.width} / ${shape.height}` }
}

const captionHeight = computed(() =>
  showName.value || showDetails.value
    ? CAPTION_PADDING_ESTIMATE +
      CAPTION_LINE_ESTIMATE * (Number(showName.value) + Number(showDetails.value))
    : 0
)

function cardShape(index: number): Shape {
  const asset = visibleAssets.value[index]
  return showSkeleton.value || !asset ? skeletonShape(index) : assetShape(asset)
}

const { cards, galleryStyle, cardStyle, measureCard } = useVirtualMasonry({
  scroller,
  gallery: useTemplateRef<HTMLElement>('gallery'),
  count: () => (showSkeleton.value ? SKELETON_COUNT : visibleAssets.value.length),
  itemKey: (index) => {
    const asset = visibleAssets.value[index]
    return showSkeleton.value || !asset ? `skeleton:${index}` : cardKey(asset)
  },
  estimateHeight: (index, columnWidth) => {
    const shape = cardShape(index)
    return (columnWidth * shape.height) / shape.width + captionHeight.value
  },
  minColumnWidth: MIN_CARD_WIDTH,
  gap: () => CARD_GAP[layout.value],
  relayoutWhen: () => [visibleAssets.value, showSkeleton.value, layout.value, captionHeight.value]
})

const assetCards = computed(() =>
  cards.value.flatMap((card) => {
    const asset = visibleAssets.value[card.index]
    return asset ? [{ card, asset }] : []
  })
)

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
    body: t('assets.emptyBody')
  }
})

let requestId = 0
async function loadAssets(): Promise<void> {
  const current = ++requestId
  loading.value = true
  failed.value = false
  try {
    const cloudId = cloudBuildId.value
    const sources = [
      { source: LOCAL_ASSETS_SOURCE, load: () => window.api.listLocalAssets() },
      ...(cloudId ? [{ source: cloudId, load: () => window.api.listAssets(cloudId) }] : [])
    ]
    const results = await Promise.allSettled(sources.map(({ load }) => load()))
    if (current !== requestId) return
    assets.value = results.flatMap((result, i) =>
      result.status === 'fulfilled'
        ? result.value.map((asset) => ({ ...asset, source: sources[i]!.source }))
        : []
    )
    failed.value = assets.value.length === 0 && results.some((r) => r.status === 'rejected')
  } finally {
    if (current === requestId) loading.value = false
  }
}

const accountContext = computed(
  () => `${authStore.isSignedIn}:${authStore.status.workspaceId ?? ''}`
)

watch(accountContext, () => (assets.value = []))

watch(
  () => `${cloudBuildId.value ?? ''}\n${accountContext.value}`,
  () => void loadAssets(),
  { immediate: true }
)

function warmNameTooltips(): void {
  clearTimeout(warmTimer)
  warmTimer = setTimeout(() => (nameTooltipsWarm.value = true), NAME_TOOLTIP_DELAY_MS)
}

function coolNameTooltips(): void {
  clearTimeout(warmTimer)
  nameTooltipsWarm.value = false
}

onBeforeUnmount(() => clearTimeout(warmTimer))

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

async function download(asset: GalleryAsset): Promise<void> {
  const key = cardKey(asset)
  if (downloading.value.has(key)) return
  downloading.value.add(key)
  try {
    await window.api.downloadAsset(asset.source, asset.id, asset.name)
  } catch {
    await modal.alert({ title: t('assets.downloadFailed'), message: asset.name })
  } finally {
    downloading.value.delete(key)
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
  <div
    ref="scroller"
    class="flex min-h-0 w-full flex-auto flex-col overflow-y-auto [scrollbar-gutter:stable]"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="assets-view"
  >
    <header class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
      <h1 class="m-0 font-display text-display font-semibold text-foreground">
        {{ t('sidebar.assets') }}
      </h1>
    </header>

    <div
      class="sticky top-0 z-10 w-full shrink-0 transition-colors duration-200"
      :class="scrollTop > 0 && 'bg-content-background/75 backdrop-blur-lg'"
      data-testid="assets-toolbar"
    >
      <div class="mx-auto flex min-h-8 w-full max-w-300 flex-wrap items-center gap-2 px-10 py-3">
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

    <div class="mx-auto w-full max-w-300 px-10 pt-2 pb-24">
      <div v-if="showSkeleton" role="status" :aria-label="t('common.loading')">
        <ul
          ref="gallery"
          class="m-0 list-none p-0"
          :style="galleryStyle"
          data-testid="assets-skeleton"
        >
          <li
            v-for="card in cards"
            :key="String(card.key)"
            :ref="measureCard"
            :data-index="card.index"
            class="flex flex-col bg-secondary"
            :style="cardStyle(card)"
          >
            <Skeleton class="w-full rounded-none" :style="aspectStyle(skeletonShape(card.index))" />
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
        ref="gallery"
        class="m-0 list-none p-0"
        :style="galleryStyle"
        data-testid="assets-grid"
        @pointerenter="warmNameTooltips"
        @pointerleave="coolNameTooltips"
      >
        <li
          v-for="{ card, asset } in assetCards"
          :key="String(card.key)"
          :ref="measureCard"
          :data-index="card.index"
          class="group bg-secondary"
          :style="cardStyle(card)"
          :data-testid="`asset-${asset.id}`"
        >
          <Tooltip
            :text="asset.name"
            side="bottom"
            :delay-ms="nameTooltipsWarm ? 0 : NAME_TOOLTIP_DELAY_MS"
            class="w-full align-top"
          >
            <div class="block w-full">
              <span class="relative block overflow-hidden" :style="aspectStyle(assetShape(asset))">
                <img
                  v-if="asset.previewUrl && asset.kind === 'image'"
                  :src="asset.thumbnailUrl ?? asset.previewUrl"
                  :alt="asset.name"
                  loading="lazy"
                  class="block size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
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
            </div>
          </Tooltip>

          <Button
            type="button"
            variant="muted-textonly"
            size="icon"
            class="absolute top-2 right-2 bg-media-overlay text-foreground opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
            :aria-label="t('assets.download')"
            :title="t('assets.download')"
            :disabled="downloading.has(cardKey(asset))"
            :data-testid="`asset-download-${asset.id}`"
            @click="download(asset)"
          >
            <Download :size="14" aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>
  </div>
</template>
