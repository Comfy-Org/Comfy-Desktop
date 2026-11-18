<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, Search, Workflow } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import AppPageHost from './AppPageHost.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import type { AppCard, CatalogWorkflow } from '../types/ipc'

type ExploreTab = 'apps' | 'workflows'
type LoadState = 'unloaded' | 'loading' | 'ready' | 'failed'
type ExploreCard = AppCard | CatalogWorkflow

const SKELETON_CARD_COUNT = 8

const { revisit = 0 } = defineProps<{ revisit?: number }>()

const startWith = defineModel<AppCard | null>('startWith', { default: null })
const tab = defineModel<ExploreTab>('tab', { default: 'apps' })

const emit = defineEmits<{
  'app-open-change': [open: boolean]
  'view-in-assets': [name: string]
  'open-workflow': [workflow: CatalogWorkflow]
}>()

const { t } = useI18n()

const appsEnabled = ref<boolean | null>(null)
const activeTab = computed(() => (appsEnabled.value === false ? 'workflows' : tab.value))
const tabOptions = computed(() => [
  { value: 'apps' as const, label: t('sidebar.apps'), testId: 'explore-apps-tab' },
  { value: 'workflows' as const, label: t('sidebar.workflows'), testId: 'explore-workflows-tab' }
])
const states = reactive<Record<ExploreTab, LoadState>>({ apps: 'unloaded', workflows: 'unloaded' })
const queries = reactive({ apps: '', workflows: '' })
const query = computed({
  get: () => queries[activeTab.value],
  set: (value) => {
    queries[activeTab.value] = value
  }
})
const apps = ref<AppCard[]>([])
const workflows = ref<CatalogWorkflow[]>([])
const openApp = ref<AppCard | null>(null)
const failedCovers = reactive({ apps: new Set<string>(), workflows: new Set<string>() })
const cardButtons = new Map<string, HTMLElement>()

let lastOpenedId: string | null = null
let stopClosedUpdates: (() => void) | null = null

const cards = computed<ExploreCard[]>(() =>
  activeTab.value === 'apps' ? apps.value : workflows.value
)
const matchingCards = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return cards.value
  return cards.value.filter((card) =>
    `${card.title}\n${card.description}`.toLocaleLowerCase().includes(needle)
  )
})

async function loadCards(section: ExploreTab): Promise<void> {
  states[section] = 'loading'
  try {
    if (section === 'apps') apps.value = await window.api.listApps()
    else workflows.value = await window.api.listCatalogWorkflows()
    states[section] = 'ready'
  } catch {
    states[section] = 'failed'
  }
}

function coverOf(card: ExploreCard): string | null {
  return 'coverUrl' in card ? card.coverUrl : card.thumbnailUrl
}

function openCard(card: ExploreCard): void {
  if ('coverUrl' in card) open(card)
  else emit('open-workflow', card)
}

watch([activeTab, appsEnabled], ([section, enabled]) => {
  if (enabled !== null && states[section] === 'unloaded') void loadCards(section)
})

function rememberCard(id: string, element: unknown): void {
  if (element instanceof HTMLElement) cardButtons.set(id, element)
  else cardButtons.delete(id)
}

function open(app: AppCard): void {
  lastOpenedId = app.id
  openApp.value = app
}

async function closeApp(): Promise<void> {
  if (!openApp.value) return
  openApp.value = null
  await nextTick()
  if (lastOpenedId) cardButtons.get(lastOpenedId)?.focus()
}

watch(
  () => revisit,
  () => void closeApp()
)

watch(openApp, (app) => emit('app-open-change', app !== null))

watch([startWith, appsEnabled], ([app, enabled]) => {
  if (!app || enabled === null) return
  startWith.value = null
  if (enabled) open(app)
})

onMounted(async () => {
  stopClosedUpdates = window.api.onAppPageClosed(() => void closeApp())
  appsEnabled.value = await window.api.getAppsEnabled().catch(() => false)
})

onBeforeUnmount(() => {
  stopClosedUpdates?.()
  if (openApp.value) emit('app-open-change', false)
})
</script>

<template>
  <div class="relative flex min-h-0 w-full flex-auto flex-col">
    <div
      v-show="!openApp"
      class="@container flex min-h-0 w-full flex-auto flex-col overflow-y-auto [scrollbar-gutter:stable]"
      :class="PAGE_SPOTLIGHT_CLASS"
      :data-testid="`${activeTab}-view`"
    >
      <header class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
        <h1 class="m-0 font-display text-display font-semibold text-foreground">
          {{ t('sidebar.explore') }}
        </h1>
      </header>

      <div class="mx-auto flex min-h-8 w-full max-w-300 flex-wrap items-center gap-2 px-10 py-3">
        <SegmentedControl
          v-if="appsEnabled"
          v-model="tab"
          :options="tabOptions"
          :label="t('sidebar.explore')"
        />
        <div class="ml-auto w-full max-w-[220px]">
          <BaseInput
            v-model="query"
            class="h-8 [&_input]:text-ui"
            :placeholder="t(`${activeTab}.search`)"
            :aria-label="t(`${activeTab}.search`)"
          >
            <template #leading><Search :size="14" /></template>
          </BaseInput>
        </div>
      </div>

      <div class="mx-auto w-full max-w-300 px-10 pb-10">
        <ul
          v-if="states[activeTab] === 'unloaded' || states[activeTab] === 'loading'"
          class="m-0 grid list-none grid-cols-2 gap-3.5 p-0 @3xl:grid-cols-3 @5xl:grid-cols-4"
          aria-busy="true"
          :data-testid="`${activeTab}-loading`"
        >
          <li
            v-for="card in SKELETON_CARD_COUNT"
            :key="card"
            class="rounded-card bg-[rgb(29_29_29/0.72)] p-1"
          >
            <Skeleton class="aspect-[505/316] w-full rounded-control" />
            <div class="flex flex-col gap-1.5 px-1.5 pt-3 pb-2.5">
              <Skeleton class="h-3.5 w-1/2 rounded-min" />
              <Skeleton class="h-3.5 w-4/5 rounded-min opacity-60" />
            </div>
          </li>
        </ul>

        <div
          v-else-if="states[activeTab] === 'failed'"
          class="flex flex-col items-center justify-center gap-3 pt-24 text-center"
          :data-testid="`${activeTab}-failed`"
        >
          <h2 class="m-0 text-heading font-semibold text-foreground">
            {{ t(`${activeTab}.failedTitle`) }}
          </h2>
          <p class="m-0 max-w-90 text-ui text-muted-foreground">
            {{ t(`${activeTab}.failedBody`) }}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            class="mt-1"
            :data-testid="`${activeTab}-retry`"
            @click="loadCards(activeTab)"
          >
            {{ t('apps.retry') }}
          </Button>
        </div>

        <div
          v-else-if="cards.length === 0"
          class="flex flex-col items-center justify-center gap-2 pt-24 text-center"
          :data-testid="`${activeTab}-empty`"
        >
          <h2 class="m-0 text-heading font-semibold text-foreground">
            {{ t(`${activeTab}.emptyTitle`) }}
          </h2>
          <p class="m-0 text-ui text-muted-foreground">{{ t(`${activeTab}.emptyBody`) }}</p>
        </div>

        <p
          v-else-if="matchingCards.length === 0"
          class="m-0 pt-24 text-center text-ui text-muted-foreground"
          :data-testid="`${activeTab}-no-matches`"
        >
          {{ t(`${activeTab}.noMatches`, { query: query.trim() }) }}
        </p>

        <ul
          v-else
          :key="activeTab"
          class="m-0 grid list-none grid-cols-2 gap-3.5 p-0 @3xl:grid-cols-3 @5xl:grid-cols-4"
          :data-testid="`${activeTab}-grid`"
        >
          <li v-for="card in matchingCards" :key="card.id" class="min-w-0">
            <button
              :ref="
                (element) => {
                  if ('coverUrl' in card) rememberCard(card.id, element)
                }
              "
              type="button"
              class="group flex size-full cursor-pointer flex-col rounded-card border-0 bg-[rgb(29_29_29/0.72)] p-1 text-left outline-none transition-colors duration-150 hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              :data-testid="`${'coverUrl' in card ? 'app' : 'workflow'}-card-${card.id}`"
              @click="openCard(card)"
            >
              <span
                class="relative block aspect-[505/316] w-full overflow-hidden rounded-control bg-[rgb(235_235_235/0.05)]"
              >
                <img
                  v-if="coverOf(card) && !failedCovers[activeTab].has(card.id)"
                  :src="coverOf(card) ?? undefined"
                  alt=""
                  loading="lazy"
                  class="block size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  @error="failedCovers[activeTab].add(card.id)"
                />
                <span
                  v-else
                  class="flex size-full items-center justify-center text-subtle-foreground"
                  :data-testid="`${'coverUrl' in card ? 'app' : 'workflow'}-card-no-cover`"
                >
                  <component
                    :is="activeTab === 'apps' ? AppWindow : Workflow"
                    :size="28"
                    :stroke-width="1.5"
                    aria-hidden="true"
                  />
                </span>
              </span>
              <span class="flex min-w-0 flex-col px-1.5 pt-2.5 pb-1.5">
                <span class="truncate text-ui font-medium text-foreground">{{ card.title }}</span>
                <span class="truncate text-ui text-subtle-foreground">{{ card.description }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
    <div v-if="openApp" class="absolute inset-0 flex">
      <AppPageHost
        :app-id="openApp.id"
        :title="openApp.title"
        @close="closeApp"
        @view-in-assets="emit('view-in-assets', $event)"
      />
    </div>
  </div>
</template>
