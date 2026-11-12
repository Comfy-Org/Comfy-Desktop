<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronRight } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import HomeBuildCard from './home/HomeBuildCard.vue'
import HomeOpenBuildButton from './home/HomeOpenBuildButton.vue'
import HomeWorkflowCarousel from './home/HomeWorkflowCarousel.vue'
import { homeBuildStatus, homeBuildTones } from './home/homeBuild'
import { useInstallList } from '../composables/useInstallList'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CatalogWorkflow, Installation } from '../types/ipc'
import { isInstallationInWorkspace } from '../../../shared/workspaces'

type LoadState = 'loading' | 'ready' | 'unavailable'

const HOME_BUILD_LIMIT = 3
const TEXT_LINK_CLASS =
  'h-6 gap-1.5 rounded-[7px] px-1.5 text-[13px]/5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground'

const emit = defineEmits<{
  pick: [installation: Installation]
  'show-builds': []
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
const OPEN_BUILD_KEY = 'home.openBuildId'
const selectedBuildId = ref<string | null>(readOpenBuildId())
const openTarget = computed(
  () =>
    workspaceBuilds.value.find((build) => build.id === selectedBuildId.value) ??
    mostRecentBuild.value
)

function readOpenBuildId(): string | null {
  try {
    return window.localStorage.getItem(OPEN_BUILD_KEY)
  } catch {
    return null
  }
}

function selectOpenBuild(build: Installation): void {
  selectedBuildId.value = build.id
  try {
    window.localStorage.setItem(OPEN_BUILD_KEY, build.id)
  } catch {}
}

function buildStatus(build: Installation) {
  return homeBuildStatus(build, sessionStore)
}

const state = ref<LoadState>('loading')
const workflows = ref<CatalogWorkflow[]>([])

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

function seeAllWorkflows(): void {
  void window.api.openCatalogWorkflowHub()
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
      :builds="workspaceBuilds"
      :target="openTarget"
      :status-of="buildStatus"
      @open="emit('pick', $event)"
      @select="selectOpenBuild"
    />

    <div class="mx-auto w-full max-w-300 px-10 pb-16">
      <h1
        class="m-0 pt-[152px] text-center text-[34px]/10 font-semibold tracking-[-0.055em] text-foreground"
      >
        {{ t('home.title') }}
      </h1>

      <section class="mt-[74px]" :aria-label="t('home.exampleWorkflows')">
        <HomeWorkflowCarousel
          v-if="state === 'ready'"
          :workflows="workflows"
          @open="openWorkflow"
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
            {{ t('home.workflowsUnavailable') }}
          </p>
          <Button type="button" variant="secondary" size="md" @click="loadWorkflows">
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
            @click="seeAllWorkflows"
          >
            {{ t('home.seeAllWorkflows') }}
            <ArrowRight :size="14" aria-hidden="true" />
          </Button>
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
              :status="buildStatus(build)"
              :tone="buildTones[index]!"
              @open="emit('pick', build)"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
