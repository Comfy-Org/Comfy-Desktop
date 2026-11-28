<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize } from '@vueuse/core'
import { Workflow } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import BasePagination from '../components/ui/BasePagination.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { useVirtualMasonry } from '../composables/useVirtualMasonry'
import type { CatalogWorkflow } from '../types/ipc'
import {
  activeFilterCount,
  filterWorkflows,
  sortWorkflows,
  type CardSize,
  type WorkflowFilters,
  type WorkflowSort
} from './exploreWorkflows'

type LoadState = 'loading' | 'ready' | 'failed'

interface LanesByWidth {
  narrow: number
  wide: number
  wider: number
}

const SKELETON_CARD_COUNT = 8
const PAGE_SIZES = [50, 100, 200] as const
const DEFAULT_PAGE_SIZE = 100
const WIDE_CONTAINER_PX = 768
const WIDER_CONTAINER_PX = 1024
const LANES: Record<CardSize, LanesByWidth> = {
  small: { narrow: 2, wide: 4, wider: 5 },
  medium: { narrow: 2, wide: 3, wider: 4 },
  large: { narrow: 1, wide: 2, wider: 3 }
}
const CARD_GAP = 14
const CARD_INSET = 4
const COVER_HEIGHT_PER_WIDTH = 316 / 505
const CAPTION_HEIGHT = 56

const {
  query,
  filters,
  sort = 'popular',
  size = 'medium',
  scrollElement
} = defineProps<{
  query: string
  filters: WorkflowFilters
  sort?: WorkflowSort
  size?: CardSize
  scrollElement: HTMLElement | null
}>()

const emit = defineEmits<{
  'open-workflow': [workflow: CatalogWorkflow]
  'clear-search': []
  'clear-filters': []
  loaded: [workflows: CatalogWorkflow[]]
}>()

const { t, locale } = useI18n()

const scroller = computed(() => scrollElement)
const { width: containerWidth } = useElementSize(scroller)
const lanes = computed(() => {
  const forSize = LANES[size]
  if (containerWidth.value >= WIDER_CONTAINER_PX) return forSize.wider
  if (containerWidth.value >= WIDE_CONTAINER_PX) return forSize.wide
  return forSize.narrow
})
const skeletonStyle = computed(() => ({
  gridTemplateColumns: `repeat(${lanes.value}, minmax(0, 1fr))`
}))
const filtered = computed(() => activeFilterCount(filters) > 0)

const state = ref<LoadState>('loading')
const workflows = ref<CatalogWorkflow[]>([])
const thumbnailsThatFailed = reactive(new Set<string>())
const page = ref(1)
const pageSize = ref(DEFAULT_PAGE_SIZE)

const matchingWorkflows = computed(() =>
  sortWorkflows(filterWorkflows(workflows.value, filters, query), sort, locale.value)
)
const pageWorkflows = computed(() =>
  matchingWorkflows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value)
)

const { cards, galleryStyle, cardStyle, measureCard, scrollToTop } = useVirtualMasonry({
  scroller,
  gallery: useTemplateRef<HTMLElement>('gallery'),
  count: () => pageWorkflows.value.length,
  itemKey: (index) => pageWorkflows.value[index]?.id ?? `workflow:${index}`,
  estimateHeight: (_index, columnWidth) =>
    2 * CARD_INSET + (columnWidth - 2 * CARD_INSET) * COVER_HEIGHT_PER_WIDTH + CAPTION_HEIGHT,
  lanes,
  gap: CARD_GAP,
  relayoutWhen: pageWorkflows
})

const workflowCards = computed(() =>
  cards.value.flatMap((card) => {
    const workflow = pageWorkflows.value[card.index]
    return workflow ? [{ card, workflow }] : []
  })
)

const listShape = computed(() =>
  [query, sort, filters.useCase, filters.model, filters.runsOn, pageSize.value].join('\n')
)
watch(listShape, () => {
  page.value = 1
  scrollToTop()
})
watch(page, () => scrollToTop())

async function loadWorkflows(): Promise<void> {
  state.value = 'loading'
  try {
    workflows.value = await window.api.listCatalogWorkflows()
    page.value = 1
    state.value = 'ready'
    emit('loaded', workflows.value)
  } catch {
    state.value = 'failed'
  }
}

onMounted(() => void loadWorkflows())
</script>

<template>
  <ul
    v-if="state === 'loading'"
    class="m-0 grid list-none gap-3.5 p-0"
    :style="skeletonStyle"
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
    :text="
      query.trim()
        ? t('workflows.noMatches', { query: query.trim() })
        : t('workflows.noFilterMatches')
    "
  >
    <div class="flex items-center gap-2">
      <Button
        v-if="query.trim()"
        type="button"
        variant="secondary"
        size="md"
        class="px-3 text-[13px]/5"
        data-testid="workflows-clear-search"
        @click="emit('clear-search')"
      >
        {{ t('common.clearSearch') }}
      </Button>
      <Button
        v-if="filtered"
        type="button"
        variant="secondary"
        size="md"
        class="px-3 text-[13px]/5"
        data-testid="workflows-clear-filters"
        @click="emit('clear-filters')"
      >
        {{ t('workflows.filters.clear') }}
      </Button>
    </div>
  </EmptyState>

  <template v-else>
    <ul ref="gallery" class="m-0 list-none p-0" :style="galleryStyle" data-testid="workflows-grid">
      <li
        v-for="{ card, workflow } in workflowCards"
        :key="String(card.key)"
        :ref="measureCard"
        :data-index="card.index"
        :style="cardStyle(card)"
      >
        <button
          type="button"
          class="group flex w-full cursor-pointer flex-col rounded-card border-0 bg-[rgb(29_29_29/0.72)] p-1 text-left outline-none transition-colors duration-150 hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
            <span class="min-h-lh truncate text-ui text-subtle-foreground">{{
              workflow.description
            }}</span>
          </span>
        </button>
      </li>
    </ul>
    <BasePagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="matchingWorkflows.length"
      :page-sizes="PAGE_SIZES"
      :page-size-label="t('workflows.perPage')"
      test-id-prefix="workflows"
    />
  </template>
</template>
