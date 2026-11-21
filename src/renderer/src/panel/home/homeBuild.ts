import { formatLastUsed } from '../../lib/datetime'
import { progressOpKindForActionId } from '../../lib/progressOpKind'
import { lastUsedAt } from '../../../../shared/lastUsed'
import type { LocalDeviceKind } from '../../composables/useLocalDeviceKind'
import type { useSessionStore } from '../../stores/sessionStore'
import type { Installation } from '../../types/ipc'

export type HomeBuildTone = 'iris' | 'tide'
export type BuildDeviceKind = LocalDeviceKind | 'cloud'
export type HomeBuildStatus = 'running' | 'starting' | 'stopping' | 'updating' | 'update' | 'ready'

export interface HomeBuildToneStyle {
  glow: string
  tint: string
}

export const HOME_BUILD_TONES: Record<HomeBuildTone, HomeBuildToneStyle> = {
  iris: { glow: '#989CFF', tint: '142 146 248' },
  tide: { glow: '#00C6E2', tint: '0 182 209' }
}

export function isCloudBuild(build: Installation): boolean {
  return build.sourceCategory === 'cloud'
}

export function buildDeviceKind(build: Installation, localKind: LocalDeviceKind): BuildDeviceKind {
  if (isCloudBuild(build)) return 'cloud'
  return build.sourceCategory === 'remote' ? 'monitor' : localKind
}

export function homeBuildTone(build: Installation): HomeBuildTone {
  return isCloudBuild(build) ? 'tide' : 'iris'
}

export function isBuildUpdating(build: Installation, actionId: string | undefined): boolean {
  return (
    build.status === 'updating' ||
    (actionId !== undefined && progressOpKindForActionId(actionId) === 'update')
  )
}

export function buildUsageLabel(
  build: Installation,
  nowMs: number,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale?: string
): string {
  const usedAt = lastUsedAt(build)
  if (usedAt === undefined && isCloudBuild(build)) return t('home.cloudNoSetupNeeded')
  return formatLastUsed(usedAt, nowMs, t, locale)
}

export function isBuildOpenBlocked(status: HomeBuildStatus): boolean {
  return status === 'stopping' || status === 'updating'
}

export function homeBuildStatus(
  build: Installation,
  session: Pick<
    ReturnType<typeof useSessionStore>,
    'isRunning' | 'isLaunching' | 'isStopping' | 'operationInstances'
  >
): HomeBuildStatus {
  if (isBuildUpdating(build, session.operationInstances.get(build.id)?.actionId)) return 'updating'
  if (session.isStopping(build.id)) return 'stopping'
  if (session.isLaunching(build.id)) return 'starting'
  if (session.isRunning(build.id)) return 'running'
  if (build.statusTag?.style === 'update') return 'update'
  return 'ready'
}

function hostOf(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

export function homeBuildDetail(build: Installation): string {
  if (build.sourceCategory === 'cloud' || build.sourceCategory === 'remote') {
    return build.listPreview ? hostOf(build.listPreview) : build.sourceLabel
  }
  return build.version || build.sourceLabel
}
