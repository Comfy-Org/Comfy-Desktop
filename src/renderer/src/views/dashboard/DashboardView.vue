<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue'
import { TooltipProvider } from 'reka-ui'
import DashboardSidebar from './DashboardSidebar.vue'
import DashboardAccountMenu from './DashboardAccountMenu.vue'
import { ALL_BUILDS } from './dashboardPage'
import type { DashboardPage } from './dashboardPage'
import { providePaletteScope } from '../../composables/usePaletteScope'
import { useDashboardWorkspace } from '../../composables/useDashboardWorkspace'
import { useInstallList } from '../../composables/useInstallList'
import { useInstallationStore } from '../../stores/installationStore'

/**
 * The Builds dashboard (redesign Milestone 2, behind `newDashboardEnabled`):
 * a sidebar of the selected workspace's builds and the page it opens. Emits
 * ChooserView's events, so PanelApp's launch, wizard and progress wiring is
 * shared.
 */
const emit = defineEmits<{
  'show-new-install': []
}>()

const paletteScope = providePaletteScope()
const installationStore = useInstallationStore()
onMounted(() => {
  if (installationStore.installations.length === 0) void installationStore.fetchInstallations()
})

const { selectedWorkspaceModel, installationIsInSelectedScope } = useDashboardWorkspace()
// Same recency order as the title-bar picker.
const { visibleInstalls } = useInstallList({
  installations: toRef(installationStore, 'installations')
})
const workspaceInstalls = computed(() =>
  visibleInstalls.value.filter(installationIsInSelectedScope)
)

const page = ref<DashboardPage>(ALL_BUILDS)
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
      >
        <template #foot>
          <DashboardAccountMenu v-model:workspace-id="selectedWorkspaceModel" />
        </template>
      </DashboardSidebar>

      <main class="ds-content relative min-w-0 flex-1 overflow-y-auto scrollbar-quiet" />
    </div>
  </TooltipProvider>
</template>
