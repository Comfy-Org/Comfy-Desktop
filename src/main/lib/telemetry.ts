/**
 * Main-process telemetry — single capture point for the launcher.
 *
 * =========================================================================
 * REFERENCE FOR ANYONE ADDING NEW TELEMETRY
 * =========================================================================
 *
 * ## Architecture (one paragraph)
 *
 * `posthog-node` runs here in main. Renderer events flow over IPC
 * (`window.api.captureTelemetry` / `captureExceptionTelemetry` /
 * `registerTelemetryProperties` / `telemetryGetExperimentFlag` /
 * `telemetryRecordExposure`, plus trusted Cloud's declarative
 * `__comfyDesktop2.Telemetry.reportFirebaseAuthState`) to handlers in
 * `ipc/registerTelemetryHandlers.ts`.
 * Datadog RUM still runs in the renderer (browser-only) but is gated to a
 * small failure-event allow-list in `src/shared/datadogMirroredEvents.ts`.
 *
 * ## Adding a product event — checklist
 *
 *   1. Pick a name. Convention: `comfy.desktop.<area>.<verb>` snake_case
 *      (e.g. `comfy.desktop.instance.switched`). Add to whichever code path
 *      naturally owns the event.
 *   2. Use `capture(event, properties)` in main, or
 *      `emitTelemetryAction(event, props)` in a Vue component. Never call
 *      `posthog.capture` directly.
 *   3. Bucket / enumerate user values at the call site. Free-form strings
 *      get scrubbed by `scrubAll()` as a safety net, but the discipline is
 *      to send `directory_bucket: 'checkpoints'` not raw `directory: '/Users/x/foo'`.
 *      Use helpers in `src/renderer/src/lib/telemetry.ts` (`toSizeBucket`,
 *      `toCountBucket`, `toErrorBucket`, `toModelDirectoryBucket`,
 *      `deriveGpuTier`, etc.) — extend them instead of inlining new bucketing.
 *   4. If the event is a *failure* (`*.error`, crash, install failure, etc.),
 *      add the event name to `DATADOG_MIRRORED_EVENT_NAMES` so it also
 *      reaches Datadog and a monitor can fire on it.
 *   5. Add an insight to the relevant PostHog dashboard. Don't ship events
 *      that don't end up on a dashboard or in a saved query — that's how
 *      telemetry rots into noise.
 *
 * ## Identity model
 *
 *   - anonymous distinct id = website PostHog `$device_id` (`W`) on an
 *     attributed fresh Windows install, otherwise a random Desktop ID (`D`).
 *     It is persisted separately from installation metadata. Every pre-auth
 *     write uses W/D and forces `$process_person_profile: false`.
 *   - `installation_id` = `SHA-256(machine_id + salt)`, from `deviceId.ts`.
 *     It is only an event/person property; it is never a PostHog identity.
 *     Caveat: many call sites still override this key per-call with the
 *     per-install record id (`inst-<ms>`, `installations.ts`), so the value
 *     is not yet uniformly machine-scoped; #1159 redirects those overrides
 *     to `install_id`.
 *   - Firebase UID (`F`) is set only after every live hosted Cloud view reports
 *     the same resolved user. This is the only `client.identify()` call and
 *     carries W/D as `$anon_distinct_id`, merging the anonymous history without
 *     an alias event. Before that write, a fresh D is persisted for logout,
 *     account switch, or the next startup.
 *
 * ## Consent (three-state)
 *
 *   - `'granted'`   — collect everything.
 *   - `'denied'`    — collect nothing.
 *   - `'undecided'` — fresh install or Desktop-1 migrator; collect ONLY
 *                     `comfy.desktop.first_use.consent_decision` until the
 *                     user makes a choice.
 *
 *   Every capture path here is consent-gated. `setConsentState(state)` is
 *   the single source of truth; `setConsent(bool)` is a legacy adapter.
 *
 * ## Provider split
 *
 *   PostHog gets everything. Datadog only mirrors the failure / reliability
 *   allow-list in `src/shared/datadogMirroredEvents.ts`. Datadog is for
 *   alerting, not analysis — adding a name to the allow-list is a
 *   deliberate ops decision ("I want a monitor on this"). PostHog
 *   dashboards + ad-hoc HogQL are the source of truth for everything else.
 *
 * ## A/B experiments
 *
 *   `experiments.ts` owns the flag cache. Read with `getFlag(key)` in main
 *   or `window.api.telemetryGetExperimentFlag(key)` from the renderer
 *   (cache-first; first-ever boot fails closed to control). Record
 *   exposure with `recordExposure(key, variant, source)` or its IPC
 *   equivalent — per-session dedup is enforced main-side. Outcome events
 *   are normal product events; PostHog joins them to the exposure at query
 *   time via the standard experiment view.
 *
 * ## What NOT to do
 *
 *   - Don't ship raw file paths, prompts, model filenames, user-typed
 *     strings. Bucket or hash them first.
 *   - Don't call `posthog.reset()` on logout.
 *   - Don't add events that nobody is going to look at in PostHog. Add
 *     them to a dashboard or skip them.
 *   - Don't bypass `bucketError`; if you need a new error category, extend
 *     `src/shared/errorBucket.ts` so main and renderer classify the same way.
 *   - Don't fire events synchronously inside hot loops (e.g. every render
 *     of a Vue list). Throttle / dedup at the call site.
 *
 * =========================================================================
 *
 * NOTE: There is intentionally no remote kill-switch / sample-rate system
 * (that grab-bag was deliberately removed). `experiments.ts` brought back
 * the flag-evaluation subset only, for A/B testing. Don't recreate the
 * kill-switch without a concrete need.
 */
import { app } from 'electron'
import { PostHog } from 'posthog-node'

// PostHog's `FeatureFlagValue` lives in `@posthog/core` and is not
// re-exported by `posthog-node`. Inlining the shape we actually use.
export type FeatureFlagValue = string | boolean
import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  isPostHogFlagDisabled as isFlagDisabled
} from '../../shared/posthogConfig'
import { isDatadogMirroredEvent } from '../../shared/datadogMirroredEvents'
import { bucketError as sharedBucketError } from '../../shared/errorBucket'
import { buildErrorFields } from '../../shared/errorEvent'
import { scrubAll } from '../../shared/piiScrub'
import {
  clearPersistedUnmergeableAnonymousEpoch,
  hasPersistedUnmergeableAnonymousEpoch,
  persistUnmergeableAnonymousEpoch,
  rotatePersistedAnonymousDistinctId
} from './anonymousIdentity'
import { isIllegalPostHogDistinctId, normalizeOpaqueIdentifier } from './opaqueIdentifier'

export type TelemetryValue = boolean | number | string | null | undefined
export type TelemetryContext = Record<string, TelemetryValue | TelemetryValue[]>

/**
 * Long-lived renderer WebContents that receive main-emitted telemetry events
 * for fan-out to renderer-side Datadog RUM. Registered exactly once per host
 * window — the title-bar WebContents, which is built unconditionally for
 * every host window in `createHostWindow()` and survives mode flips, so
 * Datadog RUM gets a session per host window regardless of whether the
 * panelView is currently mounted.
 *
 * The panelView is intentionally NOT registered here because (a) it may not
 * exist in steady-state `comfy` mode and (b) when it does exist we don't
 * want events to fire twice on Datadog. PostHog Node already captures these
 * events directly in main, so the relay payload sets `mainAlreadyCaptured:
 * true` to suppress renderer-side PostHog re-capture.
 *
 * Kept here (rather than in `lib/ipc/shared.ts`) so this module stays
 * lightweight and unit-testable without dragging in shared.ts's heavy
 * dependency graph.
 */
const _telemetryRelayTargets = new Set<Electron.WebContents>()

export function registerTelemetryRelayTarget(wc: Electron.WebContents): void {
  _telemetryRelayTargets.add(wc)
  wc.once('destroyed', () => _telemetryRelayTargets.delete(wc))
}

export function unregisterTelemetryRelayTarget(wc: Electron.WebContents): void {
  _telemetryRelayTargets.delete(wc)
}

/** @internal — exposed for tests. */
export function _resetTelemetryRelayTargets(): void {
  _telemetryRelayTargets.clear()
}

/**
 * @internal — exposed for tests. Resets module-level identity / consent /
 * pending state so consecutive test suites don't share state. Does not
 * close an in-flight PostHog client — tests bring their own mocked one.
 */
export function _resetForTest(): void {
  client = null
  distinctId = null
  anonymousDistinctId = null
  nextAnonymousDistinctId = null
  boundUserId = null
  installationIdProperty = null
  consentState = 'undecided'
  pendingSessionStart = null
  pendingFirstLaunch = null
  pendingPersonSet = null
  pendingPersonSetOnce = null
  pendingUserBinding = null
  defaultEventProperties = {}
  initialized = false
  drainingForQuit = false
}

/** @internal — exposed for tests. */
export function _telemetryRelayTargetCount(): number {
  return _telemetryRelayTargets.size
}

interface PostHogConfig {
  apiKey: string
  host: string
  enabled: boolean
}

function readPostHogConfig(): PostHogConfig {
  const apiKey = (process.env['POSTHOG_API_KEY'] || DEFAULT_POSTHOG_API_KEY).trim()
  const host = (process.env['POSTHOG_HOST'] || DEFAULT_POSTHOG_HOST).trim()
  const enabled = !isFlagDisabled(process.env['POSTHOG_ENABLED']) && apiKey.length > 0
  return { apiKey, host, enabled }
}

let client: PostHog | null = null
let distinctId: string | null = null
let bootstrapTimeMs: number = Date.now()
let initialized = false
/** When `true`, all PostHog write paths (capture, identify,
 *  captureException, person-property updates) short-circuit. Set in
 *  `initTelemetry` based on `isPackaged`. Read paths (`getOpsFlag`,
 *  `loadFeatureFlagsImmediate`, `shutdown`) deliberately ignore this
 *  so devs can still resolve feature flags in `pnpm dev`. */
let suppressEmit = false

/** Short-circuit guard for all PostHog emission paths. Centralized so
 *  the dev-mode suppression and a missing client are checked
 *  identically across every callsite. */
function canEmit(): boolean {
  return !suppressEmit && client !== null
}

/**
 * Default properties merged into every `capture()` payload. Seeded at
 * `initTelemetry()` time from `InitOptions` with `app_version`,
 * `app_channel`, `app_env`, `platform`, `arch`, `is_packaged`, and
 * `client` so
 * per-event filters / breakdowns work without a join against the person
 * profile (PostHog person properties are joined at query time and are
 * point-in-time as of write — releasing a new app version while the user
 * still has events from the old one would mis-attribute without this).
 * `installation_id` is added by `bindAnonymousId()` once installation metadata is known
 * at boot, so renderer events (routed in over IPC) and main events share the
 * machine hash as the default join key. Call sites that override it per-call
 * with a per-install record id still split that key — #1159 moves those
 * overrides to `install_id`.
 *
 * Per-call properties take precedence on key collision.
 */
let defaultEventProperties: Record<string, TelemetryValue> = {}

/**
 * The `deployment` analytics axis: which backend ran the work. Paired with
 * the `client` default event property (desktop | web | cli) to identify the
 * product surface (MAR-51). Shared by every site that tags `deployment` so
 * the enum can't drift.
 */
export type Deployment = 'local' | 'cloud' | 'remote'

/** Narrow an untrusted value (payload property, source-plugin category) to a
 *  valid `Deployment`, or `null` — never let junk reach the shared axis. */
export function asDeployment(value: unknown): Deployment | null {
  return value === 'local' || value === 'cloud' || value === 'remote' ? value : null
}

/**
 * Coarse release-channel classification derived from a semver-ish
 * `appVersion`. `-beta` / `-canary` / `-alpha` markers map to their
 * channel; a missing suffix is `stable`; an unrecognised suffix is
 * `unknown` (kept coarse so future `-rc` / `-dev` builds fall into
 * `unknown` rather than silently being misclassified). Mirrors the
 * renderer's `deriveAppChannel` so both surfaces agree.
 */
function deriveAppChannel(appVersion: string): string {
  if (!appVersion) return 'unknown'
  const v = appVersion.toLowerCase()
  if (v.includes('-beta')) return 'beta'
  if (v.includes('-canary')) return 'canary'
  if (v.includes('-alpha')) return 'alpha'
  if (/[a-z]/.test(v.split('+')[0]?.split('-').slice(1).join('-') || '')) return 'unknown'
  return 'stable'
}

/**
 * Three-state consent.
 *
 * - `'granted'` — user opted in. Everything ships.
 * - `'denied'` — user opted out. Nothing ships, EXCEPT the
 *   `PRE_CONSENT_ALLOWED_EVENTS` set — see the next paragraph for why.
 * - `'undecided'` — user has not chosen yet (fresh install OR a Desktop-1
 *   migrator whose `telemetryEnabled` setting was never set).
 *   Only events in `PRE_CONSENT_ALLOWED_EVENTS` ship; everything
 *   else is suppressed until the user makes a choice. Mirrors
 *   the renderer's pre-consent gate in `rendererBootstrap.ts`.
 *
 * **Why `PRE_CONSENT_ALLOWED_EVENTS` survive `'denied'`**: the consent
 * decision event itself races the state flip. The renderer's "Continue"
 * handler in `FirstUseTakeover.vue` awaits the telemetryEnabled setting
 * write (which propagates to `setConsentState('denied')` here) and only
 * then calls `emitTelemetryAction('first_use.consent_decision', { decision: 'decline' })`.
 * If `isAllowedToFire` short-circuited on `'denied'` without consulting the
 * allow-list, every decline would be dropped — meaning we'd have 100%
 * accept-rate signal and zero ability to measure decline. The allow-list
 * is intentionally the FIRST check so the decision event survives the
 * exact state it triggers.
 *
 * Default at module load is `'undecided'`: if `setConsentState` is never
 * called (test paths, mis-wired boot), we fail closed for everything that
 * isn't in the allow-list.
 */
export type ConsentState = 'granted' | 'denied' | 'undecided'

let consentState: ConsentState = 'undecided'

const PRE_CONSENT_ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'comfy.desktop.first_use.consent_decision'
])

function isAllowedToFire(event: string): boolean {
  // Allow-list takes precedence over every state, including 'denied'.
  // See the ConsentState docstring above for the full reasoning — short
  // version: the consent decision event races the 'denied' state flip
  // and would otherwise be dropped by its own decision.
  if (PRE_CONSENT_ALLOWED_EVENTS.has(event)) return true
  if (consentState === 'granted') return true
  return false
}

/**
 * SDK-level volume safety net — two layers, both belt-and-braces around
 * the per-call-site dedup guards that individual emit paths add.
 *
 * Motivation: the 2026-06-02 volume incident shipped 3M+ events of the
 * same four `comfy.desktop.app_update.*` names in 24h before anyone noticed.
 * The per-call fix in `updater.ts` prevents *that specific* loop, but
 * any future emit-in-a-tight-loop bug (a Vue watcher that fires on
 * every render, an IPC handler called every animation frame, a
 * setInterval misconfigured to 100ms instead of 10min) would do the
 * same damage. These two limits make the WORST case bounded even when
 * the call site is buggy.
 *
 * Layer 1: per-event-name sliding window.
 *   Drop further emits of the same event name once 60 fire in 60s.
 *   60/min is well above any legitimate product event rate (the
 *   loudest healthy event was `execution.completed` at ~36/user/day)
 *   and well below any loop signature (the incident was ~2/sec).
 *   One `comfy.desktop.telemetry.rate_limited` warning fires per (event ×
 *   process) so dashboards surface that it happened.
 *
 * Layer 2: per-process total cap.
 *   After 5000 events captured this process, every further capture
 *   no-ops. 5000 covers a heavy multi-hour workflow user (~500–1000
 *   events) with 5–10x headroom, and turns "millions of events" into
 *   "at most 5000" for any single runaway install. One
 *   `comfy.desktop.telemetry.session_cap_hit` warning fires once when the
 *   cap is crossed.
 *
 * `*.error` events bypass Layer 1 — error volume is exactly the signal
 * we need most during incidents, and `*.error` events are not the
 * shape of any loop we've seen. Layer 2 still applies (a runaway
 * error loop would still hit the cap).
 */
const RATE_LIMIT_COUNT = 60
const RATE_LIMIT_WINDOW_MS = 60_000
const SESSION_EVENT_CAP = 5_000
const _rateLimitStamps: Map<string, number[]> = new Map()
const _rateLimitWarned: Set<string> = new Set()
let _eventsCapturedThisProcess = 0
let _sessionCapWarned = false

function _bypassRateLimit(event: string): boolean {
  // Failure events are reliability signal we never want to silently
  // throttle. Telemetry-self events bypass to avoid recursion when
  // we emit the warning events below.
  return event.endsWith('.error') || event.startsWith('comfy.desktop.telemetry.')
}

function enforcePersonProcessingPolicy(properties: TelemetryContext): TelemetryContext {
  if (boundUserId) return properties
  // Force this after all caller/default merges so no anonymous callsite can
  // accidentally opt back into person-profile creation.
  return { ...properties, $process_person_profile: false }
}

function _emitWarning(event: string, properties: TelemetryContext): void {
  if (!canEmit() || !distinctId) return
  try {
    client!.capture({
      distinctId,
      event,
      properties: enforcePersonProcessingPolicy({ ...defaultEventProperties, ...properties })
    })
  } catch {
    // ignore – the warning is best-effort
  }
}

function _checkRateLimit(event: string): boolean {
  if (_eventsCapturedThisProcess >= SESSION_EVENT_CAP) {
    if (!_sessionCapWarned) {
      _sessionCapWarned = true
      _emitWarning('comfy.desktop.telemetry.session_cap_hit', {
        cap: SESSION_EVENT_CAP,
        last_event: event
      })
    }
    return false
  }
  if (_bypassRateLimit(event)) return true
  const now = Date.now()
  let stamps = _rateLimitStamps.get(event)
  if (!stamps) {
    stamps = []
    _rateLimitStamps.set(event, stamps)
  }
  while (stamps.length > 0 && stamps[0]! < now - RATE_LIMIT_WINDOW_MS) {
    stamps.shift()
  }
  if (stamps.length >= RATE_LIMIT_COUNT) {
    if (!_rateLimitWarned.has(event)) {
      _rateLimitWarned.add(event)
      _emitWarning('comfy.desktop.telemetry.rate_limited', {
        event_name: event,
        limit: RATE_LIMIT_COUNT,
        window_ms: RATE_LIMIT_WINDOW_MS
      })
    }
    return false
  }
  stamps.push(now)
  return true
}

/**
 * Test-only: reset the SDK rate-limit + session-cap state so each test
 * starts from a clean slate. Not exported via index.ts; reached by
 * tests via direct module import.
 */
export function _test_resetVolumeGuards(): void {
  _rateLimitStamps.clear()
  _rateLimitWarned.clear()
  _eventsCapturedThisProcess = 0
  _sessionCapWarned = false
}

/**
 * Set the current consent state. Deferred product events may fire on grant;
 * pre-auth person properties remain queued until Firebase UID is bound.
 */
export function setConsentState(state: ConsentState): void {
  const previous = consentState
  consentState = state
  if (state !== 'granted') {
    // Best-effort flush so already-queued events still go out before we
    // start suppressing.
    void client?.flush().catch(() => {})
    return
  }
  // Transitioned to granted. Ship anything we held back.
  if (previous !== 'granted') {
    tryFlushDeferred()
  }
}

/**
 * Legacy two-state adapter. Existing callers can keep using `setConsent(bool)`
 * during the Phase-1 transition; new code calls `setConsentState` directly.
 * Note: this maps `false → 'denied'` (NOT `'undecided'`). Pass `'undecided'`
 * explicitly via `setConsentState` for the first-use case.
 */
export function setConsent(enabled: boolean): void {
  setConsentState(enabled ? 'granted' : 'denied')
}

export function isInitialized(): boolean {
  return initialized && client !== null
}

export interface InitOptions {
  appVersion: string
  appEnv: string
  isPackaged: boolean
}

/**
 * Initialize PostHog Node. Safe to call before consent decision is known —
 * events are queued by setConsent(false) and dropped at capture time.
 *
 * Note: the session-start event is intentionally NOT emitted here — D is
 * unknown until `bindAnonymousId()` runs, which flushes it under that D.
 */
export function initTelemetry(opts: InitOptions): void {
  if (initialized) return
  initialized = true
  bootstrapTimeMs = Date.now()

  // Set the per-event defaults BEFORE the early-return so disabled
  // telemetry still gets a coherent snapshot (useful when tests stub
  // the client out but still inspect `defaultEventProperties`).
  defaultEventProperties = {
    app_version: opts.appVersion,
    app_channel: deriveAppChannel(opts.appVersion),
    app_env: opts.appEnv,
    is_packaged: opts.isPackaged,
    platform: process.platform,
    arch: process.arch,
    // Cross-surface analytics axis (MAR-51); this pipe is always the desktop
    // app. `deployment` (see the `Deployment` type) is its per-event pair.
    client: 'desktop'
  }

  // Suppress event capture on unpackaged (developer / `pnpm dev`) runs.
  // Two reasons: (a) every hot-reload + every dev-tool action would
  // otherwise pollute the same production project we read for product
  // analytics, (b) dev-mode app-update behavior tends to produce
  // pathological event shapes (e.g. the updater repeatedly
  // "discovering" the staged build). Beta / canary / stable channels
  // still emit normally — only the unpackaged local-source case is
  // gated.
  //
  // FLAG READS are NOT suppressed: a dev working on a feature gated by
  // a PostHog flag (e.g. `desktop-cloud-capacity`) needs to actually
  // see the flag's resolved value at boot. Previously the entire
  // PostHog client was skipped in dev, which made `getOpsFlag` /
  // `loadFeatureFlagsImmediate` return defaults and stranded any
  // capacity-protection or experiment testing. Now the client is
  // always created so reads work; only the emission paths
  // (`capture`, `identify`, `captureException`,
  // `registerPersonProperties`) bail when `suppressEmit` is set.
  suppressEmit = !opts.isPackaged

  const cfg = readPostHogConfig()
  if (!cfg.enabled) return

  try {
    client = new PostHog(cfg.apiKey, {
      host: cfg.host,
      flushAt: 20,
      flushInterval: 10_000,
      // GeoIP: posthog-node runs in the desktop main process ON the user's
      // machine, so the request IP is the real user IP and PostHog can derive
      // the user's location. We opt IN to country-level cohorts (the IP is no
      // longer stripped in `capture`). Precision is bounded to COUNTRY by a
      // PostHog ingestion transformation that drops the raw `$ip` plus the
      // sub-country geo props (`$geoip_city_name`, `$geoip_subdivision_*`,
      // `$geoip_latitude` / `_longitude`, `$geoip_postal_code`) and keeps only
      // `$geoip_country_code` / `$geoip_country_name`. Net: country distribution,
      // no stored IP, no city/coordinate "where are they now" tracking.
      disableGeoip: false
    })
  } catch {
    client = null
  }

  // Stash session-start parameters until the anonymous D is bound.
  // The session-start payload duplicates the defaults so an event-only
  // reader (no defaults yet) still sees them on the first event.
  pendingSessionStart = {
    app_env: opts.appEnv,
    app_version: opts.appVersion,
    is_packaged: opts.isPackaged
  }
}

let pendingSessionStart: Record<string, TelemetryValue> | null = null
/**
 * Deferred once-ever first-launch event payload. The guard file in
 * `deviceId.ts` is consumed at boot (so it can never re-fire on a later
 * launch), but on a fresh install consent is still `'undecided'` at that
 * moment — the event would be dropped by `isAllowedToFire` and the guard
 * would be burned for nothing. Holding the payload here lets it ship on the
 * `undecided → granted` transition via `tryFlushDeferred()`, exactly like
 * `pendingSessionStart`. A `'denied'` choice never flushes it, which is the
 * intended consent outcome.
 */
let pendingFirstLaunch: TelemetryContext | null = null
/** Person props collected before login and applied to Firebase UID at bind. */
let pendingPersonSet: Record<string, TelemetryValue> | null = null
/** Same, for write-once (`$set_once`) markers. */
let pendingPersonSetOnce: Record<string, TelemetryValue> | null = null

let pendingUserBinding: string | null = null

/**
 * `anonymousDistinctId` is the active W/D for the current anonymous period.
 * Once it is merged into Firebase UID, `nextAnonymousDistinctId` is the fresh
 * Desktop D reserved before the identify write.
 */
let anonymousDistinctId: string | null = null
let nextAnonymousDistinctId: string | null = null
let boundUserId: string | null = null
let installationIdProperty: string | null = null

/**
 * Ship deferred one-shot state. Each buffer is cleared only when its capture
 * was actually admitted — a silent drop (SDK throw, volume guard) keeps the
 * payload queued for the next flush trigger instead of losing it forever.
 */
function tryFlushDeferred(): void {
  if (!canEmit() || !distinctId) return
  if (consentState !== 'granted') return
  if (boundUserId && (pendingPersonSet || pendingPersonSetOnce)) {
    if (capturePersonProperties(pendingPersonSet, pendingPersonSetOnce)) {
      pendingPersonSet = null
      pendingPersonSetOnce = null
    }
  }
  if (pendingSessionStart && capture('comfy.desktop.session.started', pendingSessionStart)) {
    pendingSessionStart = null
  }
  if (pendingFirstLaunch && capture('comfy.desktop.app.first_launch', pendingFirstLaunch)) {
    pendingFirstLaunch = null
  }
  if (pendingUserBinding) {
    const userId = pendingUserBinding
    pendingUserBinding = null
    applyFirebaseUserConsensus(userId)
  }
}

/** Bind W/D for captures and a separate installation property. No SDK identify. */
export function bindAnonymousId(
  anonymousId: string,
  installationId: string,
  properties: Record<string, TelemetryValue> = {}
): void {
  distinctId = anonymousId
  anonymousDistinctId = anonymousId
  nextAnonymousDistinctId = null
  boundUserId = null
  installationIdProperty = installationId
  defaultEventProperties = { ...defaultEventProperties, installation_id: installationId }
  if (Object.keys(properties).length > 0) {
    pendingPersonSet = {
      ...(pendingPersonSet || {}),
      installation_id: installationId,
      ...properties
    }
  }
  if (!canEmit()) return
  tryFlushDeferred()
}

/**
 * Bind Firebase UID F with the active anonymous W/D as `$anon_distinct_id`.
 * A fresh D is persisted before identify so logout, account switch, and the
 * next process can never reuse an id that may have been merged into F.
 */
export function applyFirebaseUserConsensus(userId: string): void {
  const normalizedUserId = normalizeOpaqueIdentifier(userId, 256)
  // Reject early rather than burn an anonymous rotation on an identify that
  // can never merge.
  if (!normalizedUserId || isIllegalPostHogDistinctId(normalizedUserId)) return

  if (!canEmit() || !anonymousDistinctId || !installationIdProperty) {
    pendingUserBinding = normalizedUserId
    return
  }
  if (boundUserId === normalizedUserId) {
    return
  }
  if (boundUserId) {
    // These buffers may contain updates collected for the current account
    // while consent was not granted. Never carry them into another Firebase
    // person; properties collected before the first login remain intact.
    pendingPersonSet = null
    pendingPersonSetOnce = null
  }
  if (consentState !== 'granted') {
    if (boundUserId) {
      const safeAnonymousId = nextAnonymousDistinctId
      boundUserId = null
      nextAnonymousDistinctId = null
      if (!safeAnonymousId) {
        distinctId = null
        anonymousDistinctId = null
        return
      }
      anonymousDistinctId = safeAnonymousId
      distinctId = safeAnonymousId
    }
    pendingUserBinding = normalizedUserId
    return
  }

  if (boundUserId) {
    capturePersonProperties({ is_authenticated: false }, null)
    const safeAnonymousId = nextAnonymousDistinctId
    boundUserId = null
    nextAnonymousDistinctId = null
    if (!safeAnonymousId) {
      distinctId = null
      anonymousDistinctId = null
      return
    }
    anonymousDistinctId = safeAnonymousId
    distinctId = safeAnonymousId
  }

  const anonymousId = anonymousDistinctId
  const reservedNextAnonymousId = rotatePersistedAnonymousDistinctId()
  if (!reservedNextAnonymousId) {
    pendingUserBinding = normalizedUserId
    return
  }

  const personSet = scrubProperties({
    ...(pendingPersonSet || {}),
    installation_id: installationIdProperty,
    is_authenticated: true
  })
  const personSetOnce = pendingPersonSetOnce
    ? scrubProperties(pendingPersonSetOnce as TelemetryContext)
    : null
  distinctId = normalizedUserId
  try {
    client!.identify({
      distinctId: normalizedUserId,
      properties: {
        $set: personSet,
        ...(personSetOnce ? { $set_once: personSetOnce } : {}),
        $anon_distinct_id: anonymousId
      }
    })
  } catch {
    // Conservatively abandon D if the SDK may have partially accepted it.
    anonymousDistinctId = reservedNextAnonymousId
    nextAnonymousDistinctId = null
    distinctId = reservedNextAnonymousId
    pendingUserBinding = normalizedUserId
    return
  }
  boundUserId = normalizedUserId
  nextAnonymousDistinctId = reservedNextAnonymousId
  pendingPersonSet = null
  pendingPersonSetOnce = null
  pendingUserBinding = null
  capture('app:user_logged_in', { user_id: normalizedUserId })
}

/**
 * Bind a main-process-verified interactive sign-in (OAuth loopback bridge or
 * desktop login code). Hosted bundles without the consensus bridge never
 * report auth state, so this is the only bind path for them; when consensus
 * does arrive it supersedes this call, and same-UID rebinds are no-ops.
 */
export function bindUserId(userId: string, properties: Record<string, TelemetryValue> = {}): void {
  applyFirebaseUserConsensus(userId)
  if (Object.keys(properties).length === 0) return
  registerPersonProperties(properties)
}

/**
 * Detach from F and adopt the fresh D that was durably reserved before bind.
 */
export function applyFirebaseAnonymousConsensus(): void {
  pendingUserBinding = null
  pendingPersonSet = null
  pendingPersonSetOnce = null
  if (!boundUserId) return
  if (canEmit() && consentState === 'granted') {
    capturePersonProperties({ is_authenticated: false }, null)
  }
  const safeAnonymousId = nextAnonymousDistinctId ?? rotatePersistedAnonymousDistinctId()
  boundUserId = null
  nextAnonymousDistinctId = null
  if (!safeAnonymousId) {
    distinctId = null
    anonymousDistinctId = null
    return
  }
  anonymousDistinctId = safeAnonymousId
  distinctId = safeAnonymousId
}

/**
 * Replace an anonymous epoch that observed conflicting resolved auth states.
 * Returns false when the clean identity could not be persisted; callers must
 * keep the process anonymous and retry before any later Firebase bind.
 */
export function discardUnmergeableAnonymousEpoch(): boolean {
  applyFirebaseAnonymousConsensus()
  const cleanAnonymousId = rotatePersistedAnonymousDistinctId()
  if (!cleanAnonymousId) return false
  anonymousDistinctId = cleanAnonymousId
  distinctId = cleanAnonymousId
  nextAnonymousDistinctId = null
  return clearPersistedUnmergeableAnonymousEpoch()
}

export function hasUnmergeableAnonymousEpoch(): boolean {
  return hasPersistedUnmergeableAnonymousEpoch()
}

export function markAnonymousEpochUnmergeable(): boolean {
  return persistUnmergeableAnonymousEpoch()
}

/** @deprecated Declarative auth consensus owns signed-out transitions. */
export function unbindUserId(): void {
  // Compatibility surface only; consensus is required for a real unbind.
}

/**
 * Defense-in-depth: run every string-valued property through `scrubAll`
 * before it leaves the process. Callers should still scrub at the emit
 * site (so the field shape is intentional and the scrub is visible in
 * code review) — this is the last-resort safety net that catches future
 * emit sites that forget. Mirrors the renderer's `scrubTelemetryContext`
 * pass; without it, any new main-process call site that ships raw
 * strings (`error_message`, `last_stderr`, free-text from external libs)
 * is one regression away from leaking a user path.
 */
function scrubProperties(properties: TelemetryContext): TelemetryContext {
  let mutated: TelemetryContext | null = null
  for (const key of Object.keys(properties)) {
    const value = properties[key]
    if (typeof value === 'string') {
      const cleaned = scrubAll(value)
      if (cleaned === value) continue
      if (!mutated) mutated = { ...properties }
      mutated[key] = cleaned
    } else if (Array.isArray(value)) {
      const cleaned = value.map((entry) => (typeof entry === 'string' ? scrubAll(entry) : entry))
      if (cleaned.every((entry, index) => entry === value[index])) continue
      if (!mutated) mutated = { ...properties }
      mutated[key] = cleaned
    }
  }
  return mutated ?? properties
}

/**
 * Update the already-identified Firebase person via an explicit event.
 * Returns whether the write was admitted, so deferred-buffer flushes can
 * retain their payload on a drop. Empty input is trivially admitted.
 */
function capturePersonProperties(
  set: Record<string, TelemetryValue> | null,
  setOnce: Record<string, TelemetryValue> | null
): boolean {
  if (!canEmit() || !distinctId || !boundUserId) return false
  if (consentState !== 'granted') return false
  if ((!set || Object.keys(set).length === 0) && (!setOnce || Object.keys(setOnce).length === 0)) {
    return true
  }
  const properties: TelemetryContext = {}
  if (set && Object.keys(set).length > 0) {
    ;(properties as Record<string, unknown>).$set = scrubProperties(set as TelemetryContext)
  }
  if (setOnce && Object.keys(setOnce).length > 0) {
    ;(properties as Record<string, unknown>).$set_once = scrubProperties(
      setOnce as TelemetryContext
    )
  }
  return capture('comfy.desktop.person.set', properties)
}

/**
 * Returns whether the event was admitted to the SDK. A `false` means it was
 * dropped (consent gate, volume guard, or SDK failure); one-shot callers use
 * this to keep their deferred payload instead of losing it.
 */
export function capture(event: string, properties: TelemetryContext = {}): boolean {
  if (!canEmit() || !distinctId) return false
  if (!isAllowedToFire(event)) return false
  if (!_checkRateLimit(event)) return false
  _eventsCapturedThisProcess++
  try {
    // Per-call properties override defaults on key collision — callers
    // that explicitly pass `app_version` (e.g. session-start payload,
    // legacy event re-emitters) win.
    // `$ip` is intentionally NOT stripped here: PostHog needs the request IP
    // to derive country (`disableGeoip: false` at init). The raw IP and all
    // sub-country geo are then discarded by an ingestion transformation, so
    // only the country code/name is retained. See the init comment.
    const merged = enforcePersonProcessingPolicy({ ...defaultEventProperties, ...properties })
    client!.capture({
      distinctId,
      event,
      properties: scrubProperties(merged)
    })
    return true
  } catch {
    // swallow – telemetry must never break the app
    return false
  }
}

/**
 * Capture the once-ever `comfy.desktop.app.first_launch` event with the same
 * deferral semantics as the boot session-start event.
 *
 * The caller's on-disk guard (in `deviceId.ts`) is consumed at boot, so this
 * fires for at most one launch in the installation's lifetime. But that launch
 * is, by definition, a fresh install whose consent is still `'undecided'` —
 * routing it through plain `capture()` would drop it on the consent gate while
 * the guard stays burned, so the event would never reach PostHog. Instead we
 * queue the payload and let `tryFlushDeferred()` ship it on the
 * `undecided → granted` transition (and never on a `'denied'` choice). If
 * consent is already `'granted'` (returning user who reinstalled after opting
 * in, or the rare migrator), it captures immediately.
 */
export function captureFirstLaunch(properties: TelemetryContext = {}): void {
  if (
    !canEmit() ||
    !distinctId ||
    consentState !== 'granted' ||
    !capture('comfy.desktop.app.first_launch', properties)
  ) {
    // Not admitted (deferred or dropped): the on-disk guard is already
    // burned, so keep the payload queued for the next flush trigger.
    pendingFirstLaunch = { ...(pendingFirstLaunch || {}), ...properties }
  }
}

/**
 * Update PostHog person properties for the current distinct id (`$set`).
 *
 * Before login, queue durable person props without any PostHog write. The
 * initial Firebase UID identify applies them; later authenticated updates use
 * an explicit capture-`$set` event.
 */
export function registerPersonProperties(properties: Record<string, TelemetryValue>): void {
  if (!canEmit()) return
  if (consentState !== 'granted' || !distinctId || !boundUserId) {
    pendingPersonSet = { ...(pendingPersonSet || {}), ...properties }
    return
  }
  capturePersonProperties(properties, null)
}

/**
 * Update PostHog person properties using `$set_once` semantics: the value is
 * written only if the property is currently absent on the person, and ignored
 * on every subsequent call. For durable activation markers (first-ever
 * timestamps) that must reflect the first occurrence across a person's
 * lifetime, even when the per-installation event that fires them can recur on
 * a reinstall or a second machine.
 *
 * Like `registerPersonProperties` but `$set_once` (write-once markers such
 * as `first_generation_at`). Pre-auth values are applied only at UID bind.
 */
export function registerPersonPropertiesOnce(properties: Record<string, TelemetryValue>): void {
  if (!canEmit()) return
  if (consentState !== 'granted' || !distinctId || !boundUserId) {
    pendingPersonSetOnce = { ...(pendingPersonSetOnce || {}), ...properties }
    return
  }
  capturePersonProperties(null, properties)
}

/**
 * How a local install was created. `express` and `manual` are the two fresh-
 * install wizard paths; `adopt` is an in-place Desktop-1 adoption; `migrate`
 * is a snapshot-based standalone migration. Kept as a closed union so the
 * funnel breakdown has a fixed set of buckets.
 */
export type InstallMethod = 'express' | 'manual' | 'adopt' | 'migrate'

/**
 * Emit the once-per-install `comfy.desktop.install.completed` event.
 *
 * Fired when a local install FINISHES (before/at first boot). Distinct from
 * `comfy.desktop.comfyui.boot_started`, which fires on EVERY launch and so
 * can't isolate the first install→boot transition. Centralised here (rather
 * than inlined at each completion site: express/manual, adopt, migrate) so
 * the event's property shape can't drift between the three call sites.
 *
 * `installation_id` is already an event-level default once `bindAnonymousId()` ran
 * at boot; it's passed explicitly here too so the event is self-describing
 * even in queries that don't rely on the default (and so the value is the
 * specific install that completed, not just the device).
 */
export function captureInstallCompleted(opts: {
  installationId: string
  method: InstallMethod
  express: boolean
}): void {
  capture('comfy.desktop.install.completed', {
    installation_id: opts.installationId,
    method: opts.method,
    express: opts.express
  })
  // Durable per-person activation milestone (#1224). All four methods
  // (express/manual/adopt/migrate) are local installs, so this stamps the
  // person the first time they EVER complete a local install — even across
  // quits, reinstalls, or a second machine. Lets the funnel distinguish
  // "onboarded but never installed" from "abandoned then recovered later".
  registerPersonPropertiesOnce({ first_local_install_completed_at: new Date().toISOString() })
}

export function captureException(error: unknown, properties: TelemetryContext = {}): void {
  if (!canEmit() || !distinctId) return
  // Exceptions are reliability data; suppress them outside `'granted'`.
  if (consentState !== 'granted') return
  try {
    // Same default merge as capture() so exception events stay filterable by
    // the shared axes (app_version, client, ...) instead of arriving bare.
    client!.captureException(
      error,
      distinctId,
      enforcePersonProcessingPolicy({ ...defaultEventProperties, ...properties })
    )
  } catch {
    // ignore
  }
}

/**
 * Fetch every feature flag for the current user with a hard timeout.
 *
 * Used by the experiments module's boot-time refresh. Returns `{}` on
 * timeout / failure so the caller can fall back to its cached values
 * without distinguishing failure modes. Suppressed unless consent is
 * `'granted'` — flag evaluation requests carry the distinct id and
 * person properties to PostHog, so they must not ship pre-consent.
 *
 * The returned record's keys are PostHog flag/experiment names; values
 * are the assigned variant (string for multivariate, boolean for
 * single-flag). See `src/main/lib/experiments.ts` for the cache wrapper.
 */
export async function loadFeatureFlagsImmediate(
  distinctId: string,
  personProperties: Record<string, string>,
  timeoutMs: number
): Promise<Record<string, FeatureFlagValue>> {
  if (!client) return {}
  if (consentState !== 'granted') return {}
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const flagsPromise = client.getAllFlags(distinctId, { personProperties })
    const timeoutPromise = new Promise<Record<string, FeatureFlagValue>>((resolve) => {
      timer = setTimeout(() => resolve({}), timeoutMs)
    })
    return await Promise.race([flagsPromise, timeoutPromise])
  } catch {
    return {}
  } finally {
    // Clear the timer when the flags promise wins the race so we don't
    // keep the event loop alive for the remainder of `timeoutMs`.
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Fetch a single OPERATIONAL feature flag value with a hard timeout.
 *
 * Bypasses the telemetry consent gate by design: this entry point is
 * reserved for kill-switches and capacity-protection flags (e.g.
 * `desktop-cloud-capacity`), not A/B experiments or analytics. Those
 * are server-config pushed *to* the client to protect service
 * availability for everyone — distinct from analytics data collected
 * *from* the user, which `loadFeatureFlagsImmediate` correctly gates on
 * consent. The only data leaving the device is the installation-stable
 * evaluation key and the flag key; no person properties are sent.
 *
 * Returns `undefined` when:
 *   - the PostHog client is not yet initialised
 *   - the network call times out or errors
 *   - the flag is missing on the server
 * Callers must default-fail-safe (e.g. `cloudCapacity.ts` defaults to
 * `'normal'`) so a fetch miss never accidentally degrades the product.
 */
export async function getOpsFlag(
  key: string,
  distinctId: string,
  timeoutMs: number
): Promise<FeatureFlagValue | undefined> {
  if (!client) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // No `personProperties` — ops flags are global, not user-keyed.
    // We record explicit experiment exposures elsewhere. Disabling the SDK's
    // implicit `$feature_flag_called` write also prevents this evaluation-only
    // key from creating a PostHog person behind the capture policy.
    const flagPromise = client.getFeatureFlag(key, distinctId, {
      sendFeatureFlagEvents: false
    })
    const timeoutPromise = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs)
    })
    const result = await Promise.race([flagPromise, timeoutPromise])
    if (typeof result === 'string' || typeof result === 'boolean') return result
    return undefined
  } catch {
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Wrap an async step with start/end/error telemetry events that mirror legacy
 * desktop's `@trackEvent` decorator. Errors are re-thrown so callers can
 * continue normal control flow.
 */
export async function trackedStep<T>(
  step: string,
  context: TelemetryContext,
  fn: () => Promise<T>
): Promise<T> {
  capture(`${step}.start`, context)
  const t0 = Date.now()
  try {
    const result = await fn()
    capture(`${step}.end`, { ...context, duration_ms: Date.now() - t0 })
    return result
  } catch (err) {
    // Standard error schema (class / message / bucket / signature) so every
    // `${step}.error` (adopt.register, migrate.*, snapshot.restore_*) is
    // diagnosable and groups by class regardless of locale or user paths.
    // `emit` (not `capture`) so allow-listed step errors also mirror to Datadog
    // for alerting; the `.start` / `.end` funnel events stay PostHog-only.
    emit(`${step}.error`, {
      ...context,
      duration_ms: Date.now() - t0,
      ...buildErrorFields(err)
    })
    throw err
  }
}

/**
 * Coarse error categorisation. Re-exported from `src/shared/errorBucket.ts`
 * so main and renderer classify identically (dedup).
 */
export const bucketError = sharedBucketError

/**
 * Forward an event to renderer-side Datadog RUM via the registered
 * telemetry relay targets (title bars). PostHog is intentionally NOT
 * fanned out here — `capture()` already sent the event from PostHog Node,
 * and the `mainAlreadyCaptured: true` flag in the payload tells the
 * renderer-side bootstrap to skip its PostHog Browser mirror so events
 * aren't double-counted.
 *
 * If no relay target is currently registered (no host window open yet),
 * the broadcast is a silent no-op — PostHog Node still captures the event
 * via `capture()`, so the event isn't lost; only its Datadog RUM mirror
 * is dropped, which is acceptable for the brief window before the first
 * host window opens.
 */
export function forwardToRenderer(event: string, context: TelemetryContext = {}): void {
  if (!isAllowedToFire(event)) return
  // only mirror events on the Datadog allow-list.
  // Product / funnel events are PostHog-only; main already captured them via
  // `capture()` and forwarding them to the renderer for Datadog mirror is
  // pure overhead.
  if (!isDatadogMirroredEvent(event)) return
  const payload = { event, context, mainAlreadyCaptured: true }
  for (const wc of _telemetryRelayTargets) {
    if (!wc.isDestroyed()) {
      try {
        wc.send('telemetry-action-from-main', payload)
      } catch {
        // ignore – telemetry must never break the app
      }
    }
  }
}

/**
 * Capture an event and forward it to the renderer in one call.
 */
export function emit(event: string, context: TelemetryContext = {}): void {
  capture(event, context)
  forwardToRenderer(event, context)
}

/**
 * Drain queued events. Safe to await during `app.before-quit`.
 */
export async function shutdown(reason: string): Promise<void> {
  if (!client) return
  const uptimeMs = Date.now() - bootstrapTimeMs
  try {
    capture('comfy.desktop.session.ended', {
      reason,
      uptime_ms: uptimeMs,
      uptime_seconds: Math.round(uptimeMs / 1000)
    })
  } catch {
    // ignore
  }
  try {
    await client.shutdown()
  } catch {
    // ignore
  } finally {
    client = null
    initialized = false
  }
}

let beforeQuitHooked = false
let drainingForQuit = false

/**
 * Maximum time we'll block the quit on draining queued PostHog events.
 * If the network is slow / down, we still want the app to exit promptly.
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 1500

/**
 * Wire `app.before-quit` so PostHog drains its queue before the process exits.
 *
 * Electron does NOT await async listeners on `before-quit`, so we use the
 * standard pattern of calling `event.preventDefault()`, awaiting the
 * shutdown, then re-issuing `app.exit()`. A one-shot guard prevents the
 * subsequent quit from re-entering this branch.
 *
 * Safe to call multiple times – the hook only attaches once.
 */
export function installAppHooks(): void {
  if (beforeQuitHooked) return
  beforeQuitHooked = true

  app.on('before-quit', (event) => {
    if (drainingForQuit || !client) return
    drainingForQuit = true
    event.preventDefault()
    const drainPromise = shutdown('quit').catch(() => {})
    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS)
    )
    void Promise.race([drainPromise, timeoutPromise]).finally(() => {
      app.exit(0)
    })
  })
}
