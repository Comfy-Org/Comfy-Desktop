<script setup lang="ts">
import { computed, onMounted, provide, ref, shallowRef, toRef, watch } from 'vue'
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
  Server,
  Settings
} from '@lucide/vue'
import type { Component } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import { usePointMenu } from '@comfyorg/design-system/lib/menu/usePointMenu'
import BuildMenu from './home/BuildMenu.vue'
import SidebarPageMenu from './SidebarPageMenu.vue'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { TOOLTIP_GATE } from '../components/ui/tooltipGate'
import { appPageShown, sidebarHovered } from './appPageCover'
import SidebarAccount from './SidebarAccount.vue'
import SidebarCredits from './SidebarCredits.vue'
import SidebarDesktopUpdate from './SidebarDesktopUpdate.vue'
import SidebarToggleIcon from './SidebarToggleIcon.vue'
import { homeBuildStatus, isCloudBuild } from './home/homeBuild'
import { useInstallList } from '../composables/useInstallList'
import { buildProgressOf } from '../composables/useBuildProgress'
import { useProgressStore } from '../stores/progressStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { emitTelemetryAction } from '../lib/telemetry'
import { isInstallationInWorkspace } from '../../../shared/workspaces'
import type { NewWindowDashboardPage } from '../../../shared/dashboardPages'
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
  page: NewWindowDashboardPage
  label: string
  icon: Component
}

const { t } = useI18n()
provide(TOOLTIP_GATE, () => !appPageShown.value)

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
const faceTransition = {
  enterActiveClass:
    'transition-[opacity,scale] duration-180 ease-out motion-reduce:transition-opacity',
  enterFromClass: 'opacity-0 motion-safe:scale-90',
  leaveActiveClass:
    'transition-[opacity,scale] duration-120 ease-out motion-reduce:transition-opacity',
  leaveToClass: 'opacity-0 motion-safe:scale-90'
}
const labelTransition = {
  enterActiveClass: 'transition-opacity duration-180 delay-30 ease-out',
  enterFromClass: 'opacity-0',
  leaveActiveClass: 'transition-opacity duration-100 ease-out',
  leaveToClass: 'opacity-0'
}

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

const { open: buildMenuOpen, menuProps: buildMenuProps, show: showBuildMenu } = usePointMenu()
const buildMenuTarget = shallowRef<{ buildId: string; returnFocus: HTMLElement | null } | null>(
  null
)
const buildMenuBuild = computed(() => {
  const target = buildMenuTarget.value
  return target ? installationStore.getById(target.buildId) : undefined
})

function openBuildMenu(event: MouseEvent, build: Installation): void {
  buildMenuTarget.value = {
    buildId: build.id,
    returnFocus: event.currentTarget as HTMLElement | null
  }
  showBuildMenu(event)
}

const { open: pageMenuOpen, menuProps: pageMenuProps, show: showPageMenu } = usePointMenu()
const pageMenuTarget = shallowRef<{
  page: NewWindowDashboardPage
  returnFocus: HTMLElement | null
} | null>(null)

function openPageMenu(event: MouseEvent, page: NewWindowDashboardPage): void {
  pageMenuTarget.value = { page, returnFocus: event.currentTarget as HTMLElement | null }
  showPageMenu(event)
}

function openSettings(): void {
  emitTelemetryAction('comfy.desktop.sidebar.settings_opened', { from_page: activePage })
  window.api.openGlobalSettings()
}
</script>

<template>
  <aside
    class="app-sidebar flex shrink-0 flex-col overflow-hidden rounded-shell bg-sidebar-background px-3 py-2 transition-[width] ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none"
    :class="collapsed ? 'w-16 duration-200' : 'w-[244px] duration-260'"
    :aria-label="t('sidebar.navigation')"
    data-testid="app-sidebar"
    :data-collapsed="collapsed"
    @pointerenter="sidebarHovered = true"
    @pointerleave="sidebarHovered = false"
  >
    <div class="relative mt-2 mb-3.5 h-9 w-full shrink-0" data-testid="app-sidebar-header">
      <Transition v-bind="faceTransition">
        <Button
          v-show="!collapsed"
          variant="textonly"
          size="unset"
          class="absolute inset-y-0 left-1.5 my-auto h-[26px] rounded-[7px] p-0.5 text-foreground hover:bg-transparent"
          :aria-label="t('sidebar.home')"
          data-testid="app-sidebar-wordmark"
          @click="navigate('home')"
        >
          <Tooltip :text="t('sidebar.home')" side="right">
            <ComfyWordmark class="h-[22px] w-auto" />
          </Tooltip>
        </Button>
      </Transition>
      <Transition v-bind="faceTransition">
        <Button
          v-show="collapsed"
          variant="muted-textonly"
          size="unset"
          class="group absolute inset-y-0 left-[5px] my-auto size-[30px] rounded-[7px] p-0 hover:bg-secondary hover:text-foreground"
          :data-testid="collapsed ? 'app-sidebar-toggle' : undefined"
          :aria-label="t('sidebar.expand')"
          aria-expanded="false"
          @click="toggleCollapsed"
        >
          <Tooltip
            :text="t('sidebar.expand')"
            side="right"
            class="size-full items-center justify-center"
          >
            <span class="relative grid size-full place-items-center">
              <ComfyCLogo
                :size="20"
                class="text-foreground transition-[opacity,scale] duration-180 ease-out group-hover:opacity-0 group-focus-visible:opacity-0 motion-safe:group-hover:scale-90 motion-safe:group-focus-visible:scale-90 motion-reduce:transition-opacity"
                data-testid="app-sidebar-logo-face"
              />
              <span
                class="absolute inset-0 grid place-items-center opacity-0 transition-[opacity,scale] duration-180 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:scale-90 motion-safe:group-hover:scale-100 motion-safe:group-focus-visible:scale-100 motion-reduce:transition-opacity"
                data-testid="app-sidebar-expand-face"
              >
                <SidebarToggleIcon />
              </span>
            </span>
          </Tooltip>
        </Button>
      </Transition>
      <Transition v-bind="faceTransition">
        <Button
          v-show="!collapsed"
          variant="muted-textonly"
          size="unset"
          class="group absolute inset-y-0 right-0 my-auto size-[30px] rounded-[7px] p-0 hover:bg-secondary hover:text-foreground"
          :data-testid="collapsed ? undefined : 'app-sidebar-toggle'"
          :aria-label="t('sidebar.collapse')"
          aria-expanded="true"
          @click="toggleCollapsed"
        >
          <Tooltip
            :text="t('sidebar.collapse')"
            side="right"
            class="size-full items-center justify-center"
          >
            <SidebarToggleIcon />
          </Tooltip>
        </Button>
      </Transition>
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
          class="h-8 w-full shrink-0 justify-start rounded-lg px-0 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
          :class="row.page === activePage && 'bg-accent text-foreground hover:bg-accent'"
          :aria-current="row.page === activePage ? 'page' : undefined"
          :aria-label="row.label"
          :data-testid="`app-sidebar-${row.page}`"
          @click="navigate(row.page)"
          @contextmenu.prevent="openPageMenu($event, row.page)"
        >
          <Tooltip
            :text="collapsed ? row.label : undefined"
            side="right"
            class="size-full items-center gap-2.5 px-3"
          >
            <component :is="row.icon" :size="15" class="shrink-0" aria-hidden="true" />
            <Transition v-bind="labelTransition">
              <span
                v-if="!collapsed"
                class="min-w-0 flex-1 overflow-hidden text-left text-nowrap"
                >{{ row.label }}</span
              >
            </Transition>
          </Tooltip>
        </Button>
        <Transition v-bind="labelTransition">
          <div
            v-if="group.key === 'main' && !collapsed"
            class="flex flex-col gap-px overflow-hidden text-nowrap"
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
                @contextmenu.prevent="openPageMenu($event, 'chooser')"
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
                data-testid="app-sidebar-new-build"
                @click="emit('new-build')"
              >
                <Tooltip
                  :text="t('sidebar.newBuild')"
                  side="right"
                  class="size-full items-center justify-center"
                >
                  <Plus :size="13" aria-hidden="true" />
                </Tooltip>
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
              :data-testid="`app-sidebar-build-${build.id}`"
              @click="emit('open-build', build)"
              @contextmenu.prevent="openBuildMenu($event, build)"
            >
              <LoaderCircle
                v-if="install"
                :size="16"
                class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
                aria-hidden="true"
                data-testid="app-sidebar-build-installing"
              />
              <span v-else class="relative flex shrink-0">
                <component
                  :is="isCloudBuild(build) ? Cloud : Laptop"
                  :size="16"
                  aria-hidden="true"
                />
                <span
                  v-if="failure || live"
                  class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2"
                  :class="[
                    failure ? 'bg-destructive' : 'bg-success',
                    build.id === activeBuildId
                      ? 'ring-[oklch(0.27_0_0)]'
                      : 'ring-sidebar-background'
                  ]"
                  :data-testid="failure ? 'app-sidebar-dot-failed' : 'app-sidebar-dot-live'"
                  aria-hidden="true"
                />
              </span>
              <Tooltip
                :text="failure ? `${build.name} · ${failure}` : build.name"
                side="right"
                class="min-w-0 flex-1 items-center self-stretch"
              >
                <span class="min-w-0 truncate text-left">{{ build.name }}</span>
                <span v-if="failure" class="sr-only">· {{ failure }}</span>
              </Tooltip>
              <span
                v-if="install && install.kind !== 'launch' && install.percent !== null"
                class="shrink-0 text-xs/5 text-subtle-foreground tabular-nums"
                data-testid="app-sidebar-build-percent"
                >{{ t('installProgress.percent', { percent: install.percent }) }}</span
              >
            </Button>
          </div>
        </Transition>
      </template>
    </nav>

    <div class="mt-2 flex w-full shrink-0 flex-col gap-1">
      <SidebarDesktopUpdate :collapsed="collapsed" />
      <Button
        variant="muted-textonly"
        size="unset"
        class="h-8 w-full shrink-0 justify-start rounded-lg px-0 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
        :aria-label="t('fileMenu.globalSettings')"
        aria-haspopup="dialog"
        data-testid="app-sidebar-settings"
        @click="openSettings"
      >
        <Tooltip
          :text="collapsed ? t('fileMenu.globalSettings') : undefined"
          side="right"
          class="size-full items-center gap-2.5 px-3"
        >
          <Settings :size="15" class="shrink-0" aria-hidden="true" />
          <Transition v-bind="labelTransition">
            <span v-if="!collapsed" class="min-w-0 flex-1 overflow-hidden text-left text-nowrap">{{
              t('fileMenu.globalSettings')
            }}</span>
          </Transition>
        </Tooltip>
      </Button>
      <SidebarCredits :collapsed="collapsed" />
      <SidebarAccount :collapsed="collapsed" />
    </div>

    <BuildMenu
      v-if="buildMenuBuild && buildMenuProps.reference"
      v-model:open="buildMenuOpen"
      :build="buildMenuBuild"
      :anchor="buildMenuProps.reference"
      :return-focus="buildMenuTarget?.returnFocus"
    />
    <SidebarPageMenu
      v-if="pageMenuTarget && pageMenuProps.reference"
      v-model:open="pageMenuOpen"
      :page="pageMenuTarget.page"
      :anchor="pageMenuProps.reference"
      :return-focus="pageMenuTarget.returnFocus"
    />
  </aside>
</template>
