import type { Installation } from '../../types/ipc'

export type HomeBuildTone = 'ember' | 'iris' | 'tide'
export type HomeBuildStatus = 'running' | 'starting' | 'update' | 'always-on' | 'ready'

export interface HomeBuildToneStyle {
  glow: string
  tint: string
  border: string
}

export const HOME_BUILD_TONES: Record<HomeBuildTone, HomeBuildToneStyle> = {
  ember: { glow: '#FA8746', tint: '232 126 66', border: '226 177 157' },
  iris: { glow: '#989CFF', tint: '142 146 248', border: '177 186 226' },
  tide: { glow: '#00C6E2', tint: '0 182 209', border: '147 196 216' }
}

const LOCAL_TONES: readonly HomeBuildTone[] = ['ember', 'iris']

export function isCloudBuild(build: Installation): boolean {
  return build.sourceCategory === 'cloud'
}

export function isComfyCloud(build: Installation): boolean {
  return build.sourceId === 'cloud'
}

export function homeBuildTones(builds: readonly Installation[]): HomeBuildTone[] {
  let localCount = 0
  return builds.map((build) =>
    isCloudBuild(build) ? 'tide' : LOCAL_TONES[localCount++ % LOCAL_TONES.length]!
  )
}

export function homeBuildStatus(
  build: Installation,
  session: { isRunning: (id: string) => boolean; isLaunching: (id: string) => boolean }
): HomeBuildStatus {
  if (session.isLaunching(build.id)) return 'starting'
  if (session.isRunning(build.id)) return 'running'
  if (build.statusTag?.style === 'update') return 'update'
  return isCloudBuild(build) ? 'always-on' : 'ready'
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
  const parts = [build.version ? `ComfyUI ${build.version}` : '', build.installPath ?? '']
  return parts.filter(Boolean).join(' · ') || build.sourceLabel
}
