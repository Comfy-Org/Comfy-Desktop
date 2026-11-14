<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, Search } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import AppPageHost from './AppPageHost.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import type { AppCard } from '../types/ipc'

type LoadState = 'loading' | 'ready' | 'failed'

const SKELETON_CARD_COUNT = 8

const { revisit = 0, startWith = null } = defineProps<{
  revisit?: number
  startWith?: AppCard | null
}>()

const emit = defineEmits<{ 'app-open-change': [open: boolean] }>()

const { t } = useI18n()

const state = ref<LoadState>('loading')
const apps = ref<AppCard[]>([])
const query = ref('')
const openApp = ref<AppCard | null>(null)
const coversThatFailed = reactive(new Set<string>())
const cardButtons = new Map<string, HTMLElement>()

let lastOpenedId: string | null = null
let stopClosedUpdates: (() => void) | null = null

const matchingApps = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return apps.value
  return apps.value.filter((app) =>
    `${app.title}\n${app.description}`.toLowerCase().includes(needle)
  )
})

async function loadApps(): Promise<void> {
  state.value = 'loading'
  try {
    apps.value = await window.api.listApps()
    state.value = 'ready'
  } catch {
    apps.value = []
    state.value = 'failed'
  }
}

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

watch(
  () => startWith,
  (app) => {
    if (app) open(app)
  },
  { immediate: true }
)

onMounted(() => {
  stopClosedUpdates = window.api.onAppPageClosed(() => void closeApp())
  void loadApps()
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
      data-testid="apps-view"
    >
      <header class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
        <h1 class="m-0 font-display text-display font-semibold text-foreground">
          {{ t('sidebar.apps') }}
        </h1>
      </header>

      <div class="mx-auto flex min-h-8 w-full max-w-300 items-center gap-2 px-10 py-3">
        <div class="ml-auto w-[220px]">
          <BaseInput
            v-model="query"
            class="h-8 [&_input]:text-ui"
            :placeholder="t('apps.search')"
            :aria-label="t('apps.search')"
          >
            <template #leading><Search :size="14" /></template>
          </BaseInput>
        </div>
      </div>

      <div class="mx-auto w-full max-w-300 px-10 pb-10">
        <ul
          v-if="state === 'loading'"
          class="m-0 grid list-none grid-cols-2 gap-3.5 p-0 @3xl:grid-cols-3 @5xl:grid-cols-4"
          aria-busy="true"
          data-testid="apps-loading"
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
          v-else-if="state === 'failed'"
          class="flex flex-col items-center justify-center gap-3 pt-24 text-center"
          data-testid="apps-failed"
        >
          <h2 class="m-0 text-heading font-semibold text-foreground">
            {{ t('apps.failedTitle') }}
          </h2>
          <p class="m-0 max-w-90 text-ui text-muted-foreground">{{ t('apps.failedBody') }}</p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            class="mt-1"
            data-testid="apps-retry"
            @click="loadApps"
          >
            {{ t('apps.retry') }}
          </Button>
        </div>

        <div
          v-else-if="apps.length === 0"
          class="flex flex-col items-center justify-center gap-2 pt-24 text-center"
          data-testid="apps-empty"
        >
          <h2 class="m-0 text-heading font-semibold text-foreground">{{ t('apps.emptyTitle') }}</h2>
          <p class="m-0 text-ui text-muted-foreground">{{ t('apps.emptyBody') }}</p>
        </div>

        <p
          v-else-if="matchingApps.length === 0"
          class="m-0 pt-24 text-center text-ui text-muted-foreground"
          data-testid="apps-no-matches"
        >
          {{ t('apps.noMatches', { query: query.trim() }) }}
        </p>

        <ul
          v-else
          class="m-0 grid list-none grid-cols-2 gap-3.5 p-0 @3xl:grid-cols-3 @5xl:grid-cols-4"
          data-testid="apps-grid"
        >
          <li v-for="app in matchingApps" :key="app.id" class="min-w-0">
            <button
              :ref="(element) => rememberCard(app.id, element)"
              type="button"
              class="group flex size-full cursor-pointer flex-col rounded-card border-0 bg-[rgb(29_29_29/0.72)] p-1 text-left outline-none transition-colors duration-150 hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              :data-testid="`app-card-${app.id}`"
              @click="open(app)"
            >
              <span
                class="relative block aspect-[505/316] w-full overflow-hidden rounded-control bg-[rgb(235_235_235/0.05)]"
              >
                <img
                  v-if="app.coverUrl && !coversThatFailed.has(app.id)"
                  :src="app.coverUrl"
                  alt=""
                  loading="lazy"
                  class="block size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  @error="coversThatFailed.add(app.id)"
                />
                <span
                  v-else
                  class="flex size-full items-center justify-center text-subtle-foreground"
                  data-testid="app-card-no-cover"
                >
                  <AppWindow :size="28" :stroke-width="1.5" aria-hidden="true" />
                </span>
              </span>
              <span class="flex min-w-0 flex-col px-1.5 pt-2.5 pb-1.5">
                <span class="truncate text-ui font-medium text-foreground">{{ app.title }}</span>
                <span class="truncate text-ui text-subtle-foreground">{{ app.description }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
    <div v-if="openApp" class="absolute inset-0 flex">
      <AppPageHost :app-id="openApp.id" :title="openApp.title" @close="closeApp" />
    </div>
  </div>
</template>
