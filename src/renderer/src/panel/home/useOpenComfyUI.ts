import { computed, ref, toRef } from 'vue'
import { useInstallList } from '../../composables/useInstallList'
import { buildProgressOf } from '../../composables/useBuildProgress'
import { isPromotingToWorkspace } from '../../composables/useInstallContextMenu'
import { useDashboardScopeStore } from '../../stores/dashboardScopeStore'
import { useInstallationStore } from '../../stores/installationStore'
import { useProgressStore } from '../../stores/progressStore'
import { useSessionStore } from '../../stores/sessionStore'
import { isInstallationInWorkspace } from '../../../../shared/workspaces'
import { homeBuildStatus, isBuildOpenBlocked, isCloudBuild } from './homeBuild'
import { useAutoStartReadyNotice } from './useAutoStartReadyNotice'
import { useOpenWhenReady } from './useOpenWhenReady'
import type { Installation } from '../../types/ipc'

export function useOpenComfyUI(open: (build: Installation) => void) {
  const installationStore = useInstallationStore()
  const sessionStore = useSessionStore()
  const progressStore = useProgressStore()
  const dashboardScope = useDashboardScopeStore()
  const { visibleInstalls } = useInstallList({
    installations: toRef(installationStore, 'installations')
  })

  const workspaceBuilds = computed(() =>
    visibleInstalls.value.filter((build) =>
      isInstallationInWorkspace(build, dashboardScope.selectedWorkspaceId)
    )
  )

  function statusOf(build: Installation) {
    return homeBuildStatus(build, sessionStore)
  }

  const openableBuilds = computed(() =>
    workspaceBuilds.value.filter(
      (build) =>
        buildProgressOf(progressStore, build.id) === null &&
        !isBuildOpenBlocked(statusOf(build)) &&
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
  const opensWhenReady = useOpenWhenReady(open)

  function openBuild(build: Installation): void {
    readyNotice.dismiss(build.id)
    if (opensWhenReady.openWhenReady(build)) return
    opensWhenReady.forget()
    open(build)
  }

  return {
    workspaceBuilds,
    openableBuilds,
    openTarget,
    pickedBuildId,
    statusOf,
    readyNotice,
    opensWhenReady,
    openBuild
  }
}
