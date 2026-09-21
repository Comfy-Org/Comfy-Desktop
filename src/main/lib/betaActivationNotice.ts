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
import type { CoreBetaGrant } from './coreBetaGrants'

/** Args already announced, as a durable string list. A LIST rather than a boolean so a second
 *  beta feature granted months later still gets its own heads-up; append-only, so a grant that
 *  is revoked and later re-granted stays silent the second time. */
export const BETA_NOTICE_ANNOUNCED_ARGS_KEY = 'betaNoticeAnnouncedArgs'

const ENABLE_PREFIX = '--enable-'
const DISABLE_PREFIX = '--disable-'

/** One grant the user has not been told about, plus the wording its payload asked for. */
export interface PendingBetaGrant {
  readonly arg: string
  /** Whether this grant turned the feature on or off. */
  readonly direction: 'enabled' | 'disabled'
  /** Payload-supplied feature name, or `null` for the generic wording. */
  readonly description: string | null
}

/** What the title bar needs to render one card: which args it covers (so retiring it can
 *  acknowledge exactly those), and the copy to use. */
export interface BetaActivationNotice {
  readonly args: readonly string[]
  /** `'disabled'` only when EVERY covered grant was a force-off; a launch that turned
   *  something on is "a beta feature is on" regardless of what else it turned off. */
  readonly direction: 'enabled' | 'disabled'
  /** Non-null only when the card covers exactly one grant AND its payload named the feature.
   *  Two features at once have no single honest name, so that falls back to generic. */
  readonly description: string | null
}

/**
 * Pending notices by installation id, drained by the title bar of that install's host window.
 *
 * Process-lifetime only, deliberately. A pending notice that is never acknowledged — window
 * closed, app quit, bell not reachable — must REPLAY on the next launch rather than being lost,
 * so nothing is written to disk until the user actually retires the card.
 */
const pendingByInstallation = new Map<string, PendingBetaGrant[]>()

/** The persisted list, defensive about content: `settings.json` is user-writable, so a
 *  hand-edited non-array or a non-string entry has to read as "nothing announced yet" rather
 *  than throwing on the launch path.
 *
 *  Read straight through rather than cached. A cache here would have to stay coherent with
 *  every other writer of the key — it is schema-known, so the generic `set-setting` IPC and
 *  any settings import or reset can change it — and a stale entry either replays an announced
 *  notice or suppresses a new one for the process lifetime. The read it avoids is one of
 *  several the launch path already performs. */
export function readAnnouncedBetaArgs(): string[] {
  const raw = settings.get(BETA_NOTICE_ANNOUNCED_ARGS_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * The grants from this launch the user has not been told about yet.
 *
 * Pure so the trigger rule is testable without settings or a launch: takes what was applied
 * plus what is already spoken for, returns what is new. Order follows `applied` and duplicates
 * collapse, so a payload naming an arg twice cannot double-announce it.
 *
 * Three ways a grant stays silent:
 *   - the payload asked for it (`notice: 'silent'`), for a flag with nothing to tell the user;
 *   - it is a `--disable-*` force-off with no payload-supplied name, because the generic
 *     wording describes turning something ON and there would be nothing truthful to say;
 *   - it has already been announced, here or on another install.
 * A named force-off DOES announce: the payload has supplied the one thing the generic copy
 * could not, so the card can say which beta was withdrawn.
 */
export function selectNewlyActiveBetaGrants(
  applied: readonly CoreBetaGrant[],
  spokenFor: ReadonlySet<string>
): PendingBetaGrant[] {
  const fresh: PendingBetaGrant[] = []
  const seen = new Set(spokenFor)
  for (const grant of applied) {
    if (seen.has(grant.arg)) continue
    // Claimed before any skip below, so the de-duplication the doc comment promises holds even
    // when the FIRST occurrence is the one that gets skipped — otherwise
    // `[{arg: X, silent}, {arg: X}]` would announce X after asking for silence.
    seen.add(grant.arg)
    if (grant.notice?.silent === true) continue
    const description = grant.notice?.description ?? null
    // Derived from the prefix PAIR, not as a binary else. An allowlist entry with neither
    // prefix is possible (`oppositeArg` already handles that case, and the list is documented
    // as growing ahead of Core); defaulting it to `disabled` would turn a card that used to
    // stay silent into one that actively says a feature was switched off when it was not.
    if (!grant.arg.startsWith(ENABLE_PREFIX) && !grant.arg.startsWith(DISABLE_PREFIX)) continue
    const direction = grant.arg.startsWith(ENABLE_PREFIX) ? 'enabled' : 'disabled'
    if (direction === 'disabled' && description === null) continue
    fresh.push({ arg: grant.arg, direction, description })
  }
  return fresh
}

/**
 * Collapse this install's pending grants into the single card the title bar renders.
 *
 * Exported and pure because the collapse rules are the interesting part: what a card may
 * honestly claim when it covers more than one grant. Returns `null` when nothing is pending,
 * which is how the renderer decides whether to show anything at all.
 */
export function resolveBetaActivationNotice(
  pending: readonly PendingBetaGrant[]
): BetaActivationNotice | null {
  if (pending.length === 0) return null
  // One direction per card, and the card covers ONLY the grants in it. A single launch can
  // both turn something on and withdraw something else; collapsing those into one card would
  // describe one of them and then acknowledge both, so the undescribed withdrawal could never
  // be announced again on any install. Enables go first because "a beta feature is on" is the
  // more urgent thing to say; the rest stay pending and get their own card next launch.
  const direction = pending.some((grant) => grant.direction === 'enabled') ? 'enabled' : 'disabled'
  const covered = pending.filter((grant) => grant.direction === direction)
  // A name only belongs on the card when it names everything the card covers.
  const description = covered.length === 1 ? covered[0]!.description : null
  return { args: covered.map((grant) => grant.arg), direction, description }
}

/**
 * Queue a notice for any grant this launch turned on for the first time.
 *
 * Called from the launch path, so it must never throw: a settings read that fails costs the
 * user a heads-up, which is strictly better than costing them the launch.
 */
export function armBetaActivationNotice(
  installationId: string,
  applied: readonly CoreBetaGrant[]
): void {
  try {
    // Replace, never append. Arming happens before the spawn is known to have succeeded, so a
    // claim can be left behind by a launch that then failed to boot. The next launch of this
    // install is the authority on what is actually on its command line: relaunching with beta
    // turned off must clear the old claim, not inherit it and then announce a feature that is
    // no longer on.
    pendingByInstallation.delete(installationId)
    if (applied.length === 0) return
    // Queues are per-install and independent. The persisted announced list is the only thing
    // that silences an arg, and it is what "once" actually means: it survives restarts, which
    // no in-memory cross-install bookkeeping can. See the note on `readAnnouncedBetaArgs`.
    const spokenFor = new Set(readAnnouncedBetaArgs())
    const fresh = selectNewlyActiveBetaGrants(applied, spokenFor)
    if (fresh.length === 0) return
    pendingByInstallation.set(installationId, fresh)
  } catch (err) {
    console.log('[beta-notice] arm failed:', err)
  }
}

/** Drop this install's claim without announcing anything.
 *
 *  Arming happens just before the spawn, so a launch that then fails leaves a claim for a
 *  Core that never started: the title bar would announce "a beta feature is on" once the
 *  progress takeover closes. `armBetaActivationNotice` already clears the entry on the NEXT
 *  launch of this install, which repairs the state eventually. This closes the window in
 *  between, where the claim is live and wrong: the failed launch's own progress takeover ends
 *  long before any relaunch.
 *
 *  Nothing is persisted here, so this only discards an unannounced claim; an arg already
 *  written to the announced list stays announced. */
export function clearBetaActivationClaim(installationId: string): void {
  try {
    pendingByInstallation.delete(installationId)
  } catch (err) {
    console.log('[beta-notice] clear failed:', err)
  }
}

/** The card this install's title bar should raise, or `null`. Read-only: the pending entry
 *  survives until `acknowledgeBetaActivationNotice`, so a card that is shown but never retired
 *  (window closed, app quit) comes back on the next launch.
 *
 *  Announced args are filtered HERE, not only at arm time. Queues are per-install, so another
 *  install acknowledging an arg persists it but clears only its own queue — a copy already
 *  queued elsewhere would otherwise still be served, and that install would raise a card for
 *  something the user has just dismissed. "Acknowledged anywhere, silent everywhere" has to
 *  hold for cards already queued, not merely for launches that come afterwards.
 *
 *  Filtered rather than dropped: an install queued for two grants keeps the one still unseen
 *  when only the other has been announced — and the wording layer resolves from what is left,
 *  so a card that survives the filter is worded for the grants it actually represents. */
export function peekBetaActivationNotice(installationId: string): BetaActivationNotice | null {
  const queued = pendingByInstallation.get(installationId) ?? []
  if (queued.length === 0) return null
  const announced = new Set(readAnnouncedBetaArgs())
  return resolveBetaActivationNotice(queued.filter((grant) => !announced.has(grant.arg)))
}

/**
 * Retire this install's notice: persist its args as announced and drop the pending entry.
 *
 * Called when the user dismisses the card or follows its settings link — acting on it is
 * acknowledging it. Merged into the stored list rather than replacing it, so two installs
 * retiring different notices cannot clobber each other.
 */
export function acknowledgeBetaActivationNotice(
  installationId: string,
  shownArgs?: readonly string[]
): void {
  const queued = pendingByInstallation.get(installationId)
  if (!queued || queued.length === 0) return
  // Retire exactly what the card DISPLAYED. Two things make that different from "the queue":
  // a card covers only one direction, so a mixed launch deliberately leaves the rest pending;
  // and a relaunch can re-arm between show and retire while the sticky card floats. Either
  // way, acknowledging more than was shown persists a grant the user never saw, which the
  // append-only list then makes unannounceable forever. Falls back to resolving the queue only
  // when the renderer named nothing.
  const shown = shownArgs?.length ? shownArgs : resolveBetaActivationNotice(queued)?.args
  if (!shown || shown.length === 0) return
  const coveredSet = new Set(shown)
  const covered = queued.filter((grant) => coveredSet.has(grant.arg)).map((grant) => grant.arg)
  if (covered.length === 0) return
  try {
    const merged = [...new Set([...readAnnouncedBetaArgs(), ...covered])]
    settings.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, merged)
    // Only drop from the queue once the value is actually readable back. `settings.set` can
    // decline to persist (it refuses while settings.json is unreadable) without throwing, so
    // a bare call is not evidence the write landed — and dropping it then would lose the card
    // for this session while leaving nothing on disk.
    const persisted = new Set(readAnnouncedBetaArgs())
    if (!covered.every((arg) => persisted.has(arg))) return
    // The queue holds grant objects here, not bare args.
    const remaining = queued.filter((grant) => !coveredSet.has(grant.arg))
    if (remaining.length > 0) pendingByInstallation.set(installationId, remaining)
    else pendingByInstallation.delete(installationId)
  } catch (err) {
    // A failed write costs the user a repeat card on the next launch and nothing else.
    console.log('[beta-notice] acknowledge failed:', err)
  }
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  pendingByInstallation.clear()
}
