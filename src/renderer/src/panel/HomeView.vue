<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, ArrowRight, ChevronRight, Plus } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import EmptyState from '../components/ui/EmptyState.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import HomeBuildCard from './home/HomeBuildCard.vue'
import HomeNewBuildTile from './home/HomeNewBuildTile.vue'
import HomeOpenBuildButton from './home/HomeOpenBuildButton.vue'
import HomeCarousel from './home/HomeCarousel.vue'
import HomeReadyToast from './home/HomeReadyToast.vue'
import { homeBuildStatus, isBuildOpenBlocked, isCloudBuild } from './home/homeBuild'
import { useHomeApps } from './home/useHomeApps'
import { useAutoStartReadyNotice } from './home/useAutoStartReadyNotice'
import { useOpenWhenReady } from './home/useOpenWhenReady'
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

type WorkflowState = 'idle' | 'loading' | 'ready' | 'unavailable'

const HOME_BUILD_LIMIT = 3
const BUILDS_TITLE_LINK_CLASS =
  '-mx-2 -my-1 h-8 gap-1 rounded-lg px-2 text-muted-foreground hover:bg-secondary hover:text-foreground'
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
  () =>
    !installationStore.loading &&
    (builds.value.length < HOME_BUILD_LIMIT || builds.value.every((build) => isCloudBuild(build)))
)
const NARROW_BUILD_LIMIT = 2
const newBuildTileFitsNarrow = computed(() => builds.value.length < NARROW_BUILD_LIMIT)
const buildRowSize = computed(() => builds.value.length + (showNewBuildSlot.value ? 1 : 0))
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
const readyNotice = useAutoStartReadyNotice()
const readyBuild = computed(() => {
  const id = readyNotice.buildId.value
  if (id === null || !sessionStore.isRunning(id)) return null
  return installationStore.installations.find((build) => build.id === id) ?? null
})
const opensWhenReady = useOpenWhenReady((build) => emit('pick', build))
function pickBuild(build: Installation): void {
  readyNotice.dismiss(build.id)
  if (opensWhenReady.openWhenReady(build)) return
  opensWhenReady.forget()
  emit('pick', build)
}
function openBuild(build: Installation): void {
  readyNotice.dismiss(build.id)
  if (build.statusTag?.style !== 'danger' && opensWhenReady.openWhenReady(build)) return
  opensWhenReady.forget()
  if (build.statusTag?.style === 'danger') emit('open-build', build)
  else if (launchFailed(progressStore, build.id)) viewBuildLogs(build.id)
  else emit('pick', build)
}
function buildStatus(build: Installation) {
  return homeBuildStatus(build, sessionStore)
}

const { state: appsState, apps, loadApps } = useHomeApps()
const workflowState = ref<WorkflowState>('idle')
const workflows = ref<CatalogWorkflow[]>([])
const workflowsLoading = computed(
  () => workflowState.value === 'idle' || workflowState.value === 'loading'
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
  workflowState.value = 'loading'
  try {
    workflows.value = await window.api.listHomeWorkflows()
    workflowState.value = workflows.value.length > 0 ? 'ready' : 'unavailable'
  } catch {
    workflows.value = []
    workflowState.value = 'unavailable'
  }
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
    <HomeOpenBuildButton
      v-if="openTarget"
      class="absolute top-4 right-4 z-10"
      :builds="openableBuilds"
      :target="openTarget"
      :status-of="buildStatus"
      @open="pickBuild"
      @pick="pickedBuildId = $event.id"
    />

    <HomeReadyToast
      v-if="readyBuild"
      class="absolute top-14 right-4 z-10"
      :data-build-id="readyBuild.id"
      @open="openBuild(readyBuild)"
      @dismiss="readyNotice.dismiss()"
    />

    <div class="mx-auto w-full max-w-300 px-10 pb-16">
      <h1
        class="m-0 pt-[152px] text-center text-display font-semibold tracking-[-0.055em] text-foreground"
      >
        {{ t('home.title') }}
      </h1>

      <section class="mt-[74px]" aria-labelledby="home-workflows" data-testid="home-workflows">
        <div class="mb-5 flex h-6 items-center justify-between">
          <h2 id="home-workflows" class="m-0" :class="SECTION_TITLE_CLASS">
            {{ t('sidebar.workflows') }}
          </h2>
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            :class="[TEXT_LINK_CLASS, '-mr-3']"
            data-testid="home-see-all-workflows"
            @click="emit('show-workflows')"
          >
            {{ t('home.seeAllWorkflows') }}
            <ArrowRight :size="14" aria-hidden="true" />
          </Button>
        </div>
        <div
          v-if="workflowsLoading"
          class="flex h-75 items-center justify-center gap-2.5"
          aria-busy="true"
          data-testid="home-workflows-loading"
        >
          <Skeleton class="h-[290px] w-[205px] rounded-[18px] opacity-60" />
          <Skeleton class="h-75 w-64 rounded-[18px]" />
          <Skeleton class="h-[290px] w-[205px] rounded-[18px] opacity-60" />
        </div>
        <HomeCarousel
          v-else-if="workflowState === 'ready'"
          kind="workflows"
          :cards="workflows"
          :pictures-of="thumbnailOf"
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
      </section>

      <section class="mt-[50px]" aria-labelledby="home-apps" data-testid="home-apps">
        <div class="mb-5 flex h-6 items-center justify-between">
          <h2 id="home-apps" class="m-0" :class="SECTION_TITLE_CLASS">
            {{ t('sidebar.apps') }}
          </h2>
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            :class="[TEXT_LINK_CLASS, '-mr-3']"
            data-testid="home-see-all-apps"
            @click="emit('show-apps')"
          >
            {{ t('home.seeAllApps') }}
            <ArrowRight :size="14" aria-hidden="true" />
          </Button>
        </div>
        <div
          v-if="appsState === 'loading'"
          class="flex h-75 items-center justify-center gap-2.5"
          aria-busy="true"
          data-testid="home-apps-loading"
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
          v-else
          class="h-75 justify-center"
          data-testid="home-apps-empty"
          :icon="AppWindow"
          :title="t('apps.emptyTitle')"
          :text="t('apps.emptyBody')"
        />
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
            <Tooltip :text="t('home.allBuilds')">
              <Button
                type="button"
                variant="muted-textonly"
                size="unset"
                :class="[SECTION_TITLE_CLASS, BUILDS_TITLE_LINK_CLASS]"
                data-testid="home-all-builds"
                @click="emit('show-builds')"
              >
                {{ t('sidebar.builds') }}
                <ChevronRight :size="13" aria-hidden="true" />
              </Button>
            </Tooltip>
          </h2>
          <div
            v-if="!installationStore.loading && (!showNewBuildSlot || !newBuildTileFitsNarrow)"
            class="shrink-0"
            :class="showNewBuildSlot && 'hidden @max-[56rem]/home-builds:block'"
          >
            <Tooltip :text="t('sidebar.newBuild')">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                class="size-8 rounded-lg"
                :aria-label="t('sidebar.newBuild')"
                data-testid="home-new-build-button"
                @click="emit('new-build')"
              >
                <Plus :size="16" aria-hidden="true" />
              </Button>
            </Tooltip>
          </div>
        </div>
        <ul
          class="m-0 grid list-none gap-[15px] p-0"
          :class="[
            buildRowSize > 2 ? 'grid-cols-3 @max-[56rem]/home-builds:grid-cols-2' : 'grid-cols-2',
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
          <li
            v-if="showNewBuildSlot"
            class="min-w-0"
            :class="!newBuildTileFitsNarrow && '@max-[56rem]/home-builds:hidden'"
          >
            <HomeNewBuildTile @open="emit('new-build')" />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
