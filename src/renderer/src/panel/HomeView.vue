<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, ArrowRight, ChevronRight, Plus } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import EmptyState from '../components/ui/EmptyState.vue'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import HomeBuildCard from './home/HomeBuildCard.vue'
import HomeNewBuildTile from './home/HomeNewBuildTile.vue'
import HomeOpenBuildButton from './home/HomeOpenBuildButton.vue'
import HomeCarousel from './home/HomeCarousel.vue'
import { homeBuildStatus, isBuildOpenBlocked, isCloudBuild } from './home/homeBuild'
import { useHomeApps } from './home/useHomeApps'
import { useInstallList } from '../composables/useInstallList'
import { useAutoStartBuild } from '../composables/useAutoStartBuild'
import {
  buildProgressOf,
  launchFailed,
  useInstallingBuilds,
  useViewBuildLogs
} from '../composables/useBuildProgress'
import { isPromotingToWorkspace } from '../composables/useInstallContextMenu'
import { useProgressStore } from '../stores/progressStore'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AppCard, AppCover, CatalogWorkflow, Installation } from '../types/ipc'
import { isInstallationInWorkspace } from '../../../shared/workspaces'
import { SECTION_TITLE_CLASS } from '../lib/sectionTitle'

type LoadState = 'loading' | 'ready' | 'unavailable'

const HOME_BUILD_LIMIT = 3
const BUILDS_TITLE_LINK_CLASS =
  '-mx-2 -my-1 h-8 gap-1 rounded-lg px-2 hover:bg-secondary hover:text-foreground'
const TEXT_LINK_CLASS =
  '-my-1 h-8 gap-1.5 rounded-lg px-3 text-[13px]/5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground'

const emit = defineEmits<{
  'open-app': [app: AppCard]
  pick: [installation: Installation]
  'open-build': [installation: Installation]
  'show-builds': []
  'show-apps': []
  'new-build': []
}>()

const { t } = useI18n()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()

const { visibleInstalls } = useInstallList({
  installations: toRef(installationStore, 'installations')
})
const dashboardScope = useDashboardScopeStore()
const authStore = useAuthStore()
void dashboardScope.initialize()
const workspaceBuilds = computed(() =>
  visibleInstalls.value.filter((build) =>
    isInstallationInWorkspace(build, dashboardScope.selectedWorkspaceId)
  )
)
const isInstalling = useInstallingBuilds()
const progressStore = useProgressStore()
const viewBuildLogs = useViewBuildLogs()
const autoStart = useAutoStartBuild()
function isInUse(build: Installation): boolean {
  return (
    sessionStore.isRunning(build.id) ||
    sessionStore.isLaunching(build.id) ||
    sessionStore.isStopping(build.id)
  )
}
const builds = computed(() => {
  const installing = workspaceBuilds.value.filter((build) => isInstalling(build.id))
  const settled = workspaceBuilds.value.filter((build) => !isInstalling(build.id))
  const shown = new Set(
    [
      ...installing,
      ...settled.filter((build) => isInUse(build)),
      ...settled.filter((build) => !isInUse(build))
    ]
      .slice(0, HOME_BUILD_LIMIT)
      .map((build) => build.id)
  )
  return [...installing, ...settled].filter((build) => shown.has(build.id))
})
const showNewBuildSlot = computed(
  () => !installationStore.loading && builds.value.every((build) => isCloudBuild(build))
)
const narrowBuildIds = computed(() => {
  const [latest, ...rest] = builds.value
  if (!latest) return new Set<string>()
  const second =
    rest.find((build) => isInUse(build)) ?? rest.find((build) => isCloudBuild(build)) ?? rest[0]
  return new Set([latest.id, ...(second ? [second.id] : [])])
})
const openableBuilds = computed(() =>
  workspaceBuilds.value.filter(
    (build) =>
      buildProgressOf(progressStore, build.id) === null &&
      !isBuildOpenBlocked(buildStatus(build)) &&
      !isPromotingToWorkspace(build)
  )
)
const mostRecentBuild = computed(
  () =>
    openableBuilds.value.find(
      (build) =>
        build.statusTag?.style !== 'danger' &&
        (typeof build.lastLaunchedAt === 'number' || !isCloudBuild(build))
    ) ?? null
)
const pickedBuildId = ref<string | null>(null)
const openTarget = computed(
  () =>
    openableBuilds.value.find(
      (build) => build.id === pickedBuildId.value && build.statusTag?.style !== 'danger'
    ) ?? mostRecentBuild.value
)
function openBuild(build: Installation): void {
  if (build.statusTag?.style === 'danger') emit('open-build', build)
  else if (launchFailed(progressStore, build.id)) viewBuildLogs(build.id)
  else emit('pick', build)
}
function buildStatus(build: Installation) {
  return homeBuildStatus(build, sessionStore)
}

const { state: appsState, apps, loadApps } = useHomeApps()
const appsEnabled = computed(() => appsState.value !== 'checking' && appsState.value !== 'off')

const state = ref<LoadState>('loading')
const workflows = ref<CatalogWorkflow[]>([])
const carouselIsLoading = computed(() =>
  appsState.value === 'off'
    ? state.value === 'loading'
    : appsState.value === 'checking' || appsState.value === 'loading'
)

function coversOf(app: AppCard): readonly AppCover[] {
  return app.covers
}

function thumbnailOf(workflow: CatalogWorkflow): readonly AppCover[] {
  return workflow.thumbnailUrl
    ? [{ url: workflow.thumbnailUrl, stillUrl: workflow.thumbnailUrl }]
    : []
}

async function loadWorkflows(): Promise<void> {
  state.value = 'loading'
  try {
    workflows.value = await window.api.listHomeWorkflows()
    state.value = workflows.value.length > 0 ? 'ready' : 'unavailable'
  } catch {
    workflows.value = []
    state.value = 'unavailable'
  }
}

function openWorkflow(workflow: CatalogWorkflow): void {
  void window.api.openCatalogWorkflow(workflow.id)
}

watch(appsState, (now) => {
  if (now === 'off') void loadWorkflows()
})

onMounted(() => {
  if (installationStore.installations.length === 0) void installationStore.fetchInstallations()
})
</script>

<template>
  <div
    class="home-view relative flex min-h-0 w-full flex-auto flex-col overflow-x-hidden overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="home-view"
  >
    <HomeOpenBuildButton
      v-if="openTarget"
      class="absolute top-4 right-4 z-10"
      :builds="openableBuilds"
      :target="openTarget"
      :status-of="buildStatus"
      @open="emit('pick', $event)"
      @pick="pickedBuildId = $event.id"
    />

    <div class="mx-auto w-full max-w-300 px-10 pb-16">
      <h1
        class="m-0 pt-[152px] text-center text-display font-semibold tracking-[-0.055em] text-foreground"
      >
        {{ t('home.title') }}
      </h1>

      <section
        class="mt-[74px]"
        :aria-label="appsState === 'off' ? t('home.exampleWorkflows') : t('sidebar.apps')"
      >
        <div
          v-if="carouselIsLoading"
          class="flex h-75 items-center justify-center gap-2.5"
          aria-busy="true"
          data-testid="home-carousel-loading"
        >
          <Skeleton class="h-[290px] w-[205px] rounded-[18px] opacity-60" />
          <Skeleton class="h-75 w-64 rounded-[18px]" />
          <Skeleton class="h-[290px] w-[205px] rounded-[18px] opacity-60" />
        </div>
        <HomeCarousel
          v-else-if="appsState === 'ready'"
          kind="apps"
          :cards="apps"
          :pictures-of="coversOf"
          @open="emit('open-app', $event)"
        />
        <div
          v-else-if="appsState === 'failed'"
          class="flex h-75 flex-col items-center justify-center gap-3"
          data-testid="home-apps-failed"
        >
          <p class="m-0 text-[13px]/5 text-muted-foreground">
            {{ t('home.appsUnavailable') }}
          </p>
          <Button type="button" variant="secondary" size="md" @click="loadApps">
            {{ t('home.retry') }}
          </Button>
        </div>
        <EmptyState
          v-else-if="appsState === 'empty'"
          class="h-75 justify-center"
          data-testid="home-apps-empty"
          :icon="AppWindow"
          :title="t('apps.emptyTitle')"
          :text="t('apps.emptyBody')"
        />
        <HomeCarousel
          v-else-if="state === 'ready'"
          kind="workflows"
          :cards="workflows"
          :pictures-of="thumbnailOf"
          @open="openWorkflow"
        />
        <div
          v-else
          class="flex h-75 flex-col items-center justify-center gap-3"
          data-testid="home-workflows-unavailable"
        >
          <p class="m-0 text-[13px]/5 text-muted-foreground">
            {{ t('home.workflowsUnavailable') }}
          </p>
          <Button type="button" variant="secondary" size="md" @click="loadWorkflows">
            {{ t('home.retry') }}
          </Button>
        </div>

        <div v-if="appsEnabled" class="mt-[30px] flex justify-center">
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            :class="TEXT_LINK_CLASS"
            data-testid="home-see-all-apps"
            @click="emit('show-apps')"
          >
            {{ t('home.seeAllApps') }}
            <ArrowRight :size="14" aria-hidden="true" />
          </Button>
        </div>
      </section>

      <section
        v-if="builds.length > 0 || showNewBuildSlot"
        class="@container/home-builds mt-[50px]"
        aria-labelledby="home-builds"
        data-testid="home-builds"
        data-home-tour="home-builds"
      >
        <div class="mb-2.5 flex h-6 items-center justify-between">
          <h2 id="home-builds" class="m-0">
            <Button
              type="button"
              variant="muted-textonly"
              size="unset"
              :class="[SECTION_TITLE_CLASS, BUILDS_TITLE_LINK_CLASS]"
              :title="t('home.allBuilds')"
              data-testid="home-all-builds"
              @click="emit('show-builds')"
            >
              {{ t('sidebar.builds') }}
              <ChevronRight :size="13" aria-hidden="true" />
            </Button>
          </h2>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon"
            class="size-8 shrink-0"
            :aria-label="t('sidebar.newBuild')"
            :title="t('sidebar.newBuild')"
            data-testid="home-new-build-button"
            @click="emit('new-build')"
          >
            <Plus :size="16" aria-hidden="true" />
          </Button>
        </div>
        <ul
          class="m-0 grid list-none gap-[15px] p-0"
          :class="[
            builds.length > 2 ? 'grid-cols-3 @max-[56rem]/home-builds:grid-cols-2' : 'grid-cols-2',
            '@max-[40rem]/home-builds:grid-cols-1'
          ]"
        >
          <li
            v-for="build in builds"
            :key="build.id"
            class="min-w-0"
            :class="!narrowBuildIds.has(build.id) && '@max-[56rem]/home-builds:hidden'"
            :data-narrow-hidden="narrowBuildIds.has(build.id) ? undefined : 'true'"
          >
            <HomeBuildCard
              :build="build"
              :status="buildStatus(build)"
              :auto-start="autoStart.startsOnOpen(build.id)"
              :logged-out="authStore.isSignedOut"
              @open="openBuild(build)"
            />
          </li>
          <li v-if="showNewBuildSlot" class="min-w-0">
            <HomeNewBuildTile @open="emit('new-build')" />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
