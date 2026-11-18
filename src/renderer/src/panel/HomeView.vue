<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronRight } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import HomeBuildCard from './home/HomeBuildCard.vue'
import HomeNewBuildTile from './home/HomeNewBuildTile.vue'
import HomeOpenBuildButton from './home/HomeOpenBuildButton.vue'
import HomeCarousel from './home/HomeCarousel.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import { homeBuildStatus, homeBuildTones, isBuildOpenBlocked, isCloudBuild } from './home/homeBuild'
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
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AppCard, CatalogWorkflow, Installation } from '../types/ipc'
import { isInstallationInWorkspace } from '../../../shared/workspaces'

type WorkflowState = 'idle' | 'loading' | 'ready' | 'unavailable'
type HomeTab = 'apps' | 'workflows'

const HOME_BUILD_LIMIT = 3
const TEXT_LINK_CLASS =
  '-my-1 h-8 gap-1.5 rounded-lg px-3 text-[13px]/5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground'

const emit = defineEmits<{
  'open-app': [app: AppCard]
  'open-workflow': [workflow: CatalogWorkflow]
  pick: [installation: Installation]
  'open-build': [installation: Installation]
  'show-builds': []
  'show-apps': []
  'show-workflows': []
  'new-build': []
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
const isInstalling = useInstallingBuilds()
const progressStore = useProgressStore()
const viewBuildLogs = useViewBuildLogs()
const autoStart = useAutoStartBuild()
const builds = computed(() =>
  [
    ...workspaceBuilds.value.filter((build) => isInstalling(build.id)),
    ...workspaceBuilds.value.filter((build) => !isInstalling(build.id))
  ].slice(0, HOME_BUILD_LIMIT)
)
const showNewBuildSlot = computed(
  () => !installationStore.loading && builds.value.every((build) => isCloudBuild(build))
)
const buildTones = computed(() => homeBuildTones(builds.value, installationStore.installations))
const narrowBuildIds = computed(() => {
  const [latest, ...rest] = builds.value
  if (!latest) return new Set<string>()
  const second = rest.find((build) => isCloudBuild(build)) ?? rest[0]
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
const tab = ref<HomeTab>('apps')
const tabs = computed(() => [
  { value: 'apps' as const, label: t('sidebar.apps'), testId: 'home-apps-tab' },
  { value: 'workflows' as const, label: t('sidebar.workflows'), testId: 'home-workflows-tab' }
])
const showWorkflows = computed(() => appsState.value === 'off' || tab.value === 'workflows')
const workflowState = ref<WorkflowState>('idle')
const workflows = ref<CatalogWorkflow[]>([])
const carouselIsLoading = computed(() =>
  showWorkflows.value
    ? workflowState.value === 'idle' || workflowState.value === 'loading'
    : appsState.value === 'checking' || appsState.value === 'loading'
)

function coverOf(app: AppCard): string | null {
  return app.coverUrl
}

function thumbnailOf(workflow: CatalogWorkflow): string | null {
  return workflow.thumbnailUrl
}

async function loadWorkflows(): Promise<void> {
  workflowState.value = 'loading'
  try {
    workflows.value = await window.api.listHomeWorkflows()
    workflowState.value = workflows.value.length > 0 ? 'ready' : 'unavailable'
  } catch {
    workflows.value = []
    workflowState.value = 'unavailable'
  }
}

watch(showWorkflows, (show) => {
  if (show && workflowState.value === 'idle') void loadWorkflows()
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
        class="m-0 pt-[152px] text-center text-[34px]/10 font-semibold tracking-[-0.055em] text-foreground"
      >
        {{ t('home.title') }}
      </h1>

      <section
        class="mt-[74px]"
        :aria-label="showWorkflows ? t('home.exampleWorkflows') : t('sidebar.apps')"
      >
        <div v-if="appsEnabled" class="mb-5 flex justify-center">
          <SegmentedControl v-model="tab" :options="tabs" :label="t('home.carouselTabs')" />
        </div>
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
        <template v-else-if="showWorkflows">
          <HomeCarousel
            v-if="workflowState === 'ready'"
            kind="workflows"
            :cards="workflows"
            :picture-of="thumbnailOf"
            @open="emit('open-workflow', $event)"
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
        </template>
        <HomeCarousel
          v-else-if="appsState === 'ready'"
          kind="apps"
          :cards="apps"
          :picture-of="coverOf"
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
        <div
          v-else-if="appsState === 'empty'"
          class="flex h-75 flex-col items-center justify-center gap-1 text-center"
          data-testid="home-apps-empty"
        >
          <p class="m-0 text-[13px]/5 font-medium text-foreground">{{ t('apps.emptyTitle') }}</p>
          <p class="m-0 text-[13px]/5 text-muted-foreground">{{ t('apps.emptyBody') }}</p>
        </div>
        <div v-if="appsState !== 'checking'" class="mt-[30px] flex justify-center">
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            :class="TEXT_LINK_CLASS"
            :data-testid="showWorkflows ? 'home-see-all-workflows' : 'home-see-all-apps'"
            @click="showWorkflows ? emit('show-workflows') : emit('show-apps')"
          >
            {{ showWorkflows ? t('home.seeAllWorkflows') : t('home.seeAllApps') }}
            <ArrowRight :size="14" aria-hidden="true" />
          </Button>
        </div>
      </section>

      <section
        v-if="builds.length > 0 || showNewBuildSlot"
        class="@container/home-builds mt-[50px]"
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
          :class="[
            builds.length > 2 ? 'grid-cols-3 @max-[56rem]/home-builds:grid-cols-2' : 'grid-cols-2',
            '@max-[40rem]/home-builds:grid-cols-1'
          ]"
        >
          <li
            v-for="(build, index) in builds"
            :key="build.id"
            class="min-w-0"
            :class="!narrowBuildIds.has(build.id) && '@max-[56rem]/home-builds:hidden'"
            :data-narrow-hidden="narrowBuildIds.has(build.id) ? undefined : 'true'"
          >
            <HomeBuildCard
              :build="build"
              :status="buildStatus(build)"
              :tone="buildTones[index]!"
              :auto-start="autoStart.startsOnOpen(build.id)"
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
