<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, ArrowUpRight, Search } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import AppPageHost from './AppPageHost.vue'
import AppBadges from './AppBadges.vue'
import CoverRotation from '../components/CoverRotation.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { badgeDescriptionIds } from './appCardBadges'
import type { AppCard } from '../types/ipc'

type LoadState = 'loading' | 'ready' | 'failed'

const SKELETON_CARD_COUNT = 7

const { revisit = 0 } = defineProps<{ revisit?: number }>()

const startWith = defineModel<AppCard | null>('startWith', { default: null })

const emit = defineEmits<{
  'app-open-change': [open: boolean]
  'view-in-assets': [name: string]
}>()

const { t } = useI18n()

const state = ref<LoadState>('loading')
const apps = ref<AppCard[]>([])
const query = ref('')
const openApp = ref<AppCard | null>(null)
const coversThatFailed = reactive(new Set<string>())
const cardButtons = new Map<string, HTMLElement>()
const keyboardFocusedId = ref<string | null>(null)
const badgeIdPrefix = useId()

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

const RHYTHM_GRID_CLASS =
  'm-0 grid list-none grid-cols-2 gap-3.5 p-0 @3xl:grid-cols-6 @5xl:grid-cols-12'

function rhythmSpanClass(index: number): string {
  const medium = index % 5 < 2 ? '@3xl:col-span-3' : '@3xl:col-span-2'
  const wide = index % 7 < 3 ? '@5xl:col-span-4' : '@5xl:col-span-3'
  return `${medium} ${wide}`
}

function rememberCard(id: string, element: unknown): void {
  if (element instanceof HTMLElement) cardButtons.set(id, element)
  else cardButtons.delete(id)
}

function badgeIdPrefixFor(app: AppCard): string {
  return `${badgeIdPrefix}-${app.id}`
}

function badgesDescribing(app: AppCard): string | undefined {
  return badgeDescriptionIds(badgeIdPrefixFor(app), app.badges)
}

function noteCardFocus(app: AppCard, event: FocusEvent): void {
  const card = event.currentTarget
  keyboardFocusedId.value =
    card instanceof HTMLElement && card.matches(':focus-visible') ? app.id : null
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
  startWith,
  (app) => {
    if (!app) return
    startWith.value = null
    open(app)
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
          :class="RHYTHM_GRID_CLASS"
          aria-busy="true"
          data-testid="apps-loading"
        >
          <li
            v-for="card in SKELETON_CARD_COUNT"
            :key="card"
            class="min-w-0"
            :class="rhythmSpanClass(card - 1)"
          >
            <Skeleton class="aspect-square w-full rounded-card" />
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

        <ul v-else :class="RHYTHM_GRID_CLASS" data-testid="apps-grid">
          <li
            v-for="(app, index) in matchingApps"
            :key="app.id"
            class="min-w-0"
            :class="rhythmSpanClass(index)"
          >
            <button
              :ref="(element) => rememberCard(app.id, element)"
              type="button"
              class="group relative block aspect-square w-full cursor-pointer overflow-hidden rounded-card border-0 bg-[rgb(235_235_235/0.05)] p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-describedby="badgesDescribing(app)"
              :data-testid="`app-card-${app.id}`"
              @click="open(app)"
              @focus="noteCardFocus(app, $event)"
              @blur="keyboardFocusedId = null"
            >
              <span
                class="absolute inset-0 block overflow-hidden transition-transform duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] group-focus-visible:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:scale-100"
                data-testid="app-card-picture"
              >
                <CoverRotation
                  v-if="app.covers.length > 0 && !coversThatFailed.has(app.id)"
                  :pictures="app.covers"
                  @broken="coversThatFailed.add(app.id)"
                />
                <span
                  v-else
                  class="flex size-full items-center justify-center text-subtle-foreground"
                  data-testid="app-card-no-cover"
                >
                  <AppWindow :size="28" :stroke-width="1.5" aria-hidden="true" />
                </span>
                <AppBadges
                  v-if="app.badges?.length"
                  :badges="app.badges"
                  :description-id-prefix="badgeIdPrefixFor(app)"
                  :revealed="keyboardFocusedId === app.id"
                  class="absolute top-2 left-2 max-w-[calc(100%-1rem)]"
                />
              </span>
              <span
                class="pointer-events-none absolute inset-0 bg-linear-to-t from-black/66 to-transparent to-46%"
                aria-hidden="true"
              />
              <span
                class="absolute top-3 right-3 grid size-8 scale-90 place-items-center rounded-[9px] bg-white/20 text-white opacity-0 backdrop-blur-[14px] backdrop-saturate-150 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-100 group-hover:opacity-100 group-hover:delay-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                aria-hidden="true"
                data-testid="app-card-go"
              >
                <ArrowUpRight :size="16" :stroke-width="2.25" />
              </span>
              <span class="absolute inset-x-3.5 bottom-3 grid">
                <span
                  data-testid="app-card-name"
                  class="truncate text-sm/[17px] font-semibold text-white transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [grid-area:1/1] group-hover:-translate-y-4.5 group-focus-visible:-translate-y-4.5 motion-reduce:transition-none"
                >
                  {{ app.title }}
                </span>
                <span
                  class="translate-y-1.5 self-end truncate text-xs/4 text-white/78 opacity-0 transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [grid-area:1/1] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
                >
                  {{ app.description }}
                </span>
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
