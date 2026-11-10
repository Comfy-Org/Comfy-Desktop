import path from 'path'
import * as releaseCache from './release-cache'
import { formatComfyVersion } from './version'
import type { ComfyVersion } from './version'
import { hasGitDir } from './git'
import type { InstallationRecord } from '../installations'

export interface ChannelDef {
  value: string
  label: string
  description: string
  recommended?: boolean
}

export interface ChannelCardData {
  productName?: string
  installedVersion: string
  latestVersion: string
  lastChecked: string
  lastCheckedAt?: number
  updateAvailable: boolean
  actions?: Record<string, unknown>[]
  enriching?: boolean
}

export interface ChannelCard extends ChannelDef {
  data?: ChannelCardData
}

export function buildChannelCards(
  repo: string,
  channelDefs: ChannelDef[],
  installation: InstallationRecord
): ChannelCard[] {
  const cv = installation.comfyVersion as ComfyVersion | undefined
  const installHasGit =
    !!installation.installPath && hasGitDir(path.join(installation.installPath, 'ComfyUI'))
  return channelDefs.map((def) => {
    const info = releaseCache.getEffectiveInfo(repo, def.value, installation)
    const latestCv = info?.commitSha
      ? cv && cv.commit === info.commitSha && cv.baseTag
        ? cv
        : ({
            commit: info.commitSha,
            baseTag: info.baseTag,
            commitsAhead: info.commitsAhead
          } as ComfyVersion)
      : undefined
    const enriching =
      !!info?.commitSha &&
      info.commitsAhead === undefined &&
      info.lastEnrichAttemptAt === undefined &&
      installHasGit
    return {
      ...def,
      data: info
        ? {
            productName: 'ComfyUI',
            installedVersion: cv
              ? formatComfyVersion(cv, 'detail')
              : info.installedTag || 'unknown',
            latestVersion: latestCv
              ? formatComfyVersion(latestCv, 'detail')
              : info.releaseName || info.latestTag || '—',
            lastChecked: info.checkedAt ? new Date(info.checkedAt).toLocaleString() : '—',
            lastCheckedAt: info.checkedAt ?? undefined,
            updateAvailable: releaseCache.isUpdateAvailable(installation, def.value, info),
            ...(enriching ? { enriching: true } : {})
          }
        : undefined
    }
  })
}

export function buildChannelLabelMap(defs: ChannelDef[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const def of defs) map[def.value] = def.label
  return map
}
