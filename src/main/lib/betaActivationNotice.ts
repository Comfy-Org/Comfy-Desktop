/**
 * One-per-feature heads-up that a Core beta grant has actually turned something on.
 *
 * Separate concern from enrolment. `coreBetaGrants.ts` decides WHETHER a user is in the beta and
 * which args they get; this module only answers "has the user been told about this one yet?".
 * Nothing here feeds back into selection — suppressing a notice never suppresses a grant, and a
 * user who dismisses the card is still in the beta until they use the opt-out it points at.
 *
 * Armed from `reportCoreBetaLaunch`, which is the only point where a grant is provably real:
 * it fires once per launch, past the last cancellation gate, and only for grants that cleared
 * BOTH the version window and the running core's args schema. Arming earlier (at payload
 * receipt, say) would announce features that the gate or the schema then drops.
 *
 * The title bar PULLS rather than main pushing: at arm time the host window may still be the
 * dashboard, mid-attach, or under the launch progress takeover, so a push would have to guess
 * when a renderer is ready to render a card. Instead the pending set sits here until the title
 * bar's own gate (`useBetaActivationNotice`) opens and asks for it.
 */
import * as settings from '../settings'

/** Args already announced, as a durable string list. A LIST rather than a boolean so a second
 *  beta feature granted months later still gets its own heads-up; append-only, so a grant that
 *  is revoked and later re-granted stays silent the second time. */
export const BETA_NOTICE_ANNOUNCED_ARGS_KEY = 'betaNoticeAnnouncedArgs'

/** Only grants that turn something ON announce. `--disable-*` exists in the allowlist as a
 *  remote force-OFF (see `CORE_BETA_GRANTABLE_ARGS`), and the notice's copy — "a beta feature
 *  is on", pointing at the opt-out switch — would be flatly wrong for one: it names the
 *  opposite of what happened and offers an action that does not apply. Silent is the honest
 *  reading until the payload can carry its own copy. */
const ENABLE_PREFIX = '--enable-'

/**
 * Pending notices by installation id, drained by the title bar of that install's host window.
 *
 * Process-lifetime only, deliberately. A pending notice that is never acknowledged — window
 * closed, app quit, bell not reachable — must REPLAY on the next launch rather than being lost,
 * so nothing is written to disk until the user actually retires the card.
 */
const pendingByInstallation = new Map<string, string[]>()

/** Every arg currently pending across all installs. Two windows launching with the same fresh
 *  grant would otherwise each show a card for it, since neither has acknowledged yet and the
 *  persisted list is still empty. First claim wins; the second install stays silent. */
function claimedArgs(): Set<string> {
  const claimed = new Set<string>()
  for (const args of pendingByInstallation.values()) {
    for (const arg of args) claimed.add(arg)
  }
  return claimed
}

/** In-memory mirror of the persisted list. `settings.get` re-reads and re-parses the whole
 *  file on every call, and its retry path blocks the main thread with `Atomics.wait` — which
 *  `armBetaActivationNotice` would otherwise pay on the spawn critical path, once per launch.
 *  Safe to cache because this module is the only writer of the key; it is refreshed on write
 *  and cleared for tests. */
let announcedCache: string[] | null = null

/** The persisted list, defensive about content: `settings.json` is user-writable, so a
 *  hand-edited non-array or a non-string entry has to read as "nothing announced yet" rather
 *  than throwing on the launch path. */
export function readAnnouncedBetaArgs(): string[] {
  if (announcedCache !== null) return announcedCache
  const raw = settings.get(BETA_NOTICE_ANNOUNCED_ARGS_KEY)
  const parsed = Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === 'string')
    : []
  announcedCache = parsed
  return parsed
}

/**
 * The grants from this launch the user has not been told about yet.
 *
 * Pure so the trigger rule is testable without settings or a launch: takes what was applied
 * plus what is already spoken for, returns what is new. Order follows `appliedArgs` and
 * duplicates collapse, so a payload naming an arg twice cannot double-announce it.
 */
export function selectNewlyActiveBetaArgs(
  appliedArgs: readonly string[],
  spokenFor: ReadonlySet<string>
): string[] {
  const fresh: string[] = []
  const seen = new Set(spokenFor)
  for (const arg of appliedArgs) {
    if (!arg.startsWith(ENABLE_PREFIX)) continue
    if (seen.has(arg)) continue
    seen.add(arg)
    fresh.push(arg)
  }
  return fresh
}

/**
 * Queue a notice for any grant this launch turned on for the first time.
 *
 * Called from the launch path, so it must never throw: a settings read that fails costs the
 * user a heads-up, which is strictly better than costing them the launch.
 */
export function armBetaActivationNotice(
  installationId: string,
  appliedArgs: readonly string[]
): void {
  try {
    // Replace, never append. Arming happens before the spawn is known to have succeeded, so a
    // claim can be left behind by a launch that then failed to boot. The next launch of this
    // install is the authority on what is actually on its command line: relaunching with beta
    // turned off must clear the old claim, not inherit it and then announce a feature that is
    // no longer on. Dropping a claim also releases it for other installs, since `claimedArgs`
    // reads the same map.
    pendingByInstallation.delete(installationId)
    if (appliedArgs.length === 0) return
    const spokenFor = new Set([...readAnnouncedBetaArgs(), ...claimedArgs()])
    const fresh = selectNewlyActiveBetaArgs(appliedArgs, spokenFor)
    if (fresh.length === 0) return
    pendingByInstallation.set(installationId, fresh)
  } catch (err) {
    console.log('[beta-notice] arm failed:', err)
  }
}

/** What this install's title bar should announce, or `[]`. Read-only: the pending entry
 *  survives until `acknowledgeBetaActivationNotice`, so a card that is shown but never retired
 *  (window closed, app quit) comes back on the next launch. */
export function peekBetaActivationNotice(installationId: string): string[] {
  return [...(pendingByInstallation.get(installationId) ?? [])]
}

/**
 * Retire this install's notice: persist its args as announced and drop the pending entry.
 *
 * Called when the user dismisses the card or follows its settings link — acting on it is
 * acknowledging it. Merged into the stored list rather than replacing it, so two installs
 * retiring different notices cannot clobber each other.
 */
export function acknowledgeBetaActivationNotice(installationId: string): void {
  const pending = pendingByInstallation.get(installationId)
  pendingByInstallation.delete(installationId)
  if (!pending || pending.length === 0) return
  try {
    const merged = [...new Set([...readAnnouncedBetaArgs(), ...pending])]
    settings.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, merged)
    announcedCache = merged
  } catch (err) {
    // A failed write costs the user a repeat card on the next launch and nothing else.
    console.log('[beta-notice] acknowledge failed:', err)
  }
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  pendingByInstallation.clear()
  announcedCache = null
}
