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
    // no longer on.
    pendingByInstallation.delete(installationId)
    if (appliedArgs.length === 0) return
    // Queues are per-install and independent. The persisted announced list is the only thing
    // that silences an arg, and it is what "once" actually means: it survives restarts, which
    // no in-memory cross-install bookkeeping can. See the note on `readAnnouncedBetaArgs`.
    const spokenFor = new Set(readAnnouncedBetaArgs())
    const fresh = selectNewlyActiveBetaArgs(appliedArgs, spokenFor)
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

/** What this install's title bar should announce, or `[]`. Read-only: the pending entry
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
 *  when only the other has been announced. */
export function peekBetaActivationNotice(installationId: string): string[] {
  const queued = pendingByInstallation.get(installationId) ?? []
  if (queued.length === 0) return []
  const announced = new Set(readAnnouncedBetaArgs())
  return queued.filter((arg) => !announced.has(arg))
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
  // Retire exactly what the card DISPLAYED. Re-deriving from the queue at retire time would
  // acknowledge whatever is pending now, and a relaunch can re-arm between show and retire
  // while the sticky card floats — persisting a grant set the user was never shown, which the
  // append-only list then makes unannounceable forever. Falls back to the queue only when no
  // args were supplied (an older renderer), which is the pre-existing behaviour.
  const covered =
    shownArgs && shownArgs.length > 0 ? queued.filter((a) => shownArgs.includes(a)) : queued
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
    const remaining = queued.filter((a) => !covered.includes(a))
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
