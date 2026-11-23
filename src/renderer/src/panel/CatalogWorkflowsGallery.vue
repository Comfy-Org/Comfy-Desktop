<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Workflow } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import EmptyState from '../components/ui/EmptyState.vue'
import type { CatalogWorkflow } from '../types/ipc'

type LoadState = 'loading' | 'ready' | 'failed'

const SKELETON_CARD_COUNT = 8
const GRID_CLASS = 'm-0 grid list-none grid-cols-2 gap-3.5 p-0 @3xl:grid-cols-3 @5xl:grid-cols-4'

const { query } = defineProps<{ query: string }>()

const emit = defineEmits<{
  'open-workflow': [workflow: CatalogWorkflow]
  'clear-search': []
}>()

const { t } = useI18n()

const state = ref<LoadState>('loading')
const workflows = ref<CatalogWorkflow[]>([])
const thumbnailsThatFailed = reactive(new Set<string>())

const matchingWorkflows = computed(() => {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return workflows.value
  return workflows.value.filter((workflow) =>
    `${workflow.title}\n${workflow.description}`.toLocaleLowerCase().includes(needle)
  )
})

async function loadWorkflows(): Promise<void> {
  state.value = 'loading'
  try {
    workflows.value = await window.api.listCatalogWorkflows()
    state.value = 'ready'
  } catch {
    state.value = 'failed'
  }
}

onMounted(() => void loadWorkflows())
</script>

<template>
  <ul
    v-if="state === 'loading'"
    :class="GRID_CLASS"
    aria-busy="true"
    data-testid="workflows-loading"
  >
    <li v-for="card in SKELETON_CARD_COUNT" :key="card" class="min-w-0">
      <Skeleton class="aspect-[505/316] w-full rounded-card" />
    </li>
  </ul>

  <div
    v-else-if="state === 'failed'"
    class="flex flex-col items-center justify-center gap-3 pt-24 text-center"
    data-testid="workflows-failed"
  >
    <h2 class="m-0 text-heading font-semibold text-foreground">
      {{ t('workflows.failedTitle') }}
    </h2>
    <p class="m-0 max-w-90 text-ui text-muted-foreground">{{ t('workflows.failedBody') }}</p>
    <Button
      type="button"
      variant="secondary"
      size="md"
      class="mt-1"
      data-testid="workflows-retry"
      @click="loadWorkflows"
    >
      {{ t('apps.retry') }}
    </Button>
  </div>

  <EmptyState
    v-else-if="workflows.length === 0"
    class="pt-24"
    data-testid="workflows-empty"
    :icon="Workflow"
    :title="t('workflows.emptyTitle')"
    :text="t('workflows.emptyBody')"
  />

  <EmptyState
    v-else-if="matchingWorkflows.length === 0"
    class="pt-24"
    data-testid="workflows-no-matches"
    :icon="Workflow"
    :title="t('common.nothingMatches')"
    :text="t('workflows.noMatches', { query: query.trim() })"
  >
    <Button
      type="button"
      variant="secondary"
      size="md"
      class="px-3 text-[13px]/5"
      data-testid="workflows-clear-search"
      @click="emit('clear-search')"
    >
      {{ t('common.clearSearch') }}
    </Button>
  </EmptyState>

  <ul v-else :class="GRID_CLASS" data-testid="workflows-grid">
    <li v-for="workflow in matchingWorkflows" :key="workflow.id" class="min-w-0">
      <button
        type="button"
        class="group flex size-full cursor-pointer flex-col rounded-card border-0 bg-[rgb(29_29_29/0.72)] p-1 text-left outline-none transition-colors duration-150 hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        :data-testid="`workflow-card-${workflow.id}`"
        @click="emit('open-workflow', workflow)"
      >
        <span
          class="relative block aspect-[505/316] w-full overflow-hidden rounded-control bg-[rgb(235_235_235/0.05)]"
        >
          <img
            v-if="workflow.thumbnailUrl && !thumbnailsThatFailed.has(workflow.id)"
            :src="workflow.thumbnailUrl"
            alt=""
            loading="lazy"
            class="block size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            @error="thumbnailsThatFailed.add(workflow.id)"
          />
          <span
            v-else
            class="flex size-full items-center justify-center text-subtle-foreground"
            data-testid="workflow-card-no-cover"
          >
            <Workflow :size="28" :stroke-width="1.5" aria-hidden="true" />
          </span>
        </span>
        <span class="flex min-w-0 flex-col px-1.5 pt-2.5 pb-1.5">
          <span class="truncate text-ui font-medium text-foreground">{{ workflow.title }}</span>
          <span class="truncate text-ui text-subtle-foreground">{{ workflow.description }}</span>
        </span>
      </button>
    </li>
  </ul>
</template>
