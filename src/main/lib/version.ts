import semver from 'semver'
import type { InstallationRecord } from '../installations'
import type { CoreVersionState } from './coreBetaGrants'

export interface ComfyVersion {
  commit: string
  baseTag?: string
  commitsAhead?: number
  baseTagVerified?: boolean
  ancestorTag?: string
}

export function formatComfyVersion(v: ComfyVersion | undefined, style: 'short' | 'detail'): string {
  if (!v) return 'unknown'

  const { commit, baseTag, commitsAhead } = v
  const shortSha = commit.slice(0, 7)

  if (!baseTag) return shortSha

  if (commitsAhead === 0) return baseTag

  if (commitsAhead === undefined) {
    return `${baseTag} (${shortSha})`
  }

  if (style === 'short') {
    return `${baseTag}+${commitsAhead}`
  }

  return `${baseTag} + ${commitsAhead} commit${commitsAhead !== 1 ? 's' : ''} (${shortSha})`
}

export function coreSemver(inst: InstallationRecord): string | null {
  const raw = inst.comfyVersion?.baseTag ?? inst.version
  if (typeof raw !== 'string') return null
  return semver.valid(raw.replace(/^v/, ''))
}

export function coreSemverExact(inst: InstallationRecord): boolean {
  return inst.comfyVersion?.commitsAhead === 0
}

export function coreSemverVerified(inst: InstallationRecord): boolean {
  return inst.comfyVersion?.baseTagVerified === true
}

export function coreVerifiedSemver(inst: InstallationRecord): string | null {
  const cv = inst.comfyVersion
  const raw = cv?.baseTagVerified === true ? cv.baseTag : cv?.ancestorTag
  if (typeof raw !== 'string') return null
  return semver.valid(raw.replace(/^v/, ''))
}

export function coreGateVersion(inst: InstallationRecord): Omit<CoreVersionState, 'current'> {
  const verifiedSemver = coreVerifiedSemver(inst)
  return {
    semver: verifiedSemver ?? coreSemver(inst),
    exact: coreSemverExact(inst) && coreSemverVerified(inst),
    verified: verifiedSemver !== null
  }
}

export type CoreCheckout =
  | { kind: 'not-git' }
  | { kind: 'head'; commit: string }
  | { kind: 'unreadable' }

export function coreRecordCurrent(inst: InstallationRecord, checkout: CoreCheckout): boolean {
  switch (checkout.kind) {
    case 'not-git':
      return true
    case 'unreadable':
      return false
    case 'head': {
      const recorded = inst.comfyVersion?.commit
      if (typeof recorded !== 'string') return false
      return recorded.toLowerCase() === checkout.commit.toLowerCase()
    }
  }
}

export function tagsEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return a.replace(/^v/, '') === b.replace(/^v/, '')
}
