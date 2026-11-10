import * as settings from '../settings'
import type { CoreBetaGrant } from './coreBetaGrants'

export const BETA_NOTICE_ANNOUNCED_ARGS_KEY = 'betaNoticeAnnouncedArgs'

const ENABLE_PREFIX = '--enable-'
const DISABLE_PREFIX = '--disable-'

export interface PendingBetaGrant {
  readonly arg: string
  readonly direction: 'enabled' | 'disabled'
  readonly description: string | null
}

export interface BetaActivationNotice {
  readonly args: readonly string[]
  readonly direction: 'enabled' | 'disabled'
  readonly description: string | null
}

const pendingByInstallation = new Map<string, PendingBetaGrant[]>()

export function readAnnouncedBetaArgs(): string[] {
  const raw = settings.get(BETA_NOTICE_ANNOUNCED_ARGS_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string')
}

export function selectNewlyActiveBetaGrants(
  applied: readonly CoreBetaGrant[],
  spokenFor: ReadonlySet<string>
): PendingBetaGrant[] {
  const fresh: PendingBetaGrant[] = []
  const seen = new Set(spokenFor)
  for (const grant of applied) {
    if (seen.has(grant.arg)) continue
    seen.add(grant.arg)
    if (grant.notice?.silent === true) continue
    const description = grant.notice?.description ?? null
    if (!grant.arg.startsWith(ENABLE_PREFIX) && !grant.arg.startsWith(DISABLE_PREFIX)) continue
    const direction = grant.arg.startsWith(ENABLE_PREFIX) ? 'enabled' : 'disabled'
    if (direction === 'disabled' && description === null) continue
    fresh.push({ arg: grant.arg, direction, description })
  }
  return fresh
}

export function resolveBetaActivationNotice(
  pending: readonly PendingBetaGrant[]
): BetaActivationNotice | null {
  if (pending.length === 0) return null
  const direction = pending.some((grant) => grant.direction === 'enabled') ? 'enabled' : 'disabled'
  const covered = pending.filter((grant) => grant.direction === direction)
  const description = covered.length === 1 ? covered[0]!.description : null
  return { args: covered.map((grant) => grant.arg), direction, description }
}

export function armBetaActivationNotice(
  installationId: string,
  applied: readonly CoreBetaGrant[]
): void {
  try {
    pendingByInstallation.delete(installationId)
    if (applied.length === 0) return
    const spokenFor = new Set(readAnnouncedBetaArgs())
    const fresh = selectNewlyActiveBetaGrants(applied, spokenFor)
    if (fresh.length === 0) return
    pendingByInstallation.set(installationId, fresh)
  } catch (err) {
    console.log('[beta-notice] arm failed:', err)
  }
}

export function clearBetaActivationClaim(installationId: string): void {
  try {
    pendingByInstallation.delete(installationId)
  } catch (err) {
    console.log('[beta-notice] clear failed:', err)
  }
}

export function peekBetaActivationNotice(installationId: string): BetaActivationNotice | null {
  const queued = pendingByInstallation.get(installationId) ?? []
  if (queued.length === 0) return null
  const announced = new Set(readAnnouncedBetaArgs())
  return resolveBetaActivationNotice(queued.filter((grant) => !announced.has(grant.arg)))
}

export function acknowledgeBetaActivationNotice(
  installationId: string,
  shownArgs?: readonly string[]
): void {
  const queued = pendingByInstallation.get(installationId)
  if (!queued || queued.length === 0) return
  const shown = shownArgs?.length ? shownArgs : resolveBetaActivationNotice(queued)?.args
  if (!shown || shown.length === 0) return
  const coveredSet = new Set(shown)
  const covered = queued.filter((grant) => coveredSet.has(grant.arg)).map((grant) => grant.arg)
  if (covered.length === 0) return
  try {
    const merged = [...new Set([...readAnnouncedBetaArgs(), ...covered])]
    settings.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, merged)
    const persisted = new Set(readAnnouncedBetaArgs())
    if (!covered.every((arg) => persisted.has(arg))) return
    const remaining = queued.filter((grant) => !coveredSet.has(grant.arg))
    if (remaining.length > 0) pendingByInstallation.set(installationId, remaining)
    else pendingByInstallation.delete(installationId)
  } catch (err) {
    console.log('[beta-notice] acknowledge failed:', err)
  }
}

export function _resetForTest(): void {
  pendingByInstallation.clear()
}
