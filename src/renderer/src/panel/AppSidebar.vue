<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import {
  AppWindow,
  ArrowRight,
  Cloud,
  House,
  Images,
  Laptop,
  LoaderCircle,
  Plus,
  Server
} from 'lucide-vue-next'
import type { Component } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import SidebarAccount from './SidebarAccount.vue'
import SidebarToggleIcon from './SidebarToggleIcon.vue'
import { homeBuildStatus, isCloudBuild } from './home/homeBuild'
import { useInstallList } from '../composables/useInstallList'
import { buildProgressOf } from '../composables/useBuildProgress'
import { useProgressStore } from '../stores/progressStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { isInstallationInWorkspace } from '../../../shared/workspaces'
import type { DashboardPage, Installation } from '../types/ipc'

const {
  activePage,
  activeBuildId = null,
  makeRoom = false
} = defineProps<{
  activePage: DashboardPage
  activeBuildId?: string | null
  makeRoom?: boolean
}>()

const emit = defineEmits<{
  navigate: [page: DashboardPage]
  'open-build': [installation: Installation]
  'new-build': []
}>()

interface SidebarRow {
  page: DashboardPage
  label: string
  icon: Component
}

const { t } = useI18n()

const collapsedByChoice = useLocalStorage('comfy.desktop.sidebar.collapsed', false)
const reopenedWhileMakingRoom = ref(false)
watch(
  () => makeRoom,
  () => {
    reopenedWhileMakingRoom.value = false
  }
)
const collapsed = computed(() =>
  makeRoom ? !reopenedWhileMakingRoom.value : collapsedByChoice.value
)
const toggleLabel = computed(() => (collapsed.value ? t('sidebar.expand') : t('sidebar.collapse')))

function toggleCollapsed(): void {
  if (makeRoom) reopenedWhileMakingRoom.value = !reopenedWhileMakingRoom.value
  else collapsedByChoice.value = !collapsedByChoice.value
}

const appsEnabled = ref(false)
onMounted(async () => {
  appsEnabled.value = await window.api.getAppsEnabled().catch(() => false)
})

const mainRows = computed<SidebarRow[]>(() => [
  { page: 'home', label: t('sidebar.home'), icon: House },
  ...(appsEnabled.value
    ? [{ page: 'apps' as const, label: t('sidebar.apps'), icon: AppWindow }]
    : []),
  { page: 'assets', label: t('sidebar.assets'), icon: Images },
  { page: 'chooser', label: t('sidebar.builds'), icon: Server }
])
const groups = computed<{ key: string; title?: string; rows: SidebarRow[] }[]>(() => [
  {
    key: 'main',
    rows: collapsed.value ? mainRows.value : mainRows.value.filter((row) => row.page !== 'chooser')
  }
])

const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
const progressStore = useProgressStore()
const dashboardScope = useDashboardScopeStore()
void dashboardScope.initialize()

const { visibleInstalls } = useInstallList({
  installations: toRef(installationStore, 'installations')
})
const buildsPageActive = computed(() => activePage === 'chooser' && !activeBuildId)

function isLive(build: Installation): boolean {
  const status = homeBuildStatus(build, sessionStore)
  return status === 'running' || status === 'always-on'
}

function failureText(build: Installation): string | null {
  const error = sessionStore.errorInstances.get(build.id)
  if (!error) return null
  if (error.message) return t('sidebar.failedToStartReason', { reason: error.message })
  if (error.signal) return t('sidebar.crashedWithSignal', { signal: error.signal })
  if (error.exitCode != null) return t('sidebar.crashedWithCode', { code: error.exitCode })
  return t('sidebar.crashed')
}

const buildRows = computed(() =>
  visibleInstalls.value
    .filter((build) => isInstallationInWorkspace(build, dashboardScope.selectedWorkspaceId))
    .map((build) => {
      const install = buildProgressOf(progressStore, build.id)
      return {
        build,
        install,
        failure: install ? null : failureText(build),
        live: !install && isLive(build)
      }
    })
)

function navigate(page: DashboardPage): void {
  emit('navigate', page)
  window.api.navigatePanel(page)
}
</script>

<template>
  <aside
    class="app-sidebar flex shrink-0 flex-col overflow-hidden rounded-shell bg-sidebar-background transition-[width] duration-240 ease-in-out motion-reduce:transition-none"
    :class="collapsed ? 'w-[72px] items-center px-3 py-2' : 'w-[244px] px-3 py-2'"
    :aria-label="t('sidebar.navigation')"
    data-testid="app-sidebar"
    :data-collapsed="collapsed"
  >
    <div
      class="flex shrink-0 items-center"
      :class="
        collapsed ? 'mt-2.5 mb-3.5 flex-col gap-3' : 'mt-2 mb-3.5 h-9 w-full justify-between pl-1.5'
      "
    >
      <Button
        variant="textonly"
        size="unset"
        class="h-auto rounded-[7px] p-0.5 text-foreground hover:bg-transparent"
        :aria-label="t('sidebar.home')"
        :title="t('sidebar.home')"
        @click="navigate('home')"
      >
        <ComfyCLogo v-if="collapsed" :size="20" />
        <ComfyWordmark v-else class="h-[22px] w-auto" />
      </Button>
      <Button
        variant="muted-textonly"
        size="unset"
        class="group size-[30px] rounded-[7px] p-0 hover:bg-secondary hover:text-foreground"
        data-testid="app-sidebar-toggle"
        :aria-label="toggleLabel"
        :aria-expanded="!collapsed"
        :title="toggleLabel"
        @click="toggleCollapsed"
      >
        <SidebarToggleIcon />
      </Button>
    </div>

    <nav
      class="flex min-h-0 w-full flex-1 scrollbar-hide flex-col gap-px overflow-x-hidden overflow-y-auto"
    >
      <template v-for="group in groups" :key="group.key">
        <template v-if="group.title">
          <div v-if="collapsed" class="mx-2.5 my-3 h-px shrink-0 bg-accent" role="separator" />
          <div
            v-else
            class="mt-5.5 flex h-6.5 shrink-0 items-center px-3 text-[13px]/5 font-medium tracking-[0.65px] text-subtle-foreground uppercase"
          >
            {{ group.title }}
          </div>
        </template>
        <Button
          v-for="row in group.rows"
          :key="row.page"
          variant="muted-textonly"
          size="unset"
          class="h-8 w-full shrink-0 rounded-lg text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
          :class="[
            collapsed ? 'justify-center px-0' : 'justify-start gap-2.5 px-3',
            row.page === activePage && 'bg-accent text-foreground hover:bg-accent'
          ]"
          :aria-current="row.page === activePage ? 'page' : undefined"
          :aria-label="row.label"
          :title="collapsed ? row.label : undefined"
          :data-testid="`app-sidebar-${row.page}`"
          @click="navigate(row.page)"
        >
          <component :is="row.icon" :size="15" aria-hidden="true" />
          <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">{{ row.label }}</span>
        </Button>
        <div
          v-if="group.key === 'main' && !collapsed"
          class="flex flex-col gap-px"
          data-testid="app-sidebar-builds"
        >
          <div class="mt-5.5 flex h-6.5 shrink-0 items-center justify-between pr-1 pl-3">
            <Button
              variant="textonly"
              size="unset"
              class="group/title -ml-1.5 h-[22px] gap-[5px] rounded-md px-1.5 text-[13px]/5 font-medium tracking-[0.65px] text-subtle-foreground uppercase hover:bg-transparent hover:text-foreground focus-visible:text-foreground aria-[current=page]:text-foreground"
              :aria-current="buildsPageActive ? 'page' : undefined"
              data-testid="app-sidebar-chooser"
              @click="navigate('chooser')"
            >
              {{ t('sidebar.builds') }}
              <ArrowRight
                :size="12"
                :stroke-width="2.25"
                class="-translate-x-0.5 opacity-35 transition-[opacity,translate] duration-200 ease-out group-hover/title:translate-x-0 group-hover/title:opacity-100 group-focus-visible/title:translate-x-0 group-focus-visible/title:opacity-100 group-aria-[current=page]/title:translate-x-0 group-aria-[current=page]/title:opacity-100 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </Button>
            <Button
              variant="muted-textonly"
              size="unset"
              class="size-6 rounded-md p-0 hover:bg-secondary hover:text-foreground"
              :aria-label="t('sidebar.newBuild')"
              :title="t('sidebar.newBuild')"
              data-testid="app-sidebar-new-build"
              @click="emit('new-build')"
            >
              <Plus :size="13" aria-hidden="true" />
            </Button>
          </div>
          <p
            v-if="!buildRows.length"
            class="m-0 flex h-8 shrink-0 items-center gap-2.5 px-3 text-[13px]/5 text-subtle-foreground"
            data-testid="app-sidebar-no-builds"
          >
            <Server :size="15" aria-hidden="true" />{{ t('sidebar.noBuilds') }}
          </p>
          <Button
            v-for="{ build, install, failure, live } in buildRows"
            :key="build.id"
            variant="muted-textonly"
            size="unset"
            class="h-8 w-full shrink-0 justify-start gap-2.5 rounded-lg px-3 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
            :class="build.id === activeBuildId && 'bg-accent text-foreground hover:bg-accent'"
            :aria-current="build.id === activeBuildId ? 'page' : undefined"
            :title="failure ? `${build.name} · ${failure}` : build.name"
            :data-testid="`app-sidebar-build-${build.id}`"
            @click="emit('open-build', build)"
          >
            <LoaderCircle
              v-if="install"
              :size="16"
              class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
              aria-hidden="true"
              data-testid="app-sidebar-build-installing"
            />
            <span v-else class="relative flex shrink-0">
              <component :is="isCloudBuild(build) ? Cloud : Laptop" :size="16" aria-hidden="true" />
              <span
                v-if="failure || live"
                class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2"
                :class="[
                  failure ? 'bg-destructive' : 'bg-success',
                  build.id === activeBuildId ? 'ring-[oklch(0.27_0_0)]' : 'ring-sidebar-background'
                ]"
                :data-testid="failure ? 'app-sidebar-dot-failed' : 'app-sidebar-dot-live'"
                aria-hidden="true"
              />
            </span>
            <span class="min-w-0 flex-1 truncate text-left">{{ build.name }}</span>
            <span
              v-if="install?.kind === 'install' && install.percent !== null"
              class="shrink-0 text-xs/5 text-subtle-foreground tabular-nums"
              data-testid="app-sidebar-build-percent"
              >{{ t('installProgress.percent', { percent: install.percent }) }}</span
            >
          </Button>
        </div>
      </template>
    </nav>

    <SidebarAccount class="mt-2 w-full shrink-0" :collapsed="collapsed" />
  </aside>
</template>
