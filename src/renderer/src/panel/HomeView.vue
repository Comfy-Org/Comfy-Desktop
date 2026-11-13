<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronRight } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import HomeBuildCard from './home/HomeBuildCard.vue'
import HomeWorkflowCarousel from './home/HomeWorkflowCarousel.vue'
import type { CarouselCard } from './home/carouselCard'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import { useAppsEnabled } from '../composables/useAppsEnabled'
import type { ExploreTab } from './exploreTab'
import { homeBuildStatus, homeBuildTones } from './home/homeBuild'
import { useInstallList } from '../composables/useInstallList'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CatalogApp, CatalogWorkflow, Installation } from '../types/ipc'
import { isInstallationInWorkspace } from '../../../shared/workspaces'

type LoadState = 'loading' | 'ready' | 'unavailable'
type HomeTab = 'apps' | 'workflows'

const HOME_BUILD_LIMIT = 3
const HOME_APP_LIMIT = 12
const FADE_OUT_MS = 150
const DECODE_TIMEOUT_MS = 1500
const ARC_FIRST_CARDS = [0, 1, 2, -1, -2]
const TEXT_LINK_CLASS =
  'h-6 gap-1.5 rounded-[7px] px-1.5 text-[13px]/5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground'

const emit = defineEmits<{
  pick: [installation: Installation]
  'show-builds': []
  'open-app': [app: CatalogApp]
  'see-all': [tab: ExploreTab]
}>()

const { t } = useI18n()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()

const { visibleInstalls } = useInstallList({
  installations: toRef(installationStore, 'installations')
})
const dashboardScope = useDashboardScopeStore()
void dashboardScope.initialize()
const workspaceBuilds = computed(() =>
  visibleInstalls.value.filter((build) =>
    isInstallationInWorkspace(build, dashboardScope.selectedWorkspaceId)
  )
)
const builds = computed(() => workspaceBuilds.value.slice(0, HOME_BUILD_LIMIT))
const buildTones = computed(() => homeBuildTones(builds.value))
const mostRecentBuild = computed(() => workspaceBuilds.value[0] ?? null)

const workflowsState = ref<LoadState>('loading')
const workflows = ref<CatalogWorkflow[]>([])
const appsState = ref<LoadState>('loading')
const apps = ref<CatalogApp[]>([])
let appsRequested = false

async function loadWorkflows(): Promise<void> {
  workflowsState.value = 'loading'
  try {
    workflows.value = await window.api.listHomeWorkflows()
    workflowsState.value = workflows.value.length > 0 ? 'ready' : 'unavailable'
  } catch {
    workflows.value = []
    workflowsState.value = 'unavailable'
  }
}

async function loadApps(): Promise<void> {
  appsRequested = true
  appsState.value = 'loading'
  try {
    apps.value = (await window.api.listCatalogApps()).slice(0, HOME_APP_LIMIT)
    appsState.value = apps.value.length > 0 ? 'ready' : 'unavailable'
  } catch {
    apps.value = []
    appsState.value = 'unavailable'
  }
}

const appsEnabled = useAppsEnabled()
const pickedTab = ref<HomeTab>('apps')
const shownTab = ref<HomeTab | null>(null)
const fadingOut = ref(false)
const tabOptions = computed(() => [
  { value: 'apps' as const, label: t('home.apps') },
  { value: 'workflows' as const, label: t('home.workflows') }
])

const stateFor = (tab: HomeTab): Ref<LoadState> => (tab === 'apps' ? appsState : workflowsState)
const cardsFor = (tab: HomeTab): CarouselCard[] => (tab === 'apps' ? apps.value : workflows.value)

const state = computed<LoadState>(() =>
  shownTab.value ? stateFor(shownTab.value).value : 'loading'
)
const cards = computed<CarouselCard[]>(() => (shownTab.value ? cardsFor(shownTab.value) : []))

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function whenLoaded(loadState: Ref<LoadState>): Promise<void> {
  if (loadState.value !== 'loading') return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(loadState, (next) => {
      if (next === 'loading') return
      stop()
      resolve()
    })
  })
}

function decodeThumbnail(url: string): Promise<void> {
  const image = new Image()
  image.src = url
  if (typeof image.decode !== 'function') return Promise.resolve()
  return image.decode().catch(() => undefined)
}

function firstThumbnails(tabCards: readonly CarouselCard[]): string[] {
  const urls = ARC_FIRST_CARDS.map((offset) => tabCards.at(offset)?.thumbnailUrl ?? null)
  return [...new Set(urls.filter((url): url is string => url !== null))]
}

async function whenReadyToShow(tab: HomeTab): Promise<void> {
  await whenLoaded(stateFor(tab))
  const decoded = Promise.all(firstThumbnails(cardsFor(tab)).map(decodeThumbnail))
  await Promise.race([decoded, wait(DECODE_TIMEOUT_MS)])
}

let showRun = 0

async function show(tab: HomeTab): Promise<void> {
  const run = ++showRun
  if (shownTab.value === tab) {
    fadingOut.value = false
    return
  }
  if (shownTab.value === null || prefersReducedMotion()) {
    fadingOut.value = false
    shownTab.value = tab
    return
  }
  fadingOut.value = true
  await Promise.all([wait(FADE_OUT_MS), whenReadyToShow(tab)])
  if (run !== showRun) return
  shownTab.value = tab
  fadingOut.value = false
}

watch(
  [appsEnabled, pickedTab],
  ([enabled, picked]) => {
    if (enabled === null) return
    if (enabled && !appsRequested) void loadApps()
    void show(enabled ? picked : 'workflows')
  },
  { immediate: true }
)

function retry(): void {
  if (shownTab.value === 'apps') void loadApps()
  else void loadWorkflows()
}

function openCard(card: CarouselCard): void {
  if (shownTab.value === 'apps') {
    const app = apps.value.find((entry) => entry.id === card.id)
    if (app) emit('open-app', app)
    return
  }
  void window.api.openCatalogWorkflow(card.id)
}

function seeAll(): void {
  emit('see-all', shownTab.value === 'apps' ? 'apps' : 'templates')
}

onMounted(() => {
  void loadWorkflows()
  if (installationStore.installations.length === 0) void installationStore.fetchInstallations()
})
</script>

<template>
  <div
    class="home-view relative flex min-h-0 w-full flex-auto flex-col overflow-x-hidden overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="home-view"
  >
    <Button
      v-if="mostRecentBuild"
      type="button"
      variant="inverted"
      size="md"
      class="absolute top-4 right-4 z-10 gap-1.5 px-3 text-[13px]/5 font-medium"
      data-testid="home-open-comfyui"
      @click="emit('pick', mostRecentBuild)"
    >
      {{ t('home.openComfyUI') }}
      <ArrowRight :size="14" aria-hidden="true" />
    </Button>

    <div class="mx-auto w-full max-w-300 px-10 pb-16">
      <h1
        class="m-0 pt-[152px] text-center text-[34px]/10 font-semibold tracking-[-0.055em] text-foreground"
      >
        {{ t('home.title') }}
      </h1>

      <section
        :class="appsEnabled ? 'mt-[42px]' : 'mt-[74px]'"
        :aria-label="t('home.exampleWorkflows')"
      >
        <div v-if="appsEnabled" class="mb-8 flex justify-center">
          <SegmentedControl
            v-model="pickedTab"
            :options="tabOptions"
            :label="t('home.showing')"
            data-testid="home-tabs"
          />
        </div>
        <div
          class="transition-[opacity,translate] motion-reduce:transition-none"
          :class="
            fadingOut
              ? 'translate-y-1.5 opacity-0 duration-150 ease-in'
              : 'translate-y-0 opacity-100 duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
          "
          :data-fading="fadingOut"
          data-testid="home-carousel-stage"
        >
          <HomeWorkflowCarousel
            v-if="state === 'ready' && shownTab"
            :key="shownTab"
            :cards="cards"
            :kind="shownTab"
            @open="openCard"
          />
          <div
            v-else-if="state === 'loading'"
            class="flex h-75 items-center justify-center gap-2.5"
            aria-busy="true"
            data-testid="home-workflows-loading"
          >
            <Skeleton class="h-[290px] w-[205px] rounded-[18px] opacity-60" />
            <Skeleton class="h-75 w-64 rounded-[18px]" />
            <Skeleton class="h-[290px] w-[205px] rounded-[18px] opacity-60" />
          </div>
          <div
            v-else
            class="flex h-75 flex-col items-center justify-center gap-3"
            data-testid="home-workflows-unavailable"
          >
            <p class="m-0 text-[13px]/5 text-muted-foreground">
              {{ shownTab === 'apps' ? t('home.appsUnavailable') : t('home.workflowsUnavailable') }}
            </p>
            <Button type="button" variant="secondary" size="md" @click="retry">
              {{ t('home.retry') }}
            </Button>
          </div>

          <div class="mt-[30px] flex justify-center">
            <Button
              type="button"
              variant="muted-textonly"
              size="unset"
              :class="TEXT_LINK_CLASS"
              data-testid="home-see-all-workflows"
              @click="seeAll"
            >
              {{ shownTab === 'apps' ? t('home.seeAllApps') : t('home.seeAllWorkflows') }}
              <ArrowRight :size="14" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>

      <section
        v-if="builds.length > 0"
        class="mt-[50px]"
        aria-labelledby="home-builds"
        data-testid="home-builds"
      >
        <div class="mb-2.5 flex h-6 items-center justify-between">
          <h2
            id="home-builds"
            class="m-0 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
          >
            {{ t('sidebar.builds') }}
          </h2>
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            :class="TEXT_LINK_CLASS"
            data-testid="home-all-builds"
            @click="emit('show-builds')"
          >
            {{ t('home.allBuilds') }}
            <ChevronRight :size="13" aria-hidden="true" />
          </Button>
        </div>
        <ul
          class="m-0 grid list-none gap-[15px] p-0"
          :class="builds.length > 2 ? 'grid-cols-3' : 'grid-cols-2'"
        >
          <li v-for="(build, index) in builds" :key="build.id" class="min-w-0">
            <HomeBuildCard
              :build="build"
              :status="homeBuildStatus(build, sessionStore)"
              :tone="buildTones[index]!"
              @open="emit('pick', build)"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
