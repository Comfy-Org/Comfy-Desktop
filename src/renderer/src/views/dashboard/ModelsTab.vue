<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Boxes } from 'lucide-vue-next'
import Badge from '../../design-system/components/Badge.vue'
import EmptyState from '../../design-system/components/EmptyState.vue'
import ListTable from '../../design-system/components/ListTable.vue'
import SearchInput from '../../design-system/components/SearchInput.vue'
import SegmentedControl from '../../design-system/components/SegmentedControl.vue'
import ContentsNotice from './ContentsNotice.vue'
import LoadMore from './LoadMore.vue'
import { useInstallContents } from './useInstallContents'
import { formatRelativeFromMs } from '../../lib/datetime'
import { formatBytes } from '../../lib/formatting'
import type { Installation, InstallModel } from '../../types/ipc'

/** The models a build can load, with a filter row: on Comfy Cloud, all of
 *  them, the user's own uploads or the public catalog; on a local build, its
 *  model types. */
const props = defineProps<{ installation: Installation }>()

const { t } = useI18n()
const ALL = 'all'
const filter = ref(ALL)
const query = ref('')
const contents = useInstallContents<InstallModel>(
  (id, request) => window.api.listInstallModels(id, request),
  () => props.installation,
  { query, filter: computed(() => (filter.value === ALL ? undefined : filter.value)) }
)
const { items, loading, error, signedOut, hasMore, facets } = contents
const isCloud = computed(() => props.installation.sourceCategory === 'cloud')

// A model type that no longer has files leaves the row; fall back to All.
watch(facets, (list) => {
  if (list.length && filter.value !== ALL && !list.some((f) => f.value === filter.value)) {
    filter.value = ALL
  }
})

const filterOptions = computed(() => {
  const countOf = (value: string) => facets.value.find((f) => f.value === value)?.count
  if (isCloud.value) {
    return (['all', 'mine', 'public'] as const).map((value) => ({
      value,
      label: t(`buildsDashboard.models.filter.${value}`),
      count: countOf(value)
    }))
  }
  const total = facets.value.reduce((sum, f) => sum + f.count, 0)
  return [
    { value: ALL, label: t('buildsDashboard.models.filter.all'), count: total || undefined },
    ...facets.value.map((f) => ({ value: f.value, label: f.value, count: f.count }))
  ]
})

const columns = computed(() => [
  { key: 'name', label: t('buildsDashboard.columns.name') },
  { key: 'folder', label: t('buildsDashboard.columns.type'), width: '180px' },
  { key: 'modifiedAt', label: t('buildsDashboard.columns.modified'), width: '140px' },
  { key: 'size', label: t('buildsDashboard.columns.size'), width: '90px', align: 'end' as const }
])
</script>

<template>
  <div class="mt-4 flex h-12 items-center gap-3">
    <div class="min-w-0 flex-1 overflow-x-auto">
      <SegmentedControl v-model="filter" :options="filterOptions" data-testid="models-filter" />
    </div>
    <SearchInput
      v-model="query"
      :placeholder="t('buildsDashboard.models.search')"
      :clear-label="t('common.clear')"
      class="w-52 shrink-0"
    />
  </div>

  <ContentsNotice :error :signed-out="signedOut" @retry="contents.refresh" />
  <template v-if="!error && !signedOut">
    <ListTable
      v-if="items.length || loading"
      :columns
      :rows="items"
      :row-key="(m) => m.id"
      :loading
      :loading-label="t('buildsDashboard.loading')"
      class="mt-3"
      data-testid="dashboard-models"
    >
      <template #cell-name="{ row }">
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate font-mono">{{ row.name }}</span>
          <Badge v-if="row.public && filter !== 'public'">{{
            t('buildsDashboard.models.public')
          }}</Badge>
        </span>
      </template>
      <template #cell-folder="{ row }">
        <span class="text-muted-foreground">{{ row.folder }}</span>
      </template>
      <template #cell-modifiedAt="{ row }">
        <span class="text-muted-foreground">{{
          row.modifiedAt ? formatRelativeFromMs(row.modifiedAt, t) : '—'
        }}</span>
      </template>
      <template #cell-size="{ row }">
        <span class="text-subtle-foreground">{{ formatBytes(row.size) }}</span>
      </template>
    </ListTable>
    <EmptyState
      v-else
      :icon="Boxes"
      :title="
        query.trim() || filter !== ALL
          ? t('buildsDashboard.models.noMatches')
          : t('buildsDashboard.models.empty')
      "
      class="mt-4"
    />
    <LoadMore v-if="hasMore" :loading @load="contents.loadMore" />
  </template>
</template>
