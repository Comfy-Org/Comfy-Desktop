import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DotStatus } from '../../design-system/components/StatusDot.vue'
import type { useInstallTileState } from '../../composables/useInstallTileState'
import type { Installation } from '../../types/ipc'

/** The status line's label key when no lifecycle state applies: Comfy Cloud
 *  is always ready; anything else is simply not running. */
export function idleStatusKey(installation: Installation): string {
  return installation.sourceCategory === 'cloud'
    ? 'buildsDashboard.status.ready'
    : 'buildsDashboard.status.notRunning'
}

export interface BuildState {
  isRunning: boolean
  isLaunching: boolean
  isStopping: boolean
  isUpdating: boolean
  hasError: boolean
  /** A backend-flagged problem (failed install, missing folder). */
  hasDanger: boolean
}

/** The status dot for a build: a problem wins, then work in progress, then
 *  running; an idle Comfy Cloud build is ready, any other is idle. */
export function dotStatusOf(installation: Installation, state: BuildState): DotStatus {
  if (state.hasError || state.hasDanger) return 'error'
  if (state.isUpdating || state.isStopping || state.isLaunching) return 'busy'
  if (state.isRunning) return 'running'
  return installation.sourceCategory === 'cloud' ? 'ready' : 'idle'
}

/** A build's status line (card and page): its label and dot. A problem
 *  wins, as it does for the dot. */
export function useBuildStatus(tile: ReturnType<typeof useInstallTileState>) {
  const { t } = useI18n()
  const statusLabel = computed(() => {
    if (tile.hasError.value) return t('chooser.statusError')
    if (tile.dangerTag.value) return tile.dangerTag.value.label
    if (tile.statusPill.value) return t(tile.statusPill.value.label)
    return t(idleStatusKey(tile.inst.value))
  })
  const dotStatus = computed(() =>
    dotStatusOf(tile.inst.value, {
      isRunning: tile.isRunning.value,
      isLaunching: tile.isLaunching.value,
      isStopping: tile.isStopping.value,
      isUpdating: tile.isUpdating.value,
      hasError: tile.hasError.value,
      hasDanger: tile.dangerTag.value != null
    })
  )
  return { statusLabel, dotStatus }
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/** The build page's type-tag tooltip: where the build runs, its version,
 *  where it lives, and when it was last used, one per line. */
export function buildInfoLines(
  installation: Installation,
  facts: { metaLine: string; lastUsed: string },
  t: Translate
): string[] {
  const host = (installation.listPreview || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const place =
    installation.sourceCategory === 'cloud'
      ? t('buildsDashboard.runsOn.cloud')
      : installation.sourceCategory === 'remote'
        ? host || t('buildsDashboard.runsOn.remote')
        : t('buildsDashboard.runsOn.thisComputer')
  const location = installation.sourceCategory === 'local' ? installation.installPath : host
  const bare = (text: string): string => text.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const lines = [
    t('buildsDashboard.buildInfo.runsOn', { place }),
    facts.metaLine,
    location ?? '',
    facts.lastUsed && t('buildsDashboard.buildInfo.lastUsed', { when: facts.lastUsed })
  ].filter(Boolean)
  // A Cloud or remote build's meta line is often its address already.
  return lines.filter((line, i) => lines.findIndex((other) => bare(other) === bare(line)) === i)
}
