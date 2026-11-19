<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, ArrowUpRight, Plus, Search } from '@lucide/vue'
import { stillsOf } from '../lib/appStills'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import AppPageHost from './AppPageHost.vue'
import AppBadges from './AppBadges.vue'
import CoverRotation from '../components/CoverRotation.vue'
import AppRequestModal from '../components/AppRequestModal.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Tooltip from '../components/ui/Tooltip.vue'
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
const requestOpen = ref(false)
const coversThatFailed = reactive(new Set<string>())
const cardButtons = new Map<string, HTMLElement>()
const keyboardFocusedId = ref<string | null>(null)
const hoveredId = ref<string | null>(null)
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

function nameIsClipped(id: string): boolean {
  const name = cardButtons.get(id)?.querySelector<HTMLElement>('[data-testid="app-card-name"]')
  return !!name && name.scrollWidth > name.clientWidth
}

const REQUEST_THUMB_LIMIT = 3

type RhythmTier = { columns: number; spanOf: (index: number) => number; smallestCard: number }

const RHYTHM_TIERS: Record<'narrow' | 'medium' | 'wide', RhythmTier> = {
  narrow: { columns: 2, spanOf: () => 1, smallestCard: 1 },
  medium: { columns: 6, spanOf: (index) => (index % 5 < 2 ? 3 : 2), smallestCard: 2 },
  wide: { columns: 12, spanOf: (index) => (index % 7 < 3 ? 4 : 3), smallestCard: 3 }
}

function requestSpan(cardCount: number, tier: RhythmTier): { span: number; beside: boolean } {
  let column = 0
  for (let index = 0; index < cardCount; index++) {
    const span = tier.spanOf(index)
    if (column + span > tier.columns) column = 0
    column = (column + span) % tier.columns
  }
  const free = column === 0 ? 0 : tier.columns - column
  return free >= tier.smallestCard
    ? { span: tier.smallestCard, beside: true }
    : { span: tier.columns, beside: false }
}

const requestLayout = computed(() => {
  const count = matchingApps.value.length
  const narrow = requestSpan(count, RHYTHM_TIERS.narrow)
  const medium = requestSpan(count, RHYTHM_TIERS.medium)
  const wide = requestSpan(count, RHYTHM_TIERS.wide)
  return {
    style: {
      '--request-span': narrow.span,
      '--request-span-medium': medium.span,
      '--request-span-wide': wide.span
    },
    class: [
      narrow.beside
        ? 'aspect-square flex-col items-center justify-center gap-4 text-center'
        : 'flex-row items-center gap-3 text-left',
      medium.beside
        ? '@3xl:aspect-square @3xl:flex-col @3xl:items-center @3xl:justify-center @3xl:gap-5 @3xl:text-center'
        : '@3xl:aspect-auto @3xl:flex-row @3xl:items-center @3xl:justify-start @3xl:gap-3 @3xl:text-left',
      wide.beside
        ? '@5xl:aspect-square @5xl:flex-col @5xl:items-center @5xl:justify-center @5xl:gap-5 @5xl:text-center'
        : '@5xl:aspect-auto @5xl:flex-row @5xl:items-center @5xl:justify-start @5xl:gap-3 @5xl:text-left'
    ],
    thumbClass: [
      narrow.beside ? 'size-10 not-first:-ml-2.5' : 'size-8 not-first:-ml-2',
      medium.beside
        ? '@3xl/apps:size-11 @3xl/apps:not-first:-ml-[11px]'
        : '@3xl/apps:size-8 @3xl/apps:not-first:-ml-2',
      wide.beside
        ? '@5xl/apps:size-11 @5xl/apps:not-first:-ml-[11px]'
        : '@5xl/apps:size-8 @5xl/apps:not-first:-ml-2'
    ],
    labelClass: [
      narrow.beside ? 'flex-none gap-2' : 'flex-1 gap-1',
      medium.beside ? '@3xl/apps:flex-none @3xl/apps:gap-2' : '@3xl/apps:flex-1 @3xl/apps:gap-1',
      wide.beside ? '@5xl/apps:flex-none @5xl/apps:gap-2' : '@5xl/apps:flex-1 @5xl/apps:gap-1'
    ],
    bodyClass: [
      narrow.beside ? 'block max-w-[30ch]' : 'hidden max-w-none @[36rem]/request:block',
      medium.beside
        ? '@3xl/apps:block @3xl/apps:max-w-[30ch]'
        : '@3xl/apps:hidden @3xl/apps:max-w-none @3xl/apps:@[36rem]/request:block',
      wide.beside
        ? '@5xl/apps:block @5xl/apps:max-w-[30ch]'
        : '@5xl/apps:hidden @5xl/apps:max-w-none @5xl/apps:@[36rem]/request:block'
    ]
  }
})

const requestThumbs = computed(() =>
  apps.value
    .map((app) => stillsOf(app)[0])
    .filter((still): still is string => Boolean(still))
    .slice(0, REQUEST_THUMB_LIMIT)
)

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

function playsCover(app: AppCard): boolean {
  return (
    app.coverPlayback === 'always' ||
    hoveredId.value === app.id ||
    keyboardFocusedId.value === app.id
  )
}

function open(app: AppCard): void {
  hoveredId.value = null
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
      class="@container/apps flex min-h-0 w-full flex-auto flex-col overflow-y-auto [scrollbar-gutter:stable]"
      :class="PAGE_SPOTLIGHT_CLASS"
      data-testid="apps-view"
    >
      <header class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
        <h1 class="m-0 text-display font-semibold tracking-[-0.055em] text-foreground">
          {{ t('sidebar.apps') }}
        </h1>
      </header>

      <div
        v-if="state === 'loading' || (state === 'ready' && apps.length > 0)"
        class="mx-auto flex min-h-8 w-full max-w-300 items-center gap-2 px-10 py-3"
      >
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

        <EmptyState
          v-else-if="apps.length === 0"
          class="pt-24"
          data-testid="apps-empty"
          :icon="AppWindow"
          :title="t('apps.emptyTitle')"
          :text="t('apps.emptyBody')"
        />

        <div
          v-else-if="matchingApps.length === 0"
          class="flex flex-col items-center gap-3 pt-24 text-center"
          data-testid="apps-no-matches"
        >
          <p class="m-0 text-ui text-muted-foreground">
            {{ t('apps.noMatches', { query: query.trim() }) }}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            data-testid="apps-no-matches-request"
            @click="requestOpen = true"
          >
            {{ t('apps.request.ask') }}
          </Button>
        </div>

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
              @mouseenter="hoveredId = app.id"
              @mouseleave="hoveredId = null"
            >
              <span
                class="absolute inset-0 block overflow-hidden transition-transform duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] group-focus-visible:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:scale-100"
                data-testid="app-card-picture"
              >
                <CoverRotation
                  v-if="app.covers.length > 0 && !coversThatFailed.has(app.id)"
                  :pictures="app.covers"
                  :paused="!playsCover(app)"
                  load-on-play
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
                class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.7),rgb(0_0_0/0.55)_28%,transparent_60%)]"
                aria-hidden="true"
                data-testid="app-card-scrim"
              />
              <span
                class="absolute top-3 right-3 grid size-8 scale-90 place-items-center rounded-[9px] bg-white/20 text-white opacity-0 backdrop-blur-[14px] backdrop-saturate-150 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-100 group-hover:opacity-100 group-hover:delay-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:scale-100 motion-reduce:transition-none"
                aria-hidden="true"
                data-testid="app-card-go"
              >
                <ArrowUpRight :size="16" :stroke-width="2.25" />
              </span>
              <Tooltip
                class="absolute inset-x-3.5 bottom-3 pt-4.5 [&.tooltip-wrap]:grid"
                :text="app.title"
                :should-open="() => nameIsClipped(app.id)"
              >
                <span
                  data-testid="app-card-name"
                  class="truncate text-sm/[17px] font-semibold text-white transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [grid-area:1/1] group-hover:-translate-y-4.5 group-focus-visible:-translate-y-4.5 motion-reduce:transition-none"
                >
                  {{ app.title }}
                </span>
                <span
                  class="translate-y-1.5 self-end truncate text-xs/4 text-white/78 opacity-0 transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [grid-area:1/1] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none"
                >
                  {{ app.description }}
                </span>
              </Tooltip>
            </button>
          </li>
          <li
            class="col-span-(--request-span) min-w-0 @3xl:col-span-(--request-span-medium) @5xl:col-span-(--request-span-wide)"
            :style="requestLayout.style"
            data-testid="app-request-tile"
          >
            <button
              type="button"
              class="group/request @container/request flex w-full cursor-pointer rounded-card border-0 bg-[rgb(235_235_235/0.05)] px-[18px] py-4 text-left outline-none transition-colors duration-200 hover:bg-[rgb(235_235_235/0.08)] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              :class="requestLayout.class"
              data-testid="app-request-open"
              @click="requestOpen = true"
            >
              <span
                class="flex shrink-0 items-center"
                aria-hidden="true"
                data-testid="app-request-thumbs"
              >
                <img
                  v-for="still in requestThumbs"
                  :key="still"
                  :src="still"
                  alt=""
                  class="rounded-full object-cover not-last:[mask-image:radial-gradient(ellipse_58%_58%_at_125%_50%,transparent_99%,#000_100%)]"
                  :class="requestLayout.thumbClass"
                />
                <span
                  class="grid place-items-center rounded-full bg-[color-mix(in_srgb,rgb(235_235_235)_24%,var(--color-content-background))] text-foreground"
                  :class="requestLayout.thumbClass"
                >
                  <Plus
                    :size="16"
                    :stroke-width="2"
                    class="transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/request:scale-115 group-focus-visible/request:scale-115 motion-reduce:transition-none motion-reduce:group-hover/request:scale-100 motion-reduce:group-focus-visible/request:scale-100"
                  />
                </span>
              </span>
              <span
                class="flex min-w-0 flex-col"
                :class="requestLayout.labelClass"
                data-testid="app-request-label"
              >
                <span class="text-sm/[17px] font-semibold text-foreground">{{
                  t('apps.request.bandTitle')
                }}</span>
                <span
                  class="text-xs/4 text-balance text-muted-foreground"
                  :class="requestLayout.bodyClass"
                  data-testid="app-request-body"
                  >{{ t('apps.request.bandBody') }}</span
                >
              </span>
              <span
                class="inline-flex h-8 shrink-0 items-center rounded-[9px] bg-[rgb(235_235_235/0.1)] px-3 text-[13px] font-medium whitespace-nowrap text-foreground transition-colors duration-200 group-hover/request:bg-[rgb(235_235_235/0.16)] motion-reduce:transition-none"
                data-testid="app-request-action"
                >{{ t('apps.request.ask') }}</span
              >
            </button>
          </li>
        </ul>
      </div>
    </div>
    <AppRequestModal :open="requestOpen" @close="requestOpen = false" />
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
