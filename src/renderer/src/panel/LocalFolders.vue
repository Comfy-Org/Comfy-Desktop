<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Folder, FolderOpen } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import AssetCard from './AssetCard.vue'
import { useModal } from '../composables/useModal'
import OutputDetailDialog from './OutputDetailDialog.vue'
import type { OutputDetailItem } from './OutputDetailDialog.vue'
import { formatBytes } from '../lib/downloadFormatters'
import { formatRelativeFromMs } from '../lib/datetime'
import type { AssetKind, OutputEntry, OutputFolder, OutputFolderListing } from '../types/ipc'

interface Crumb {
  name: string
  path: string
}

const NAME_TOOLTIP_DELAY_MS = 600
const SKELETON_COUNT = 8

const props = defineProps<{
  kind: 'all' | AssetKind
  query: string
  sort: 'newest' | 'oldest'
  layout: 'masonry' | 'grid'
  layoutClass: string
  showName: boolean
  showDetails: boolean
}>()

const folder = defineModel<string | null>('folder', { required: true })

const emit = defineEmits<{ 'clear-filters': [] }>()

const { t } = useI18n()
const modal = useModal()
const root = useTemplateRef<HTMLElement>('root')
const folders = ref<OutputFolder[] | null>(null)
const trail = ref<Crumb[]>([])
const listing = ref<OutputFolderListing | null>(null)
const failed = ref(false)
const loading = ref(false)
const detailPath = ref<string | null>(null)
let request = 0

const current = computed(() => trail.value.at(-1) ?? null)
const subfolders = computed(() =>
  (listing.value?.entries ?? [])
    .filter((entry) => entry.isFolder)
    .toSorted((a, b) => a.name.localeCompare(b.name))
)
const files = computed(() => (listing.value?.entries ?? []).filter((e) => !e.isFolder && e.kind))
const visibleFiles = computed(() => {
  const query = props.query.trim().toLowerCase()
  const direction = props.sort === 'newest' ? -1 : 1
  return files.value
    .filter((entry) => props.kind === 'all' || entry.kind === props.kind)
    .filter((entry) => !query || entry.name.toLowerCase().includes(query))
    .toSorted((a, b) => direction * a.modifiedAt.localeCompare(b.modifiedAt))
})
const detailItems = computed<OutputDetailItem[]>(() =>
  visibleFiles.value.map((entry) => ({
    key: entry.path,
    name: entry.name,
    kind: entry.kind,
    sizeBytes: entry.sizeBytes,
    createdAt: entry.modifiedAt,
    tags: [],
    previewUrl: entry.previewUrl,
    workflow: null,
    savedIn: current.value?.path ?? null
  }))
)
const detailIndex = computed<number | null>({
  get: () => {
    const index = visibleFiles.value.findIndex((entry) => entry.path === detailPath.value)
    return index >= 0 ? index : null
  },
  set: (index) =>
    (detailPath.value = (index === null ? null : visibleFiles.value[index]?.path) ?? null)
})

function folderLabel(output: OutputFolder): string {
  return output.shared
    ? t('assets.local.sharedOutput')
    : t('assets.local.buildOutput', { name: output.builds.join(', ') })
}

function usedBy(output: OutputFolder): string {
  return output.builds.length > 0
    ? t('assets.local.usedBy', { builds: output.builds.join(', ') })
    : t('assets.local.notUsed')
}

function fileDetails(entry: OutputEntry): string {
  return [
    formatRelativeFromMs(Date.parse(entry.modifiedAt), t),
    entry.sizeBytes === null ? null : formatBytes(entry.sizeBytes)
  ]
    .filter(Boolean)
    .join(' · ')
}

async function loadFolders(): Promise<void> {
  const mine = ++request
  loading.value = true
  failed.value = false
  try {
    const found = await window.api.listOutputFolders()
    if (mine === request) folders.value = found
  } catch {
    if (mine === request) failed.value = true
  } finally {
    if (mine === request) loading.value = false
  }
}

async function loadListing(path: string): Promise<void> {
  const mine = ++request
  loading.value = true
  failed.value = false
  try {
    const found = await window.api.listOutputFolder(path)
    if (mine !== request) return
    listing.value = found
    failed.value = found === null
  } catch {
    if (mine === request) failed.value = true
  } finally {
    if (mine === request) loading.value = false
  }
}

async function reload(): Promise<void> {
  if (current.value) await loadListing(current.value.path)
  else await loadFolders()
}

function goTo(depth: number): void {
  trail.value = trail.value.slice(0, depth)
}

function enter(crumb: Crumb): void {
  trail.value = [...trail.value, crumb]
}

watch(
  () => current.value?.path ?? null,
  (path) => {
    folder.value = path
    listing.value = null
    detailPath.value = null
    void (path ? loadListing(path) : loadFolders())
  },
  { immediate: true }
)

watch(visibleFiles, (list) => {
  if (detailPath.value !== null && !list.some((entry) => entry.path === detailPath.value))
    detailPath.value = null
})

async function closeDetail(): Promise<void> {
  const viewed = detailPath.value ?? ''
  detailPath.value = null
  await nextTick()
  root.value?.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(viewed)}"]`)?.focus()
}

async function openFolder(path: string): Promise<void> {
  const error = await window.api.openPath(path)
  if (error) await modal.alert({ title: t('assets.local.folderFailed'), message: path })
}

function showInFolder(path: string): void {
  window.api.revealPath(path)
}

function showFileAt(index: number): void {
  const entry = visibleFiles.value[index]
  if (entry) showInFolder(entry.path)
}

defineExpose({ reload, loading })
</script>

<template>
  <OutputDetailDialog
    v-if="detailIndex !== null"
    v-model:index="detailIndex"
    :items="detailItems"
    :downloadable="false"
    @close="closeDetail"
    @show-in-folder="showFileAt"
  />
  <div
    ref="root"
    class="mx-auto flex w-full max-w-300 flex-col gap-5 px-10 pt-2 pb-24"
    data-testid="local-folders"
  >
    <div v-if="current" class="flex min-h-8 items-center gap-3">
      <nav
        class="flex min-w-0 flex-wrap items-center gap-1 text-ui"
        :aria-label="t('assets.local.path')"
      >
        <template
          v-for="(crumb, depth) in [{ name: t('assets.place.computer'), path: '' }, ...trail]"
          :key="depth"
        >
          <ChevronRight
            v-if="depth > 0"
            :size="14"
            class="shrink-0 text-subtle-foreground"
            aria-hidden="true"
          />
          <span v-if="depth === trail.length" class="truncate text-foreground" aria-current="page">
            {{ crumb.name }}
          </span>
          <button
            v-else
            type="button"
            class="cursor-pointer truncate rounded-md text-muted-foreground hover:text-foreground"
            :data-testid="`local-crumb-${depth}`"
            @click="goTo(depth)"
          >
            {{ crumb.name }}
          </button>
        </template>
      </nav>
      <Button
        type="button"
        variant="secondary"
        size="md"
        class="ml-auto shrink-0 gap-1.5 px-3 text-ui"
        :title="current.path"
        data-testid="local-open-folder"
        @click="openFolder(current.path)"
      >
        <FolderOpen :size="15" aria-hidden="true" />
        {{ t('assets.local.openFolder') }}
      </Button>
    </div>

    <section
      v-if="failed"
      class="flex flex-col items-center gap-1.5 px-6 py-16 text-center"
      data-testid="local-failed"
    >
      <h2 class="m-0 text-heading font-semibold text-foreground">
        {{ current ? t('assets.local.folderFailed') : t('assets.loadFailed') }}
      </h2>
      <Button
        v-if="current"
        type="button"
        variant="secondary"
        size="md"
        class="mt-6 px-4 text-ui"
        @click="goTo(0)"
      >
        {{ t('assets.local.backToComputer') }}
      </Button>
    </section>

    <template v-else-if="!current">
      <ul
        v-if="folders === null"
        class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0"
        role="status"
        :aria-label="t('common.loading')"
      >
        <li v-for="n in 2" :key="n"><Skeleton class="h-[92px] w-full rounded-xl" /></li>
      </ul>
      <section
        v-else-if="folders.length === 0"
        class="flex flex-col items-center gap-1.5 px-6 py-16 text-center"
        data-testid="local-no-folders"
      >
        <h2 class="m-0 text-heading font-semibold text-foreground">
          {{ t('assets.local.noFoldersTitle') }}
        </h2>
        <p class="m-0 text-ui text-muted-foreground">{{ t('assets.local.noFoldersBody') }}</p>
      </section>
      <ul
        v-else
        class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0"
      >
        <li v-for="output in folders" :key="output.path">
          <button
            type="button"
            class="flex w-full cursor-pointer items-start gap-3 rounded-xl bg-card p-4 text-left transition-colors duration-150 hover:bg-card-hover"
            :data-testid="`local-folder-${output.path}`"
            @click="enter({ name: folderLabel(output), path: output.path })"
          >
            <Folder :size="20" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate text-ui font-medium text-foreground">{{
                folderLabel(output)
              }}</span>
              <span class="truncate text-ui text-subtle-foreground" :title="usedBy(output)">{{
                usedBy(output)
              }}</span>
              <span class="truncate text-ui text-subtle-foreground" :title="output.path">{{
                output.path
              }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>

    <template v-else>
      <ul
        v-if="subfolders.length > 0"
        class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0"
      >
        <li v-for="entry in subfolders" :key="entry.path">
          <button
            type="button"
            class="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg bg-card px-3 text-left text-ui text-foreground transition-colors duration-150 hover:bg-card-hover"
            :data-testid="`local-subfolder-${entry.name}`"
            @click="enter({ name: entry.name, path: entry.path })"
          >
            <Folder :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="truncate">{{ entry.name }}</span>
          </button>
        </li>
      </ul>

      <div v-if="listing === null" role="status" :aria-label="t('common.loading')">
        <ul class="m-0 list-none p-0" :class="layoutClass">
          <li v-for="n in SKELETON_COUNT" :key="n" class="bg-secondary">
            <Skeleton class="aspect-video w-full rounded-none" />
          </li>
        </ul>
      </div>
      <section
        v-else-if="visibleFiles.length === 0 && (files.length > 0 || subfolders.length === 0)"
        class="flex flex-col items-center gap-1.5 px-6 py-16 text-center"
        data-testid="local-empty"
      >
        <template v-if="files.length > 0">
          <h2 class="m-0 text-heading font-semibold text-foreground">
            {{ t('assets.noMatches') }}
          </h2>
          <Button
            type="button"
            variant="secondary"
            size="md"
            class="mt-6 px-4 text-ui"
            data-testid="local-clear-filters"
            @click="emit('clear-filters')"
          >
            {{ t('assets.local.clearFilters') }}
          </Button>
          <p v-if="listing.truncated" class="m-0 mt-4 text-ui text-subtle-foreground">
            {{ t('assets.local.truncated', files.length) }}
          </p>
        </template>
        <p v-else class="m-0 text-ui text-muted-foreground">
          {{ t('assets.local.emptyFolder') }}
        </p>
      </section>
      <template v-else>
        <ul class="m-0 list-none p-0" :class="layoutClass" data-testid="local-grid">
          <AssetCard
            v-for="entry in visibleFiles"
            :key="entry.path"
            :item-test-id="`local-file-${entry.name}`"
            :name="entry.name"
            :kind="entry.kind"
            :image-url="entry.thumbnailUrl"
            :video-url="entry.kind === 'video' ? entry.previewUrl : null"
            :layout="layout"
            :details="fileDetails(entry)"
            :show-name="showName"
            :show-details="showDetails"
            :tooltip-delay-ms="NAME_TOOLTIP_DELAY_MS"
            :data-card-key="entry.path"
            @open="detailPath = entry.path"
          >
            <template #action>
              <Button
                type="button"
                variant="muted-textonly"
                size="icon"
                class="bg-media-overlay text-foreground"
                :aria-label="t('assets.showInFolder')"
                :title="t('assets.showInFolder')"
                :data-testid="`local-show-${entry.name}`"
                @click="showInFolder(entry.path)"
              >
                <FolderOpen :size="14" aria-hidden="true" />
              </Button>
            </template>
          </AssetCard>
        </ul>
        <p v-if="listing.truncated" class="m-0 text-center text-ui text-subtle-foreground">
          {{ t('assets.local.truncated', files.length) }}
        </p>
      </template>
    </template>
  </div>
</template>
