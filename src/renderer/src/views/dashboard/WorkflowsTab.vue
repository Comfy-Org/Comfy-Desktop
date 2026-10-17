<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Workflow } from 'lucide-vue-next'
import EmptyState from '../../design-system/components/EmptyState.vue'
import ListTable from '../../design-system/components/ListTable.vue'
import SearchInput from '../../design-system/components/SearchInput.vue'
import Select from '../../design-system/components/Select.vue'
import ContentsNotice from './ContentsNotice.vue'
import LoadMore from './LoadMore.vue'
import { useInstallContents } from './useInstallContents'
import { formatRelativeFromMs } from '../../lib/datetime'
import { formatBytes } from '../../lib/formatting'
import type { Installation, InstallWorkflow } from '../../types/ipc'

/** A build's saved workflows, as a list (they have no preview image).
 *  Opening one starts or opens the build: ComfyUI cannot be asked to open a
 *  given saved workflow yet. */
const props = defineProps<{ installation: Installation }>()
const emit = defineEmits<{ open: [installation: Installation] }>()

const { t } = useI18n()
const query = ref('')
const sort = ref<'modified' | 'name'>('modified')
const contents = useInstallContents<InstallWorkflow>(
  (id, request) => window.api.listInstallWorkflows(id, request),
  () => props.installation,
  { query, sort }
)
const { items, loading, error, signedOut, hasMore } = contents

const columns = computed(() => [
  { key: 'name', label: t('buildsDashboard.columns.name') },
  { key: 'folder', label: t('buildsDashboard.columns.folder'), width: '200px' },
  { key: 'modifiedAt', label: t('buildsDashboard.columns.modified'), width: '140px' },
  { key: 'size', label: t('buildsDashboard.columns.size'), width: '90px', align: 'end' as const }
])
</script>

<template>
  <div class="mt-4 flex h-12 items-center justify-end gap-2">
    <SearchInput
      v-model="query"
      :placeholder="t('buildsDashboard.workflows.search')"
      :clear-label="t('common.clear')"
      class="w-52"
    />
    <Select
      v-model="sort"
      :label="t('buildsDashboard.sort.label')"
      class="w-40"
      :options="[
        { value: 'modified', label: t('buildsDashboard.sort.lastEdited') },
        { value: 'name', label: t('buildsDashboard.sort.name') }
      ]"
    />
  </div>

  <ContentsNotice :error :signed-out="signedOut" @retry="contents.refresh" />
  <template v-if="!error && !signedOut">
    <ListTable
      v-if="items.length || loading"
      :columns
      :rows="items"
      :row-key="(wf) => wf.path"
      :loading
      :loading-label="t('buildsDashboard.loading')"
      interactive
      class="mt-3"
      data-testid="dashboard-workflows"
      @activate="emit('open', installation)"
    >
      <template #cell-name="{ row }">
        <span class="flex min-w-0 items-center gap-2.5">
          <Workflow :size="15" class="shrink-0 text-subtle-foreground" />
          <span class="truncate font-medium">{{ row.name }}</span>
        </span>
      </template>
      <template #cell-folder="{ row }">
        <span class="text-muted-foreground">{{ row.folder || '—' }}</span>
      </template>
      <template #cell-modifiedAt="{ row }">
        <span class="text-muted-foreground">{{ formatRelativeFromMs(row.modifiedAt, t) }}</span>
      </template>
      <template #cell-size="{ row }">
        <span class="text-subtle-foreground">{{ formatBytes(row.size) }}</span>
      </template>
    </ListTable>
    <EmptyState
      v-else
      :icon="Workflow"
      :title="
        query.trim()
          ? t('buildsDashboard.workflows.noMatches')
          : t('buildsDashboard.workflows.emptyTitle')
      "
      :description="query.trim() ? undefined : t('buildsDashboard.workflows.emptyDescription')"
      class="mt-4"
    />
    <LoadMore v-if="hasMore" :loading @load="contents.loadMore" />
  </template>
</template>
