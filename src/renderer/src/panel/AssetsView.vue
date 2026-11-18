<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalStorage, useResizeObserver, useScroll } from '@vueuse/core'
import { DropdownMenuRadioGroup, PopoverRoot, PopoverTrigger } from 'reka-ui'
import {
  AudioLines,
  Box,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Download,
  Ellipsis,
  File,
  FolderOpen,
  Laptop,
  LayoutGrid,
  LayoutDashboard,
  RefreshCw,
  Search,
  Trash2,
  Video
} from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import PopoverContent from '@comfyorg/design-system/popover/PopoverContent'
import BaseInput from '../components/ui/BaseInput.vue'
import ContextMenu from '../components/ContextMenu.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import OutputDetailDialog from './OutputDetailDialog.vue'
import type { OutputDetailItem } from './OutputDetailDialog.vue'
import { useModal } from '../composables/useModal'
import { revealInFolderKey } from '../composables/usePlatform'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { isCloudBuild } from './home/homeBuild'
import { installationWorkspaceId, isInstallationInWorkspace } from '../../../shared/workspaces'
import { useVirtualMasonry } from '../composables/useVirtualMasonry'
import { formatBytes } from '../lib/downloadFormatters'
import { formatPlaybackTime, formatRelativeFromMs } from '../lib/datetime'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { LOCAL_ASSETS_SOURCE } from '../types/ipc'
import type { AssetKind, AssetSummary, CloudAssetLookup, Installation } from '../types/ipc'
import type { ContextMenuItem } from '../types/context-menu'

interface GalleryAsset extends AssetSummary {
  source: string
}

interface AssetMenu {
  asset: GalleryAsset
  x: number
  y: number
}

type KindFilter = 'all' | AssetKind
type Layout = 'masonry' | 'grid'
type SortOrder = 'newest' | 'oldest'
type BuildState = 'running' | 'starting' | 'stopped'

interface AssetBuild {
  build: Installation
  cloud: boolean
  computer: boolean
  state: BuildState
}

interface Shape {
  width: number
  height: number
}

const SKELETON_COUNT = 8
const NAME_TOOLTIP_DELAY_MS = 600
const MIN_CARD_WIDTH = 240
const CARD_GAP = 14
const CARD_INSET = 4
const CAPTION_PADDING = 18
const CAPTION_LINE_GAP = 2
const NAME_LINE_HEIGHT = 18.2
const DETAILS_LINE_HEIGHT = 16.8
const WIDE: Shape = { width: 16, height: 9 }
const SQUARE: Shape = { width: 1, height: 1 }
const FILE: Shape = { width: 4, height: 3 }
const TALL: Shape = { width: 3, height: 4 }
const PLACEHOLDER_TINT = {
  audio:
    'bg-[linear-gradient(174deg,rgb(222_211_200/0.09),rgb(255_255_255/0.02))] text-[rgb(176_163_157)]',
  '3d': 'bg-[linear-gradient(160deg,rgb(200_211_211/0.09),rgb(255_255_255/0.02))] text-[rgb(157_168_170)]',
  file: 'bg-[linear-gradient(168deg,rgb(200_211_222/0.09),rgb(255_255_255/0.02))] text-[rgb(160_166_175)]'
} as const

const { installationId = '', focusName = null } = defineProps<{
  installationId?: string
  focusName?: string | null
}>()

const emit = defineEmits<{ 'focus-used': [] }>()

const { t } = useI18n()
const modal = useModal()
const authStore = useAuthStore()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
const dashboardScope = useDashboardScopeStore()
void dashboardScope.initialize()

const kindFilter = ref<KindFilter>('all')
const searchQuery = ref('')
const signingIn = ref(false)
const downloading = ref(new Set<string>())
const layout = useLocalStorage<Layout>('comfy.desktop.assets.layout', 'masonry')
const sortOrder = useLocalStorage<SortOrder>('comfy.desktop.assets.sort', 'newest')
const showName = useLocalStorage('comfy.desktop.assets.showName', true)
const showDetails = useLocalStorage('comfy.desktop.assets.showDetails', true)
const searchOpen = ref(false)
const toolbarRow = useTemplateRef<HTMLElement>('toolbarRow')
const toolbarCompactness = ref(0)
const SEARCH_AS_ICON = 1
const KINDS_AS_MENU = 2
const CLOUD = 'cloud'
const SHARED = 'shared'
const savedPlace = useLocalStorage('comfy.desktop.assets.place', '')
const pickedPlace = ref(focusName ? CLOUD : '')
const pendingFocus = ref<string | null>(focusName)
const focusMiss = ref<{ name: string; checked: boolean } | null>(null)
let lastLookup: { name: string; status: CloudAssetLookup['status'] } | null = null
const truncated = ref(false)

const assets = ref<GalleryAsset[]>([])
const scroller = useTemplateRef<HTMLElement>('scroller')
const { y: scrollTop } = useScroll(scroller)
const nameTooltipsWarm = ref(false)
let warmTimer: ReturnType<typeof setTimeout> | undefined
const loading = ref(false)
const failed = ref(false)

const buildsKnown = computed(
  () =>
    dashboardScope.initialized &&
    !(installationStore.loading && installationStore.installations.length === 0)
)

function buildState(build: Installation): BuildState {
  if (sessionStore.isLaunching(build.id)) return 'starting'
  return sessionStore.isRunning(build.id) || isCloudBuild(build) ? 'running' : 'stopped'
}

function inWorkspace(build: Installation): boolean {
  return isInstallationInWorkspace(build, dashboardScope.selectedWorkspaceId)
}

function savesToSharedFolder(build: Installation): boolean {
  return build.useSharedOutput !== false
}

function placeOption(id: string, name: string, cloud: boolean): AssetBuild {
  return {
    build: { id, name, sourceLabel: '', sourceCategory: cloud ? 'cloud' : 'local' },
    cloud,
    computer: !cloud,
    state: cloud ? 'running' : 'stopped'
  }
}

const cloudBuild = computed(
  () =>
    installationStore.installations.find((build) => isCloudBuild(build) && inWorkspace(build)) ??
    null
)

const cloudListable = computed(
  () => buildsKnown.value && authStore.isSignedIn && cloudBuild.value !== null
)
const cloudSettled = computed(
  () =>
    buildsKnown.value &&
    authStore.statusLoaded &&
    (!authStore.isSignedIn || authStore.workspacesLoaded)
)

const localBuilds = computed(() =>
  installationStore.installations.filter(
    (build) => build.hasOutputFolder === true && inWorkspace(build)
  )
)
const hasLocalBuild = computed(() => localBuilds.value.length > 0)

const assetBuilds = computed<AssetBuild[]>(() => {
  const local = localBuilds.value
  const dedicated = local.filter((build) => !savesToSharedFolder(build))
  return [
    placeOption(CLOUD, t('assets.cloud'), true),
    ...(!hasLocalBuild.value || local.some(savesToSharedFolder)
      ? [placeOption(SHARED, t('assets.sharedFolder'), false)]
      : []),
    ...dedicated.map((build) => ({
      build,
      cloud: false,
      computer: false,
      state: buildState(build)
    }))
  ]
})

const windowPlace = computed(() => {
  const build = installationId ? installationStore.getById(installationId) : null
  if (!build) return ''
  if (isCloudBuild(build)) return CLOUD
  return savesToSharedFolder(build) ? SHARED : build.id
})

const selectedBuild = computed<AssetBuild | null>(() => {
  if (!buildsKnown.value) return null
  const options = assetBuilds.value
  const withId = (id: string) => (id ? options.find(({ build }) => build.id === id) : undefined)
  const restorablePlace =
    savedPlace.value === CLOUD && !authStore.isSignedIn ? '' : savedPlace.value
  return (
    withId(pickedPlace.value) ??
    withId(windowPlace.value) ??
    withId(restorablePlace) ??
    (hasLocalBuild.value || !cloudBuild.value || !authStore.isSignedIn
      ? options.find((option) => !option.cloud)
      : undefined) ??
    options[0]!
  )
})

function choosePlace(id: string): void {
  pickedPlace.value = id
  focusMiss.value = null
  savedPlace.value = id
}

function buildStatusLabel({ cloud, computer, state }: AssetBuild): string {
  if (computer) return t('assets.outputFolder')
  return t('assets.buildStatus', {
    where: t(cloud ? 'assets.buildWhere.cloud' : 'assets.buildWhere.local'),
    state: t(`assets.buildState.${state}`)
  })
}

const kinds: KindFilter[] = ['all', 'image', 'video', '3d', 'audio']
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

const searchedAssets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return query
    ? assets.value.filter((asset) => asset.name.toLowerCase().includes(query))
    : assets.value
})

const kindOptions = computed(() =>
  kinds.map((kind) => ({
    value: kind,
    label: t(`assets.kind.${kind}`),
    count:
      kind === 'all'
        ? searchedAssets.value.length
        : searchedAssets.value.filter((asset) => asset.kind === kind).length,
    testId: `assets-kind-${kind}`
  }))
)

const currentKind = computed(() =>
  kindOptions.value.find((option) => option.value === kindFilter.value)!
)

let fitRun = 0
async function fitToolbar(): Promise<void> {
  const row = toolbarRow.value
  const run = ++fitRun
  if (!row || searchOpen.value) return
  for (let level = 0; level <= KINDS_AS_MENU; level++) {
    toolbarCompactness.value = level
    await nextTick()
    if (run !== fitRun || row.scrollWidth <= row.clientWidth) return
  }
}

useResizeObserver(toolbarRow, () => void fitToolbar())
watch(
  [selectedBuild, searchOpen, () => kindOptions.value.map((option) => option.count).join()],
  () => void fitToolbar(),
  { flush: 'post' }
)

const visibleAssets = computed(() => {
  const filtered = searchedAssets.value.filter(
    (asset) => kindFilter.value === 'all' || asset.kind === kindFilter.value
  )
  const direction = sortOrder.value === 'newest' ? -1 : 1
  return filtered.toSorted((a, b) => direction * (createdMs(a) - createdMs(b)))
})

const showSkeleton = computed(
  () => !selectedBuild.value || (loading.value && assets.value.length === 0)
)

function assetShape(asset: AssetSummary): Shape {
  if (layout.value === 'grid' || asset.kind === 'audio') return WIDE
  if (asset.kind === '3d') return SQUARE
  if (asset.kind === null) return FILE
  if (asset.width && asset.height) return { width: asset.width, height: asset.height }
  return asset.kind === 'image' ? SQUARE : WIDE
}

function placeholderTint(asset: AssetSummary): string {
  return asset.kind === 'audio' || asset.kind === '3d'
    ? PLACEHOLDER_TINT[asset.kind]
    : PLACEHOLDER_TINT.file
}

function skeletonShape(index: number): Shape {
  return layout.value === 'masonry' && index % 3 === 0 ? TALL : WIDE
}

function aspectStyle(shape: Shape): { aspectRatio: string } {
  return { aspectRatio: `${shape.width} / ${shape.height}` }
}

const captionHeight = computed(() => {
  if (!showName.value && !showDetails.value) return 0
  const lines =
    (showName.value ? NAME_LINE_HEIGHT : 0) + (showDetails.value ? DETAILS_LINE_HEIGHT : 0)
  return CAPTION_PADDING + lines + (showName.value && showDetails.value ? CAPTION_LINE_GAP : 0)
})

function cardShape(index: number): Shape {
  const asset = visibleAssets.value[index]
  return showSkeleton.value || !asset ? skeletonShape(index) : assetShape(asset)
}

const { cards, galleryStyle, cardStyle, measureCard, scrollToIndex } = useVirtualMasonry({
  scroller,
  gallery: useTemplateRef<HTMLElement>('gallery'),
  count: () => (showSkeleton.value ? SKELETON_COUNT : visibleAssets.value.length),
  itemKey: (index) => {
    const asset = visibleAssets.value[index]
    return showSkeleton.value || !asset ? `skeleton:${index}` : cardKey(asset)
  },
  estimateHeight: (index, columnWidth) => {
    const shape = cardShape(index)
    const mediaWidth = columnWidth - 2 * CARD_INSET
    return 2 * CARD_INSET + (mediaWidth * shape.height) / shape.width + captionHeight.value
  },
  minColumnWidth: MIN_CARD_WIDTH,
  gap: CARD_GAP,
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
  if (!authStore.isSignedIn && selectedBuild.value?.cloud) {
    return {
      title: t('assets.signedOutTitle'),
      body: t('assets.signedOutBody'),
      action: { label: t('assets.signIn'), run: () => void signIn() }
    }
  }
  if (selectedBuild.value?.cloud && !cloudBuild.value) {
    return { title: t('assets.noCloudBuildTitle'), body: t('assets.noCloudBuildBody') }
  }
  return {
    title: t('assets.emptyTitle'),
    body: t('assets.emptyBody')
  }
})

let requestId = 0

async function moveSessionToWorkspaceOf(build: Installation, userAsked: boolean): Promise<void> {
  const dashboardWorkspaceId = installationWorkspaceId(build, dashboardScope.selectedWorkspaceId)
  if (!authStore.sessionWorkspaceFor(dashboardWorkspaceId)) await authStore.fetchWorkspaces()
  const workspaceId = authStore.sessionWorkspaceFor(dashboardWorkspaceId)
  if (!workspaceId) throw new Error("the build's workspace is unknown")
  if (authStore.status.workspaceId === workspaceId) return
  const intent = userAsked || dashboardScope.takeChosenSelection() ? 'chosen' : 'restored'
  await authStore.switchWorkspace(workspaceId, intent)
  if (authStore.status.workspaceId !== workspaceId) throw new Error('workspace switch failed')
}

function lookUpCloudAsset(cloudId: string, name: string): Promise<CloudAssetLookup> {
  return window.api
    .findCloudAsset(cloudId, name)
    .catch((): CloudAssetLookup => ({ status: 'incomplete' }))
}

async function listCloudAssets(cloudId: string): Promise<AssetSummary[]> {
  const wanted = pendingFocus.value ?? focusMiss.value?.name ?? null
  const [listed, lookup] = await Promise.all([
    window.api.listAssets(cloudId),
    wanted ? lookUpCloudAsset(cloudId, wanted) : null
  ])
  lastLookup = wanted && lookup ? { name: wanted, status: lookup.status } : null
  if (lookup?.status !== 'found' || listed.some(({ id }) => id === lookup.asset.id)) return listed
  return [...listed, lookup.asset]
}

function lookedUpAbsent(name: string): boolean {
  return lastLookup?.name === name && lastLookup.status === 'absent'
}

async function loadAssets(userAsked = false): Promise<void> {
  const current = ++requestId
  const settled = cloudSettled.value
  const selected = selectedBuild.value
  const cloud = selected?.cloud ? cloudBuild.value : null
  failed.value = false
  truncated.value = false
  if (!selected || (selected.cloud && (!cloud || !authStore.isSignedIn))) {
    assets.value = []
    loading.value = false
    openPendingFocus(settled)
    return
  }
  loading.value = true
  const source = cloud ? cloud.id : LOCAL_ASSETS_SOURCE
  try {
    if (cloud) {
      await moveSessionToWorkspaceOf(cloud, userAsked || pickedPlace.value === CLOUD)
      if (current !== requestId) return
    }
    const listed = cloud
      ? { assets: await listCloudAssets(cloud.id), truncated: false }
      : await window.api.listLocalAssets(selected.computer ? undefined : selected.build.id)
    if (current !== requestId) return
    assets.value = listed.assets.map((asset) => ({ ...asset, source }))
    truncated.value = listed.truncated
    const miss = focusMiss.value
    if (miss && assets.value.some((asset) => asset.name === miss.name)) focusMiss.value = null
    else if (miss) focusMiss.value = { name: miss.name, checked: lookedUpAbsent(miss.name) }
    openPendingFocus(settled)
  } catch {
    if (current !== requestId) return
    assets.value = []
    failed.value = true
    openPendingFocus(settled)
  } finally {
    if (current === requestId) loading.value = false
  }
}

const accountContext = computed(
  () => `${authStore.isSignedIn}:${authStore.status.workspaceId ?? ''}`
)

const loadKey = computed(() => {
  const selected = selectedBuild.value
  if (!selected) return ''
  return selected.cloud
    ? `${selected.build.id}\n${dashboardScope.selectedWorkspaceId}\n${accountContext.value}`
    : selected.build.id
})

watch(
  [loadKey, () => (selectedBuild.value?.cloud ? cloudBuild.value?.id : undefined)],
  () => {
    assets.value = []
    void loadAssets()
  },
  { immediate: true }
)

function refresh(): void {
  void loadAssets(true)
}

const detailKey = ref<string | null>(null)

function newestNamed(name: string): GalleryAsset | null {
  return visibleAssets.value
    .filter((asset) => asset.name === name)
    .reduce<GalleryAsset | null>(
      (newest, asset) => (newest && createdMs(newest) >= createdMs(asset) ? newest : asset),
      null
    )
}

function openPendingFocus(settled: boolean): void {
  const name = pendingFocus.value
  if (!name || (!cloudListable.value && !settled)) return
  pendingFocus.value = null
  if (!selectedBuild.value?.cloud || failed.value || !cloudListable.value) return
  const asset = newestNamed(name)
  if (asset) openDetail(asset)
  else focusMiss.value = { name, checked: lookedUpAbsent(name) }
}

watch(
  cloudSettled,
  (settled) => {
    if (settled && !loading.value) openPendingFocus(true)
  },
  { flush: 'post' }
)

watch(
  () => focusName,
  (name) => {
    if (!name) return
    emit('focus-used')
    const cloudShown = selectedBuild.value?.cloud === true && !loading.value
    pendingFocus.value = name
    focusMiss.value = null
    pickedPlace.value = CLOUD
    if (!cloudShown) return
    if (cloudListable.value && !failed.value && !newestNamed(name)) void loadAssets()
    else openPendingFocus(cloudSettled.value)
  },
  { immediate: true }
)

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

const detailItems = computed<OutputDetailItem[]>(() =>
  visibleAssets.value.map((asset) => ({
    key: cardKey(asset),
    name: asset.name,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
    tags: asset.tags,
    previewUrl: asset.previewUrl,
    thumbnailUrl: asset.thumbnailUrl,
    savedIn: isLocal(asset) ? folderOf(asset.id) : null
  }))
)

watch(detailIndex, (index) => {
  if (index === null) detailKey.value = null
  else scrollToIndex(index)
})

function openDetail(asset: GalleryAsset): void {
  detailKey.value = cardKey(asset)
}

async function closeDetail(): Promise<void> {
  const viewedKey = detailKey.value ?? ''
  detailKey.value = null
  await nextTick()
  scroller.value?.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(viewedKey)}"]`)?.focus()
}

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

const assetMenu = ref<AssetMenu | null>(null)
const ASSET_MENU_WIDTH = 200
const ASSET_TOOL_CLASS =
  'flex size-[26px] items-center justify-center rounded-full bg-[rgb(27_27_28/0.6)] text-foreground outline-none backdrop-blur-[12px] transition-colors hover:bg-[rgb(27_27_28/0.8)] focus-visible:shadow-[0_0_0_2px_var(--color-ring)] disabled:opacity-50'

function isLocal(asset: GalleryAsset): boolean {
  return asset.source === LOCAL_ASSETS_SOURCE
}

function folderOf(file: string): string {
  return file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')))
}

function reveal(asset: GalleryAsset): void {
  void window.api.revealAsset(asset.source, asset.id)
}

const assetMenuItems = computed<ContextMenuItem[]>(() => {
  const asset = assetMenu.value?.asset
  if (!asset) return []
  return [
    { id: 'download', label: t('assets.download'), icon: Download },
    ...(isLocal(asset)
      ? [{ id: 'reveal', label: t(revealInFolderKey(window.api.platform)), icon: FolderOpen }]
      : []),
    ...(asset.kind === 'image' && asset.previewUrl
      ? [{ id: 'copy', label: t('assets.copy'), icon: Copy }]
      : []),
    ...(isLocal(asset)
      ? [
          {
            id: 'delete',
            label: t('assets.delete'),
            icon: Trash2,
            style: 'danger' as const,
            separator: true
          }
        ]
      : [])
  ]
})

function openAssetMenu(asset: GalleryAsset, event: MouseEvent): void {
  assetMenu.value = { asset, x: event.clientX, y: event.clientY }
}

function openAssetMenuBelow(asset: GalleryAsset, event: MouseEvent): void {
  const button = (event.currentTarget as HTMLElement).getBoundingClientRect()
  assetMenu.value = { asset, x: button.right - ASSET_MENU_WIDTH, y: button.bottom + 4 }
}

function isMenuOpenFor(asset: GalleryAsset): boolean {
  const open = assetMenu.value?.asset
  return !!open && cardKey(open) === cardKey(asset)
}

async function copy(asset: GalleryAsset): Promise<void> {
  const copied = await window.api.copyAsset(asset.source, asset.id).catch(() => false)
  if (!copied) await modal.alert({ title: t('assets.copyFailed'), message: asset.name })
}

async function moveToTrash(asset: GalleryAsset): Promise<void> {
  const confirmed = await modal.confirm({
    title: t('assets.deleteTitle', { name: asset.name }),
    message:
      window.api.platform === 'win32' ? t('assets.deleteToRecycleBin') : t('assets.deleteToTrash'),
    confirmLabel: t('assets.delete')
  })
  if (!confirmed) return
  const removed = await window.api.trashAsset(asset.source, asset.id).catch(() => false)
  if (removed) assets.value = assets.value.filter((other) => cardKey(other) !== cardKey(asset))
  else await modal.alert({ title: t('assets.deleteFailed'), message: asset.name })
}

async function runAssetAction(action: string): Promise<void> {
  const asset = assetMenu.value?.asset
  assetMenu.value = null
  if (!asset) return
  if (action === 'download') await download(asset)
  else if (action === 'reveal') await window.api.revealAsset(asset.source, asset.id)
  else if (action === 'copy') await copy(asset)
  else if (action === 'delete') await moveToTrash(asset)
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
      <div
        ref="toolbarRow"
        class="mx-auto flex min-h-8 w-full max-w-300 flex-nowrap items-center gap-2 px-10 py-3"
      >
        <Menu
          v-if="selectedBuild"
          :modal="false"
          align="start"
          :side-offset="6"
          class="z-20 w-80 min-w-0 rounded-[14px] border-[rgb(240_240_240/0.07)] bg-[rgb(17_17_17/0.86)] px-1.5 pt-0 pb-1.5 shadow-[0_18px_24px_rgb(0_0_0/0.65),0_1px_1px_rgb(0_0_0/0.2)] backdrop-blur-[16px]"
          :aria-label="t('assets.buildPickerLabel')"
        >
          <template #trigger>
            <button
              type="button"
              class="flex h-[34px] max-w-60 shrink-0 items-center gap-2 rounded-[10px] bg-secondary pr-[13px] pl-[15px] text-[13px]/5 text-foreground outline-none backdrop-blur-[8px] transition-colors hover:bg-[rgb(238_238_238/0.1)] focus-visible:shadow-[0_0_0_2px_var(--color-ring)]"
              :aria-label="t('assets.buildPickerLabel')"
              data-testid="assets-build-picker"
            >
              <component
                :is="selectedBuild.cloud ? Cloud : Laptop"
                :size="14"
                class="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span class="truncate">{{ selectedBuild.build.name }}</span>
              <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </template>
          <div
            class="px-[9px] pt-[12.5px] pb-[8.6px] text-[11px]/[15.4px] font-medium tracking-[0.88px] text-subtle-foreground uppercase"
          >
            {{ t('assets.browseAssetsOf') }}
          </div>
          <DropdownMenuRadioGroup
            :model-value="selectedBuild.build.id"
            class="flex flex-col gap-0.5"
          >
            <MenuRadioItem
              v-for="option in assetBuilds"
              :key="option.build.id"
              as="button"
              type="button"
              :value="option.build.id"
              class="min-h-0 gap-2.5 rounded-lg px-2.5 py-2 data-highlighted:bg-[rgb(255_255_255/0.06)] data-[state=checked]:bg-[rgb(255_255_255/0.06)]"
              :data-testid="`assets-build-${option.build.id}`"
              @select="choosePlace(option.build.id)"
            >
              <span
                class="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-[rgb(240_240_240/0.07)] text-muted-foreground"
              >
                <component :is="option.cloud ? Cloud : Laptop" :size="15" aria-hidden="true" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col text-left">
                <span class="truncate text-[13px]/5 text-foreground">{{ option.build.name }}</span>
                <span
                  class="flex h-4 items-center gap-1.5 text-[12px]/[16.2px] text-subtle-foreground"
                >
                  <span
                    class="size-1.5 shrink-0 rounded-[3px]"
                    :class="option.state === 'running' ? 'bg-success' : 'bg-subtle-foreground'"
                    aria-hidden="true"
                  />
                  {{ buildStatusLabel(option) }}
                </span>
              </span>
              <Check
                v-if="option.build.id === selectedBuild.build.id"
                :size="14"
                class="shrink-0 text-foreground"
                aria-hidden="true"
              />
            </MenuRadioItem>
          </DropdownMenuRadioGroup>
        </Menu>
        <Skeleton
          v-else
          class="h-[34px] w-40 shrink-0 rounded-[10px]"
          data-testid="assets-build-picker-loading"
        />
        <SegmentedControl
          v-if="toolbarCompactness < KINDS_AS_MENU"
          v-model="kindFilter"
          :options="kindOptions"
          :label="t('assets.kindLabel')"
        />
        <div v-else class="shrink-0">
          <Menu
            :modal="false"
            align="start"
            class="z-20 min-w-50"
            :aria-label="t('assets.kindLabel')"
          >
            <template #trigger>
              <Button
                type="button"
                variant="secondary"
                size="md"
                class="gap-1.5 text-[13px]"
                data-testid="assets-kind-menu"
              >
                {{ currentKind.label }}
                <span class="text-subtle-foreground tabular-nums">{{ currentKind.count }}</span>
                <ChevronDown :size="14" aria-hidden="true" />
              </Button>
            </template>
            <DropdownMenuRadioGroup :model-value="kindFilter">
              <MenuRadioItem
                v-for="option in kindOptions"
                :key="option.value"
                as="button"
                type="button"
                :value="option.value"
                class="w-full gap-2.5"
                :data-testid="`assets-kind-menu-${option.value}`"
                @select.prevent="kindFilter = option.value"
              >
                <span class="flex-1 text-left">{{ option.label }}</span>
                <span class="text-subtle-foreground tabular-nums">{{ option.count }}</span>
                <Check v-if="kindFilter === option.value" :size="15" aria-hidden="true" />
              </MenuRadioItem>
            </DropdownMenuRadioGroup>
          </Menu>
        </div>
        <div class="ml-auto flex min-w-0 items-center gap-2">
          <Button
            variant="muted-textonly"
            size="icon"
            type="button"
            :disabled="loading"
            :aria-label="t('assets.refresh')"
            :title="t('assets.refresh')"
            data-testid="assets-refresh"
            @click="refresh"
          >
            <RefreshCw
              :size="13"
              :class="loading && 'animate-spin [animation-duration:900ms]'"
              aria-hidden="true"
            />
          </Button>
          <div v-if="toolbarCompactness < SEARCH_AS_ICON" class="w-[220px] min-w-[150px] shrink">
            <BaseInput
              v-model="searchQuery"
              class="h-8 [&_input]:text-ui"
              :placeholder="t('assets.search')"
              :aria-label="t('assets.search')"
            >
              <template #leading><Search :size="14" /></template>
            </BaseInput>
          </div>
          <div v-else>
            <PopoverRoot v-model:open="searchOpen">
              <PopoverTrigger as-child>
                <Button
                  type="button"
                  :variant="searchQuery ? 'secondary' : 'muted-textonly'"
                  size="icon"
                  :aria-label="t('assets.search')"
                  :title="t('assets.search')"
                  data-testid="assets-search-toggle"
                >
                  <Search :size="15" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" :side-offset="6" class="w-64 p-1.5">
                <BaseInput
                  v-model="searchQuery"
                  class="h-8 [&_input]:text-ui"
                  :placeholder="t('assets.search')"
                  :aria-label="t('assets.search')"
                  data-testid="assets-search-compact"
                  @keydown.enter="searchOpen = false"
                >
                  <template #leading><Search :size="14" /></template>
                </BaseInput>
              </PopoverContent>
            </PopoverRoot>
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
      <p
        v-if="focusMiss && selectedBuild?.cloud"
        role="status"
        class="m-0 mb-4 text-ui text-subtle-foreground"
        data-testid="assets-not-found"
      >
        {{
          t(focusMiss.checked ? 'assets.notFoundInCloud' : 'assets.notCheckedInCloud', {
            name: focusMiss.name
          })
        }}
      </p>
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
            class="flex flex-col rounded-card bg-[rgb(29_29_29/0.72)] p-1"
            :style="cardStyle(card)"
          >
            <Skeleton
              class="w-full rounded-control"
              :style="aspectStyle(skeletonShape(card.index))"
            />
            <div v-if="showName || showDetails" class="flex flex-col gap-2 px-2 pt-3 pb-2.5">
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
          class="group rounded-card bg-[rgb(29_29_29/0.72)] p-1 has-[[data-card-key]:focus-visible]:shadow-[0_0_0_2px_var(--color-ring)]"
          :style="cardStyle(card)"
          :data-testid="`asset-${asset.id}`"
          @contextmenu.prevent="openAssetMenu(asset, $event)"
        >
          <Tooltip
            :text="asset.name"
            side="bottom"
            :delay-ms="nameTooltipsWarm ? 0 : NAME_TOOLTIP_DELAY_MS"
            class="w-full align-top"
          >
            <button
              type="button"
              class="block w-full cursor-pointer text-left outline-none"
              :aria-label="t('assets.inspect', { name: asset.name })"
              :data-testid="`asset-open-${asset.id}`"
              :data-card-key="cardKey(asset)"
              @click="openDetail(asset)"
            >
              <span
                class="relative block overflow-hidden rounded-control bg-[rgb(235_235_235/0.05)]"
                :style="aspectStyle(assetShape(asset))"
              >
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
                  class="flex size-full flex-col items-center justify-center gap-2 text-[14px]/[14px] font-semibold transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  :class="placeholderTint(asset)"
                >
                  <AudioLines v-if="asset.kind === 'audio'" :size="40" aria-hidden="true" />
                  <Box v-else-if="asset.kind === '3d'" :size="40" aria-hidden="true" />
                  <File v-else :size="40" aria-hidden="true" />
                  <span>{{ extensionOf(asset.name) }}</span>
                </span>
                <span
                  v-if="asset.kind === 'video' && asset.durationSeconds"
                  class="absolute bottom-2 left-2 flex h-[22px] items-center gap-[5px] rounded-full bg-[rgb(14_14_14/0.28)] pr-2 pl-[7px] text-[11.5px]/[16.1px] font-medium text-white"
                  data-testid="asset-duration"
                >
                  <Video :size="12" class="opacity-92" aria-hidden="true" />
                  {{ formatPlaybackTime(asset.durationSeconds) }}
                </span>
              </span>
              <span
                v-if="showName || showDetails"
                class="flex min-w-0 flex-col gap-0.5 px-2 pt-2.5 pb-2"
              >
                <span
                  v-if="showName"
                  class="truncate text-[13px]/[18.2px] font-medium text-foreground"
                  >{{ asset.name }}</span
                >
                <span
                  v-if="showDetails"
                  class="truncate text-[12px]/[16.8px] text-subtle-foreground"
                  >{{ assetDetails(asset) }}</span
                >
              </span>
            </button>
          </Tooltip>

          <div
            class="absolute top-3 right-3 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
            :class="isMenuOpenFor(asset) && 'opacity-100'"
          >
            <button
              type="button"
              :class="ASSET_TOOL_CLASS"
              :aria-label="t('assets.download')"
              :title="t('assets.download')"
              :disabled="downloading.has(cardKey(asset))"
              :data-testid="`asset-download-${asset.id}`"
              @click="download(asset)"
            >
              <Download :size="14" aria-hidden="true" />
            </button>
            <button
              type="button"
              :class="ASSET_TOOL_CLASS"
              aria-haspopup="menu"
              :aria-expanded="isMenuOpenFor(asset)"
              :aria-label="t('assets.moreActions')"
              :title="t('assets.moreActions')"
              :data-testid="`asset-more-${asset.id}`"
              @click="openAssetMenuBelow(asset, $event)"
            >
              <Ellipsis :size="15" aria-hidden="true" />
            </button>
          </div>
        </li>
      </ul>
      <p
        v-if="truncated && !showSkeleton"
        class="m-0 mt-6 text-center text-ui text-subtle-foreground"
        data-testid="assets-truncated"
      >
        {{ t('assets.truncated', assets.length) }}
      </p>
    </div>

    <OutputDetailDialog
      v-if="detailIndex !== null"
      v-model:index="detailIndex"
      :items="detailItems"
      @close="closeDetail"
      @download="download(visibleAssets[$event]!)"
      @show-in-folder="reveal(visibleAssets[$event]!)"
    />

    <ContextMenu
      :open="assetMenu !== null"
      :x="assetMenu?.x ?? 0"
      :y="assetMenu?.y ?? 0"
      :items="assetMenuItems"
      @close="assetMenu = null"
      @select="runAssetAction"
    />
  </div>
</template>
