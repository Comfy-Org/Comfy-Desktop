<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { TooltipProvider } from 'reka-ui'
import ContextMenu from '../../components/ContextMenu.vue'
import WhyTryCloudModal from '../../components/WhyTryCloudModal.vue'
import DashboardSidebar from './DashboardSidebar.vue'
import DashboardAccountMenu from './DashboardAccountMenu.vue'
import InstallListPage from './InstallListPage.vue'
import InstallPage from './InstallPage.vue'
import { ALL_BUILDS, installPage } from './dashboardPage'
import type { DashboardPage } from './dashboardPage'
import { provideBuildRename } from './useBuildRename'
import type { RenameSurface } from './useBuildRename'
import { providePaletteScope } from '../../composables/usePaletteScope'
import { useDashboardWorkspace } from '../../composables/useDashboardWorkspace'
import { useInstallList } from '../../composables/useInstallList'
import { useInstallContextMenu } from '../../composables/useInstallContextMenu'
import { usePickInstall } from '../../composables/usePickInstall'
import { useCloudTier } from '../../composables/useCloudTier'
import { useWhyCloud } from '../../composables/useWhyCloud'
import { openInstallManager } from '../../lib/openInstallManager'
import { useInstallationStore } from '../../stores/installationStore'
import type { Installation, ShowProgressOpts } from '../../types/ipc'

/**
 * The Builds dashboard (redesign Milestone 2, behind `newDashboardEnabled`):
 * a sidebar of the selected workspace's builds and the page it opens. Emits
 * ChooserView's events, so PanelApp's launch, wizard and progress wiring is
 * shared.
 */
const emit = defineEmits<{
  pick: [installation: Installation]
  'show-new-install': []
  'show-progress': [opts: ShowProgressOpts]
}>()

const paletteScope = providePaletteScope()
const installationStore = useInstallationStore()
onMounted(() => {
  if (installationStore.installations.length === 0) void installationStore.fetchInstallations()
})

const { selectedWorkspaceModel, installationIsInSelectedScope, canPromoteToWorkspace } =
  useDashboardWorkspace()
// Same recency order as the title-bar picker.
const { visibleInstalls } = useInstallList({
  installations: toRef(installationStore, 'installations')
})
const workspaceInstalls = computed(() =>
  visibleInstalls.value.filter(installationIsInSelectedScope)
)

const page = ref<DashboardPage>(ALL_BUILDS)
const openInstall = computed(() => {
  const current = page.value
  if (current.kind !== 'install') return null
  return workspaceInstalls.value.find((inst) => inst.id === current.installationId) ?? null
})
// A build that leaves the workspace (deleted, or another workspace picked)
// takes its page with it.
watch(openInstall, (inst) => {
  if (!inst && page.value.kind === 'install') page.value = ALL_BUILDS
})

/** The title bar's "Builds" crumb, through the panel. */
defineExpose({
  showAllBuilds: () => {
    closeMenu()
    page.value = ALL_BUILDS
  }
})

const { canRename, startRename } = provideBuildRename()
/** Which surface opened the build menu, so its Rename edits the name there. */
let menuSurface: RenameSurface = 'main'

const {
  ctxMenu,
  ctxMenuItems,
  openCardMenu,
  openKebabMenu,
  handleCtxMenuSelect,
  closeMenu,
  triggerAction,
  viewError,
  viewDanger,
  isStoppedActionGated,
  isPromotingToWorkspace
} = useInstallContextMenu({
  onManage: openInstallManager,
  onShowProgress: (showOpts) => emit('show-progress', showOpts),
  canPromoteToWorkspace,
  canRename,
  onRename: (inst) => startRename(inst, menuSurface)
})
const { pickInstall } = usePickInstall((inst) => emit('pick', inst))
const { showCloudFreeRunsPill, showWhyCloud } = useCloudTier()
const { whyCloudOpen, openWhyCloud, dismissWhyCloud, onWhyCloudTryCloud } = useWhyCloud()

function openSidebarMenu(event: MouseEvent, inst: Installation): void {
  menuSurface = 'sidebar'
  openCardMenu(event, inst)
}

const pageHandlers = {
  'open-kebab-menu': (event: MouseEvent, inst: Installation) => {
    menuSurface = 'main'
    openKebabMenu(event, inst)
  },
  'trigger-action': (action: 'update' | 'migrate', inst: Installation) =>
    triggerAction(action, inst),
  'view-error': viewError,
  'view-danger': viewDanger
}
const cardHandlers = {
  ...pageHandlers,
  'open-card-menu': (event: MouseEvent, inst: Installation) => {
    menuSurface = 'main'
    openCardMenu(event, inst)
  }
}
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <div
      class="ds-root ds-page relative flex size-full min-h-0 flex-1 overflow-hidden bg-app-background"
      :class="paletteScope"
      data-testid="builds-dashboard"
    >
      <DashboardSidebar
        v-model:page="page"
        :installations="workspaceInstalls"
        @new-build="emit('show-new-install')"
        @open-menu="openSidebarMenu"
      >
        <template #foot>
          <DashboardAccountMenu v-model:workspace-id="selectedWorkspaceModel" />
        </template>
      </DashboardSidebar>

      <main class="ds-content relative min-w-0 flex-1 overflow-y-auto scrollbar-quiet">
        <InstallPage
          v-if="openInstall"
          :key="openInstall.id"
          :installation="openInstall"
          :is-stopped-action-gated="isStoppedActionGated(openInstall)"
          :is-promoting-to-workspace="isPromotingToWorkspace(openInstall)"
          v-on="pageHandlers"
          @back="page = ALL_BUILDS"
          @launch="pickInstall"
          @stop="triggerAction('stop', $event)"
        />
        <!-- Nothing until the first load lands: no false "no builds yet". -->
        <InstallListPage
          v-else-if="!installationStore.loading || workspaceInstalls.length"
          :installations="workspaceInstalls"
          :show-free-runs-pill="showCloudFreeRunsPill"
          :show-why-cloud="showWhyCloud"
          :is-stopped-action-gated="isStoppedActionGated"
          :is-promoting-to-workspace="isPromotingToWorkspace"
          v-on="cardHandlers"
          @new-build="emit('show-new-install')"
          @open="page = installPage($event.id)"
          @launch="pickInstall"
          @why-cloud="openWhyCloud"
        />
      </main>

      <ContextMenu
        :open="ctxMenu.open"
        :x="ctxMenu.x"
        :y="ctxMenu.y"
        :items="ctxMenuItems"
        @close="closeMenu"
        @select="handleCtxMenuSelect"
      />
      <WhyTryCloudModal
        v-if="whyCloudOpen"
        @close="dismissWhyCloud"
        @try-cloud="onWhyCloudTryCloud"
      />
    </div>
  </TooltipProvider>
</template>
