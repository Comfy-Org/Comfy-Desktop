<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { Images, Music, Play } from 'lucide-vue-next'
import Badge from '../../design-system/components/Badge.vue'
import Card from '../../design-system/components/Card.vue'
import EmptyState from '../../design-system/components/EmptyState.vue'
import MediaCard from '../../design-system/components/MediaCard.vue'
import SearchInput from '../../design-system/components/SearchInput.vue'
import Select from '../../design-system/components/Select.vue'
import Skeleton from '../../design-system/components/Skeleton.vue'
import AssetDetailPanel from './AssetDetailPanel.vue'
import ContentsNotice from './ContentsNotice.vue'
import LoadMore from './LoadMore.vue'
import { useInstallContents } from './useInstallContents'
import { formatRelativeFromMs } from '../../lib/datetime'
import { formatBytes } from '../../lib/formatting'
import type { InstallAsset, Installation } from '../../types/ipc'

/** A build's images, video and audio, newest first, in 16:9 tiles that show
 *  each whole. Picking one opens its details beside the gallery; arrow keys
 *  move through them and Escape closes them. */
const props = defineProps<{ installation: Installation }>()

const { t } = useI18n()
const filter = ref<'all' | InstallAsset['mediaType']>('all')
const query = ref('')
const sort = ref<'modified' | 'name'>('modified')
const contents = useInstallContents<InstallAsset>(
  (id, request) => window.api.listInstallAssets(id, request),
  () => props.installation,
  { query, sort, filter: computed(() => (filter.value === 'all' ? undefined : filter.value)) }
)
const { items, loading, error, signedOut, hasMore } = contents

const selectedId = ref<string | null>(null)
const selectedIndex = computed(() => items.value.findIndex((a) => a.id === selectedId.value))
const selected = computed(() => items.value[selectedIndex.value] ?? null)

function select(asset: InstallAsset): void {
  selectedId.value = selectedId.value === asset.id ? null : asset.id
}
function step(delta: -1 | 1): void {
  const next = items.value[selectedIndex.value + delta]
  if (next) selectedId.value = next.id
}

/** Controls that use these keys themselves: fields, players, open lists. */
const OWNS_KEYS =
  'input, textarea, select, [contenteditable], video, audio, [role=listbox], [role=menu]'

/** The panel's keys, unless a control is using them. */
function onKeydown(event: KeyboardEvent): void {
  if (!selected.value || event.defaultPrevented) return
  if (event.target instanceof Element && event.target.closest(OWNS_KEYS)) return
  if (event.key === 'Escape') selectedId.value = null
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') step(-1)
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') step(1)
  else return
  event.preventDefault()
}
useEventListener(window, 'keydown', onKeydown)

const revealError = ref<string | null>(null)
async function reveal(asset: InstallAsset): Promise<void> {
  const result = await window.api.revealInstallAsset(props.installation.id, asset.id)
  revealError.value = result.ok ? null : (result.message ?? null)
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(--spacing(60),1fr))] gap-4'
</script>

<template>
  <div class="mt-4 flex h-12 items-center gap-2">
    <Select
      v-model="filter"
      class="w-36"
      :options="[
        { value: 'all', label: t('buildsDashboard.assets.allTypes') },
        { value: 'image', label: t('buildsDashboard.assets.images') },
        { value: 'video', label: t('buildsDashboard.assets.video') },
        { value: 'audio', label: t('buildsDashboard.assets.audio') }
      ]"
    />
    <div class="ml-auto flex items-center gap-2">
      <SearchInput
        v-model="query"
        :placeholder="t('buildsDashboard.assets.search')"
        :clear-label="t('common.clear')"
        class="w-52"
      />
      <Select
        v-model="sort"
        :label="t('buildsDashboard.sort.label')"
        class="w-36"
        :options="[
          { value: 'modified', label: t('buildsDashboard.sort.newest') },
          { value: 'name', label: t('buildsDashboard.sort.name') }
        ]"
      />
    </div>
  </div>

  <ContentsNotice :error :signed-out="signedOut" @retry="contents.refresh" />
  <template v-if="!error && !signedOut">
    <p v-if="revealError" class="mt-1 text-ui text-status-danger">{{ revealError }}</p>
    <div
      v-if="loading && !items.length"
      role="status"
      :aria-label="t('buildsDashboard.loading')"
      :class="['mt-3', GRID]"
    >
      <Card v-for="i in 8" :key="i" padding="xs">
        <Skeleton class="aspect-video h-auto rounded-control" />
        <div class="flex flex-col gap-2 px-2 pt-2.5 pb-2">
          <Skeleton class="w-3/4" />
          <Skeleton class="h-3 w-1/2" />
        </div>
      </Card>
    </div>
    <div v-else-if="items.length" class="mt-3 flex items-start gap-4">
      <div :class="['min-w-0 flex-1', GRID]" data-testid="dashboard-assets">
        <MediaCard
          v-for="asset in items"
          :key="asset.id"
          :src="asset.mediaType === 'image' ? asset.url : undefined"
          :selected="asset.id === selectedId"
          :aria-label="asset.name"
          :aria-pressed="asset.id === selectedId"
          @click="select(asset)"
          @keydown.enter="select(asset)"
          @keydown.space.prevent="select(asset)"
        >
          <template v-if="asset.mediaType === 'video'" #media>
            <video :src="asset.url" muted preload="metadata" class="size-full object-contain" />
          </template>
          <template v-else-if="asset.mediaType === 'audio'" #media>
            <span class="flex size-full items-center justify-center text-muted-foreground">
              <Music :size="22" />
            </span>
          </template>
          <template v-if="asset.mediaType === 'video'" #bottom-right>
            <Badge variant="overlay" size="md" class="px-1.5"><Play :size="11" /></Badge>
          </template>
          <p class="truncate text-ui font-medium">{{ asset.name }}</p>
          <p class="truncate text-ui text-subtle-foreground">
            {{ formatBytes(asset.size) }} · {{ formatRelativeFromMs(asset.modifiedAt, t) }}
          </p>
        </MediaCard>
      </div>
      <AssetDetailPanel
        v-if="selected"
        :asset="selected"
        :has-previous="selectedIndex > 0"
        :has-next="selectedIndex < items.length - 1"
        @close="selectedId = null"
        @step="step"
        @reveal="reveal"
      />
    </div>
    <EmptyState
      v-else
      :icon="Images"
      :title="
        query.trim() || filter !== 'all'
          ? t('buildsDashboard.assets.noMatches')
          : t('buildsDashboard.assets.emptyTitle')
      "
      :description="
        query.trim() || filter !== 'all' ? undefined : t('buildsDashboard.assets.emptyDescription')
      "
      class="mt-4"
    />
    <LoadMore v-if="hasMore" :loading @load="contents.loadMore" />
  </template>
</template>
