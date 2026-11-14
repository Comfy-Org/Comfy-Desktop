import { promises as fsp } from 'fs'
import path from 'path'
import semver from 'semver'

import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import { _hasActiveLaunch, _operationAborts, _runningSessions, sourceMap } from '../lib/ipc/shared'
import { resolveComfyDir } from '../lib/models'
import { coreSemver, coreVerifiedSemver } from '../lib/version'

const LEGACY_DESKTOP_SOURCE = 'desktop'
const VERSION_FILE = 'comfyui_version.py'
const VERSION_LINE = /^__version__\s*=\s*['"]([^'"]+)['"]/m

export interface LocalBuild {
  id: string
  name: string
  version: string | null
  port: number | null
  starting: boolean
  lastLaunchedAt: number
}

export type LocalChoice =
  | { kind: 'build'; build: LocalBuild }
  | { kind: 'no-builds' }
  | { kind: 'too-old'; wanted: string }

function releaseVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return semver.valid(semver.coerce(value.trim().replace(/^v/, ''), { includePrerelease: false }))
}

export function wantedVersion(want: unknown): string | null {
  if (typeof want !== 'object' || want === null) return null
  return releaseVersion((want as { minVersion?: unknown }).minVersion)
}

async function versionOnDisk(inst: InstallationRecord): Promise<string | null> {
  const file = path.join(resolveComfyDir(inst.installPath), VERSION_FILE)
  const text = await fsp.readFile(file, 'utf8').catch(() => null)
  return text === null ? null : releaseVersion(VERSION_LINE.exec(text)?.[1])
}

async function installedVersion(inst: InstallationRecord): Promise<string | null> {
  return (await versionOnDisk(inst)) ?? coreVerifiedSemver(inst) ?? coreSemver(inst)
}

export function runningPortOf(installationId: string): number | null {
  const session = _runningSessions.get(installationId)
  if (!session || session.url || session.port <= 0) return null
  return (session.sourceInstallationId ?? installationId) === installationId ? session.port : null
}

function runsOnThisComputer(inst: InstallationRecord): boolean {
  return (
    sourceMap[inst.sourceId]?.category === 'local' &&
    inst.sourceId !== LEGACY_DESKTOP_SOURCE &&
    inst.status === 'installed' &&
    typeof inst.installPath === 'string' &&
    inst.installPath !== ''
  )
}

function isBeingChanged(installationId: string): boolean {
  if (runningPortOf(installationId) !== null || _hasActiveLaunch(installationId)) return false
  return _operationAborts.has(installationId)
}

export async function usableLocalBuilds(): Promise<LocalBuild[]> {
  const usable = (await installations.list()).filter(
    (inst) => runsOnThisComputer(inst) && !isBeingChanged(inst.id)
  )
  return Promise.all(
    usable.map(async (inst) => ({
      id: inst.id,
      name: inst.name,
      version: await installedVersion(inst),
      port: runningPortOf(inst.id),
      starting: _hasActiveLaunch(inst.id),
      lastLaunchedAt: typeof inst.lastLaunchedAt === 'number' ? inst.lastLaunchedAt : 0
    }))
  )
}

function fits(build: LocalBuild, wanted: string | null): boolean {
  if (wanted === null) return true
  return build.version !== null && semver.gte(build.version, wanted)
}

function newerFirst(one: LocalBuild, other: LocalBuild): number {
  if (one.version === null || other.version === null) {
    return Number(other.version !== null) - Number(one.version !== null)
  }
  return semver.rcompare(one.version, other.version)
}

export function chooseLocalBuild(
  builds: readonly LocalBuild[],
  wanted: string | null
): LocalChoice {
  if (builds.length === 0) return { kind: 'no-builds' }
  const fitting = builds.filter((build) => fits(build, wanted))
  if (fitting.length === 0) return { kind: 'too-old', wanted: wanted ?? '' }
  const [build] = [...fitting].sort(
    (one, other) =>
      Number(other.port !== null) - Number(one.port !== null) ||
      Number(other.starting) - Number(one.starting) ||
      other.lastLaunchedAt - one.lastLaunchedAt ||
      newerFirst(one, other)
  )
  return build ? { kind: 'build', build } : { kind: 'no-builds' }
}
