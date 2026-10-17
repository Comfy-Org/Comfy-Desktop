<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Puzzle } from 'lucide-vue-next'
import EmptyState from '../../design-system/components/EmptyState.vue'
import ListTable from '../../design-system/components/ListTable.vue'
import SearchInput from '../../design-system/components/SearchInput.vue'
import ContentsNotice from './ContentsNotice.vue'
import LoadMore from './LoadMore.vue'
import { useInstallContents } from './useInstallContents'
import type { Installation, InstallNodePack } from '../../types/ipc'

/** A build's custom node packs. A local build lists its `custom_nodes`
 *  folder, with versions and which are on; Comfy Cloud lists the packs it
 *  runs (read from its node catalog), with how many nodes each adds. */
const props = defineProps<{ installation: Installation }>()

const { t } = useI18n()
const query = ref('')
const contents = useInstallContents<InstallNodePack>(
  (id, request) => window.api.listInstallNodes(id, request),
  () => props.installation,
  { query }
)
const { items, loading, error, signedOut, hasMore, managed } = contents

const columns = computed(() =>
  props.installation.sourceCategory === 'cloud'
    ? [
        { key: 'name', label: t('buildsDashboard.columns.name') },
        {
          key: 'nodeCount',
          label: t('buildsDashboard.columns.nodes'),
          width: '90px',
          align: 'end' as const
        }
      ]
    : [
        { key: 'name', label: t('buildsDashboard.columns.name') },
        { key: 'version', label: t('buildsDashboard.columns.version'), width: '160px' },
        { key: 'enabled', label: t('buildsDashboard.columns.status'), width: '120px' }
      ]
)
</script>

<template>
  <div class="mt-4 flex h-12 items-center gap-3">
    <p v-if="managed" class="min-w-0 flex-1 truncate text-ui text-subtle-foreground">
      {{ t('buildsDashboard.nodes.managedNote') }}
    </p>
    <SearchInput
      v-model="query"
      :placeholder="t('buildsDashboard.nodes.search')"
      :clear-label="t('common.clear')"
      class="ml-auto w-52 shrink-0"
    />
  </div>

  <ContentsNotice :error :signed-out="signedOut" @retry="contents.refresh" />
  <template v-if="!error && !signedOut">
    <ListTable
      v-if="items.length || loading"
      :columns
      :rows="items"
      :row-key="(n) => n.id"
      :loading
      :loading-label="t('buildsDashboard.loading')"
      class="mt-3"
      data-testid="dashboard-nodes"
    >
      <template #cell-name="{ row }">
        <span class="font-medium">{{ row.name }}</span>
      </template>
      <template #cell-version="{ row }">
        <span class="text-muted-foreground tabular-nums">{{ row.version || '—' }}</span>
      </template>
      <template #cell-enabled="{ row }">
        <span :class="row.enabled ? 'text-muted-foreground' : 'text-subtle-foreground'">{{
          row.enabled ? t('buildsDashboard.nodes.enabled') : t('buildsDashboard.nodes.disabled')
        }}</span>
      </template>
      <template #cell-nodeCount="{ row }">
        <span class="text-subtle-foreground">{{ row.nodeCount }}</span>
      </template>
    </ListTable>
    <EmptyState
      v-else
      :icon="Puzzle"
      :title="
        query.trim() ? t('buildsDashboard.nodes.noMatches') : t('buildsDashboard.nodes.empty')
      "
      class="mt-4"
    />
    <LoadMore v-if="hasMore" :loading @load="contents.loadMore" />
  </template>
</template>
