import { app } from 'electron'
import { PostHog } from 'posthog-node'
import { AsyncLocalStorage } from 'node:async_hooks'

export type FeatureFlagValue = string | boolean

export type OpsFlagFetchResult =
  | { kind: 'value'; value: FeatureFlagValue; payload: unknown }
  | { kind: 'unreachable' }
import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  isPostHogFlagDisabled as isFlagDisabled,
  isPostHogFlagEnabled as isFlagEnabled
} from '../../shared/posthogConfig'
import { isDatadogMirroredEvent } from '../../shared/datadogMirroredEvents'
import { bucketError as sharedBucketError } from '../../shared/errorBucket'
import { buildErrorFields, ERROR_MESSAGE_MAX, ERROR_STACK_MAX } from '../../shared/errorEvent'
import { normalizeExceptionContext, scrubAll } from '../../shared/piiScrub'
import {
  clearPersistedUnmergeableAnonymousEpoch,
  hasPersistedUnmergeableAnonymousEpoch,
  persistUnmergeableAnonymousEpoch,
  rotatePersistedAnonymousDistinctId
} from './anonymousIdentity'
import { normalizePostHogUserId } from './opaqueIdentifier'
import type { CloudUserTier } from '../../types/ipc'
import type { SmartAppControlState } from './smartAppControl'
import { recordIpcInvocation } from './e2eOverrides'
import {
  clearPendingIdentityMerges,
  type PendingIdentityProperties,
  readPendingIdentityMerges,
  reservePendingIdentityMerge
} from './pendingIdentityMerge'

export type TelemetryValue = boolean | number | string | null | undefined
export type TelemetryContext = Record<string, TelemetryValue | TelemetryValue[]>

const _telemetryRelayTargets = new Set<Electron.WebContents>()

export function registerTelemetryRelayTarget(wc: Electron.WebContents): void {
  _telemetryRelayTargets.add(wc)
  wc.once('destroyed', () => _telemetryRelayTargets.delete(wc))
}

export function unregisterTelemetryRelayTarget(wc: Electron.WebContents): void {
  _telemetryRelayTargets.delete(wc)
}

export function _resetTelemetryRelayTargets(): void {
  _telemetryRelayTargets.clear()
}

export function _resetForTest(): void {
  client = null
  distinctId = null
  anonymousDistinctId = null
  nextAnonymousDistinctId = null
  boundUserId = null
  firebaseConsensusPending = false
  installationIdProperty = null
  consentState = 'undecided'
  flagEvaluationStaff = false
  flagEvaluationUserTier = null
  flagEvaluationSacState = null
  flagEvaluationAppVersion = null
  pendingSessionStart = null
  pendingFirstLaunch = null
  pendingPersonSet = null
  pendingPersonSetOnce = null
  pendingUserBinding = null
  quarantinedWrites = []
  defaultEventProperties = {}
  initialized = false
  suppressEmit = false
  drainingForQuit = false
  pendingIdentityMergeFlush = null
  pendingIdentityMergeFileDirty = true
  queuedPendingIdentityMergeIds.clear()
  pendingLoginAttribution = null
}

export function _telemetryRelayTargetCount(): number {
  return _telemetryRelayTargets.size
}

interface PostHogConfig {
  apiKey: string
  host: string
  enabled: boolean
}

function readPostHogConfig(isPackaged: boolean): PostHogConfig {
  const nonBlank = (...values: Array<string | undefined>): string | undefined =>
    values.map((value) => value?.trim()).find((value) => Boolean(value))
  const apiKey =
    (isPackaged
      ? nonBlank(process.env['COMFY_DESKTOP_POSTHOG_API_KEY'])
      : nonBlank(process.env['COMFY_DESKTOP_POSTHOG_API_KEY'], process.env['POSTHOG_API_KEY'])) ??
    DEFAULT_POSTHOG_API_KEY
  const host =
    (isPackaged
      ? nonBlank(process.env['COMFY_DESKTOP_POSTHOG_HOST'])
      : nonBlank(process.env['COMFY_DESKTOP_POSTHOG_HOST'], process.env['POSTHOG_HOST'])) ??
    DEFAULT_POSTHOG_HOST
  const packagedHostIsSafe = (() => {
    if (!isPackaged || !process.env['COMFY_DESKTOP_POSTHOG_HOST']?.trim()) return true
    try {
      const url = new URL(host)
      return url.protocol === 'https:' && !url.username && !url.password
    } catch {
      return false
    }
  })()
  if (!packagedHostIsSafe) {
    console.warn('Rejecting unsafe COMFY_DESKTOP_POSTHOG_HOST; PostHog is disabled')
  }
  if (
    isPackaged &&
    (process.env['POSTHOG_API_KEY']?.trim() || process.env['POSTHOG_HOST']?.trim())
  ) {
    console.warn(
      'Packaged Comfy Desktop ignores generic POSTHOG_API_KEY/POSTHOG_HOST; use COMFY_DESKTOP_POSTHOG_* overrides'
    )
  }
  if (isPackaged && isFlagDisabled(process.env['POSTHOG_ENABLED'])) {
    console.warn('Packaged Comfy Desktop was disabled by the inherited POSTHOG_ENABLED opt-out')
  }
  const enabled =
    !isFlagDisabled(process.env['COMFY_DESKTOP_POSTHOG_ENABLED']) &&
    !isFlagDisabled(process.env['POSTHOG_ENABLED']) &&
    packagedHostIsSafe &&
    apiKey.length > 0
  return { apiKey, host, enabled }
}

let client: PostHog | null = null
let distinctId: string | null = null
let bootstrapTimeMs: number = Date.now()
let initialized = false
let suppressEmit = false

let firebaseConsensusPending = false

export function isFirebaseConsensusPending(): boolean {
  return firebaseConsensusPending
}

function canEmit(): boolean {
  return !suppressEmit && client !== null
}

let defaultEventProperties: Record<string, TelemetryValue> = {}

export const DEFAULT_EVENT_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'app_version',
  'app_channel',
  'app_env',
  'is_packaged',
  'platform',
  'arch',
  'client',
  'installation_id',
  'sac_state'
])

export type Deployment = 'local' | 'cloud' | 'remote'

export function asDeployment(value: unknown): Deployment | null {
  return value === 'local' || value === 'cloud' || value === 'remote' ? value : null
}

export function deriveAppChannel(appVersion: string): string {
  if (!appVersion) return 'unknown'
  const v = appVersion.toLowerCase()
  if (v.includes('-beta')) return 'beta'
  if (v.includes('-canary')) return 'canary'
  if (v.includes('-alpha')) return 'alpha'
  if (/[a-z]/.test(v.split('+')[0]?.split('-').slice(1).join('-') || '')) return 'unknown'
  return 'stable'
}

export type ConsentState = 'granted' | 'denied' | 'undecided'

let consentState: ConsentState = 'undecided'

let flagEvaluationStaff = false

let flagEvaluationUserTier: Exclude<CloudUserTier, 'unknown'> | null = null

let flagEvaluationSacState: SmartAppControlState | null = null

let flagEvaluationAppVersion: string | null = null

export function setFlagEvaluationStaff(isStaff: boolean): void {
  flagEvaluationStaff = isStaff
}

export function sendsStaffProperty(isStaff: boolean): boolean {
  return consentState === 'granted' && isStaff
}

export function setFlagEvaluationUserTier(tier: CloudUserTier): void {
  flagEvaluationUserTier = tier === 'unknown' ? null : tier
}

export function setSmartAppControlState(state: SmartAppControlState): void {
  flagEvaluationSacState = state
  defaultEventProperties = { ...defaultEventProperties, sac_state: state }
}

function opsFlagPersonProperties(): Record<string, string> {
  const properties: Record<string, string> = {}
  if (flagEvaluationAppVersion) properties['app_version'] = flagEvaluationAppVersion
  properties['platform'] = process.platform
  if (flagEvaluationSacState) properties['sac_state'] = flagEvaluationSacState
  if (sendsStaffProperty(flagEvaluationStaff)) properties['comfy_staff'] = 'true'
  if (consentState === 'granted' && flagEvaluationUserTier) {
    properties['user_tier'] = flagEvaluationUserTier
  }
  return properties
}

const PRE_CONSENT_ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'comfy.desktop.first_use.consent_decision'
])

function isAllowedToFire(event: string): boolean {
  if (PRE_CONSENT_ALLOWED_EVENTS.has(event)) return true
  if (consentState === 'granted') return true
  return false
}

const RATE_LIMIT_COUNT = 60
const RATE_LIMIT_WINDOW_MS = 60_000
const SESSION_EVENT_CAP = 5_000
const _rateLimitStamps: Map<string, number[]> = new Map()
const _rateLimitWarned: Set<string> = new Set()
let _eventsCapturedThisProcess = 0
let _sessionCapWarned = false

function _bypassRateLimit(event: string): boolean {
  return event.endsWith('.error') || event.startsWith('comfy.desktop.telemetry.')
}

function enforcePersonProcessingPolicy(properties: TelemetryContext): TelemetryContext {
  if (boundUserId) return properties
  return { ...properties, $process_person_profile: false }
}

function _emitWarning(event: string, properties: TelemetryContext): void {
  if (!canEmit() || !distinctId || firebaseWritesQuarantined()) return
  try {
    client!.capture({
      distinctId,
      event,
      properties: enforcePersonProcessingPolicy({ ...defaultEventProperties, ...properties })
    })
    forwardToRenderer(event, properties)
  } catch {}
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
  return true
}

function _recordCapturedEvent(event: string): void {
  _eventsCapturedThisProcess++
  if (_bypassRateLimit(event)) return
  const stamps = _rateLimitStamps.get(event) ?? []
  if (!_rateLimitStamps.has(event)) _rateLimitStamps.set(event, stamps)
  stamps.push(Date.now())
}

export function _test_resetVolumeGuards(): void {
  _rateLimitStamps.clear()
  _rateLimitWarned.clear()
  _eventsCapturedThisProcess = 0
  _sessionCapWarned = false
}

export function setConsentState(state: ConsentState): void {
  const previous = consentState
  consentState = state
  if (state !== 'granted') {
    void client?.flush().catch(() => {})
    if (state === 'denied') discardDeferredTelemetry()
    return
  }
  if (previous !== 'granted') {
    tryFlushDeferred()
  }
}

export function getConsentState(): ConsentState {
  return consentState
}

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
  sessionStartProps?: Record<string, SessionStartValue>
}

export type SessionStartValue = TelemetryValue | (() => TelemetryValue)

function sessionStartValues(
  props: Record<string, SessionStartValue>
): Record<string, TelemetryValue> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      typeof value === 'function' ? value() : value
    ])
  )
}

export function initTelemetry(opts: InitOptions): void {
  if (initialized) return
  initialized = true
  bootstrapTimeMs = Date.now()
  flagEvaluationAppVersion = opts.appVersion

  defaultEventProperties = {
    app_version: opts.appVersion,
    app_channel: deriveAppChannel(opts.appVersion),
    app_env: opts.appEnv,
    is_packaged: opts.isPackaged,
    platform: process.platform,
    arch: process.arch,
    client: 'desktop'
  }

  suppressEmit = !opts.isPackaged

  const cfg = readPostHogConfig(opts.isPackaged)
  if (!cfg.enabled) return

  try {
    client = new PostHog(cfg.apiKey, {
      host: cfg.host,
      flushAt: 20,
      flushInterval: 10_000,
      featureFlagsRequestTimeoutMs: 10_000,
      disableGeoip: false
    })
    client.on('flush', acknowledgeDeliveredIdentityMerges)
    client.on('error', () => {
      queuedPendingIdentityMergeIds.clear()
      pendingIdentityMergeFileDirty = true
    })
  } catch {
    client = null
  }

  pendingSessionStart = {
    ...opts.sessionStartProps,
    app_env: opts.appEnv,
    app_version: opts.appVersion,
    is_packaged: opts.isPackaged
  }
}

let pendingSessionStart: Record<string, SessionStartValue> | null = null
let pendingFirstLaunch: TelemetryContext | null = null
let pendingPersonSet: Record<string, TelemetryValue> | null = null
let pendingPersonSetOnce: Record<string, TelemetryValue> | null = null

interface PendingUserBinding {
  userId: string
  emitLoginEvent: boolean
  properties: Record<string, TelemetryValue>
}

let pendingUserBinding: PendingUserBinding | null = null

const FIREBASE_LOGIN_ATTRIBUTION_EVENT = 'comfy.desktop.identity.login_attributed'

let pendingLoginAttribution: { userId: string; context: TelemetryContext } | null = null

export function stageLoginAttribution(userId: string, context: TelemetryContext): void {
  if (consentState === 'denied') return
  pendingLoginAttribution = { userId, context }
}

function emitStagedLoginAttribution(confirmedUserId: string): void {
  if (!pendingLoginAttribution) return
  const { userId, context } = pendingLoginAttribution
  pendingLoginAttribution = null
  if (userId === confirmedUserId) capture(FIREBASE_LOGIN_ATTRIBUTION_EVENT, context)
}

interface QuarantinedWrite {
  kind: 'event' | 'exception'
  event?: string
  error?: unknown
  properties: TelemetryContext
  forward: boolean
  timestamp: Date
}

let quarantinedWrites: QuarantinedWrite[] = []
const QUARANTINED_WRITES_CAP = 200

function firebaseWritesQuarantined(): boolean {
  return firebaseConsensusPending && boundUserId !== null
}

function queueQuarantinedWrite(write: QuarantinedWrite): boolean {
  if (quarantinedWrites.length >= QUARANTINED_WRITES_CAP) return false
  quarantinedWrites.push(write)
  return true
}

function flushQuarantinedWrites(): void {
  if (quarantinedWrites.length === 0) return
  const writes = quarantinedWrites
  quarantinedWrites = []
  if (!canEmit() || !distinctId) return
  for (const write of writes) {
    if (write.kind === 'exception') {
      if (consentState === 'granted') deliverException(write.error, write.properties, write.forward)
    } else if (write.event && isAllowedToFire(write.event)) {
      deliverEvent(write.event, write.properties, write.forward, write.timestamp)
    }
  }
}

let anonymousDistinctId: string | null = null
let nextAnonymousDistinctId: string | null = null
let boundUserId: string | null = null
let installationIdProperty: string | null = null
let pendingIdentityMergeFlush: Promise<void> | null = null
let pendingIdentityMergeFileDirty = true
const queuedPendingIdentityMergeIds = new Set<string>()

function discardDeferredTelemetry(): void {
  pendingSessionStart = null
  pendingFirstLaunch = null
  pendingPersonSet = null
  pendingPersonSetOnce = null
  pendingUserBinding = null
  pendingLoginAttribution = null
  quarantinedWrites = []
}

function acknowledgeDeliveredIdentityMerges(messages: unknown): void {
  if (!Array.isArray(messages)) return
  const delivered = new Set<string>()
  const pending = readPendingIdentityMerges()
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const candidate = message as {
      event?: unknown
      distinct_id?: unknown
      properties?: { $anon_distinct_id?: unknown }
    }
    if (candidate.event !== '$identify' || typeof candidate.distinct_id !== 'string') continue
    const anonymousId = candidate.properties?.$anon_distinct_id
    if (typeof anonymousId !== 'string') continue
    for (const merge of pending) {
      if (merge.userId === candidate.distinct_id && merge.anonymousId === anonymousId) {
        delivered.add(merge.id)
      }
    }
  }
  if (delivered.size > 0 && clearPendingIdentityMerges(delivered)) {
    for (const id of delivered) queuedPendingIdentityMergeIds.delete(id)
  }
}

function flushPendingIdentityMerges(): Promise<void> {
  if (pendingIdentityMergeFlush) return pendingIdentityMergeFlush
  if (!canEmit() || consentState !== 'granted') return Promise.resolve()
  if (!pendingIdentityMergeFileDirty) return Promise.resolve()

  const pending = readPendingIdentityMerges()
  if (pending.length === 0 && queuedPendingIdentityMergeIds.size === 0) {
    pendingIdentityMergeFileDirty = false
    return Promise.resolve()
  }
  const pendingIds = new Set(pending.map((merge) => merge.id))
  for (const id of queuedPendingIdentityMergeIds) {
    if (!pendingIds.has(id)) queuedPendingIdentityMergeIds.delete(id)
  }
  let admittedAny = false
  for (const merge of pending) {
    if (!queuedPendingIdentityMergeIds.has(merge.id)) {
      try {
        client!.identify({
          distinctId: merge.userId,
          properties: {
            $set: merge.personSet,
            ...(merge.personSetOnce ? { $set_once: merge.personSetOnce } : {}),
            $anon_distinct_id: merge.anonymousId
          }
        })
        queuedPendingIdentityMergeIds.add(merge.id)
        admittedAny = true
      } catch {
        continue
      }
    }
  }
  pendingIdentityMergeFileDirty = pending.some(
    (merge) => !queuedPendingIdentityMergeIds.has(merge.id)
  )
  if (!admittedAny && queuedPendingIdentityMergeIds.size === 0) return Promise.resolve()

  const activeClient = client!
  pendingIdentityMergeFlush = activeClient
    .flush()
    .catch(() => {})
    .finally(() => {
      pendingIdentityMergeFlush = null
    })
  return pendingIdentityMergeFlush
}

function tryFlushDeferred(): void {
  if (!canEmit() || !distinctId) return
  if (consentState !== 'granted') return
  if (firebaseWritesQuarantined()) return
  if (boundUserId && (pendingPersonSet || pendingPersonSetOnce)) {
    if (capturePersonProperties(pendingPersonSet, pendingPersonSetOnce)) {
      pendingPersonSet = null
      pendingPersonSetOnce = null
    }
  }
  if (
    pendingSessionStart &&
    capture('comfy.desktop.session.started', sessionStartValues(pendingSessionStart))
  ) {
    pendingSessionStart = null
  }
  if (pendingFirstLaunch && capture('comfy.desktop.app.first_launch', pendingFirstLaunch)) {
    pendingFirstLaunch = null
  }
  if (pendingUserBinding && !firebaseConsensusPending) {
    const { userId, emitLoginEvent, properties } = pendingUserBinding
    pendingUserBinding = null
    applyFirebaseUserBinding(userId, emitLoginEvent, properties)
  }
  void flushPendingIdentityMerges()
}

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
  if (consentState !== 'denied' && Object.keys(properties).length > 0) {
    pendingPersonSet = {
      ...(pendingPersonSet || {}),
      installation_id: installationId,
      ...properties
    }
  }
  if (!canEmit()) return
  tryFlushDeferred()
}

function persistablePersonProperties(properties: TelemetryContext): PendingIdentityProperties {
  const persistable: PendingIdentityProperties = {}
  for (const [key, value] of Object.entries(properties)) {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      persistable[key] = value
    }
  }
  return persistable
}

function queuePendingUserBinding(
  userId: string,
  emitLoginEvent: boolean,
  properties: Record<string, TelemetryValue>
): void {
  const existing = pendingUserBinding?.userId === userId ? pendingUserBinding : null
  pendingUserBinding = {
    userId,
    emitLoginEvent: emitLoginEvent || existing?.emitLoginEvent === true,
    properties: { ...(existing?.properties ?? {}), ...properties }
  }
}

function endFirebaseWriteQuarantine(disposition: 'replay' | 'discard'): void {
  firebaseConsensusPending = false
  if (disposition === 'replay') flushQuarantinedWrites()
  else quarantinedWrites = []
}

function settlePendingPersonBuffersForDetach(): void {
  if (canEmit() && consentState === 'granted' && (pendingPersonSet || pendingPersonSetOnce)) {
    capturePersonProperties(pendingPersonSet, pendingPersonSetOnce)
  }
  pendingPersonSet = null
  pendingPersonSetOnce = null
}

function applyFirebaseUserBinding(
  userId: string,
  emitLoginEvent: boolean,
  properties: Record<string, TelemetryValue> = {}
): void {
  const normalizedUserId = normalizePostHogUserId(userId)
  endFirebaseWriteQuarantine(
    normalizedUserId !== null && normalizedUserId === boundUserId ? 'replay' : 'discard'
  )
  if (!normalizedUserId) return
  if (consentState === 'denied') {
    if (boundUserId && boundUserId !== normalizedUserId) detachFromBoundUser()
    return
  }

  if (!canEmit() || !anonymousDistinctId || !installationIdProperty) {
    queuePendingUserBinding(normalizedUserId, emitLoginEvent, properties)
    return
  }
  if (boundUserId === normalizedUserId) {
    if (Object.keys(properties).length > 0) registerPersonProperties(properties)
    if (emitLoginEvent) capture('app:user_logged_in', { user_id: normalizedUserId })
    emitStagedLoginAttribution(normalizedUserId)
    tryFlushDeferred()
    return
  }
  if (boundUserId) settlePendingPersonBuffersForDetach()
  if (consentState !== 'granted') {
    if (boundUserId) {
      detachFromBoundUser()
      if (!anonymousDistinctId) return
    }
    queuePendingUserBinding(normalizedUserId, emitLoginEvent, properties)
    return
  }

  if (boundUserId) {
    detachFromBoundUser()
    if (!anonymousDistinctId) return
  }

  const personSet = scrubProperties({
    ...(pendingPersonSet || {}),
    ...properties,
    installation_id: installationIdProperty,
    is_authenticated: true
  })
  const personSetOnce = pendingPersonSetOnce
    ? scrubProperties(pendingPersonSetOnce as TelemetryContext)
    : null
  const anonymousId = anonymousDistinctId
  const pendingMerge = reservePendingIdentityMerge({
    anonymousId,
    userId: normalizedUserId,
    installationId: installationIdProperty,
    personSet: persistablePersonProperties(personSet),
    ...(personSetOnce ? { personSetOnce: persistablePersonProperties(personSetOnce) } : {})
  })
  if (!pendingMerge) {
    queuePendingUserBinding(normalizedUserId, emitLoginEvent, properties)
    return
  }
  pendingIdentityMergeFileDirty = true
  const reservedNextAnonymousId = pendingMerge.nextAnonymousId

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
    queuedPendingIdentityMergeIds.add(pendingMerge.id)
  } catch {
    anonymousDistinctId = reservedNextAnonymousId
    nextAnonymousDistinctId = null
    distinctId = reservedNextAnonymousId
    queuePendingUserBinding(normalizedUserId, emitLoginEvent, properties)
    return
  }
  boundUserId = normalizedUserId
  nextAnonymousDistinctId = reservedNextAnonymousId
  pendingPersonSet = null
  pendingPersonSetOnce = null
  pendingUserBinding = null
  if (emitLoginEvent) {
    capture('app:user_logged_in', { user_id: normalizedUserId })
  }
  emitStagedLoginAttribution(normalizedUserId)
  tryFlushDeferred()
}

export function applyFirebaseUserConsensus(userId: string): void {
  applyFirebaseUserBinding(userId, false)
}

export function bindUserId(userId: string, properties: Record<string, TelemetryValue> = {}): void {
  applyFirebaseUserBinding(userId, true, properties)
}

export function applyFirebasePendingConsensus(): void {
  firebaseConsensusPending = true
}

export function releaseFirebasePendingConsensus(): void {
  endFirebaseWriteQuarantine('replay')
  tryFlushDeferred()
}

function detachFromBoundUser(): void {
  endFirebaseWriteQuarantine('discard')
  pendingUserBinding = null
  if (!boundUserId) return
  settlePendingPersonBuffersForDetach()
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

export function applyFirebaseAnonymousConsensus(): void {
  pendingLoginAttribution = null
  detachFromBoundUser()
}

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

export function capture(event: string, properties: TelemetryContext = {}): boolean {
  return captureEvent(event, properties, false)
}

function captureEvent(event: string, properties: TelemetryContext, forward: boolean): boolean {
  recordIpcInvocation(`telemetry:${event}`, properties)
  if (!canEmit() || !distinctId) return false
  if (!isAllowedToFire(event)) return false
  if (!_checkRateLimit(event)) return false
  if (firebaseWritesQuarantined()) {
    if (
      !queueQuarantinedWrite({ kind: 'event', event, properties, forward, timestamp: new Date() })
    )
      return false
    _recordCapturedEvent(event)
    return true
  }
  if (!deliverEvent(event, properties, forward, null)) return false
  _recordCapturedEvent(event)
  return true
}

function deliverEvent(
  event: string,
  properties: TelemetryContext,
  forward: boolean,
  timestamp: Date | null
): boolean {
  try {
    const merged = enforcePersonProcessingPolicy({ ...defaultEventProperties, ...properties })
    client!.capture({
      distinctId: distinctId!,
      event,
      properties: scrubProperties(merged),
      ...(timestamp ? { timestamp } : {})
    })
    if (forward) forwardToRenderer(event, properties)
    return true
  } catch {
    return false
  }
}

export function captureFirstLaunch(properties: TelemetryContext = {}): void {
  if (consentState === 'denied') return
  if (
    !canEmit() ||
    !distinctId ||
    consentState !== 'granted' ||
    !capture('comfy.desktop.app.first_launch', properties)
  ) {
    pendingFirstLaunch = { ...(pendingFirstLaunch || {}), ...properties }
  }
}

export function registerPersonProperties(properties: Record<string, TelemetryValue>): void {
  if (!canEmit() || consentState === 'denied') return
  if (consentState !== 'granted' || !distinctId || !boundUserId || firebaseWritesQuarantined()) {
    pendingPersonSet = { ...(pendingPersonSet || {}), ...properties }
    return
  }
  capturePersonProperties(properties, null)
}

export function registerPersonPropertiesOnce(properties: Record<string, TelemetryValue>): void {
  if (!canEmit() || consentState === 'denied') return
  if (consentState !== 'granted' || !distinctId || !boundUserId || firebaseWritesQuarantined()) {
    pendingPersonSetOnce = { ...properties, ...(pendingPersonSetOnce || {}) }
    return
  }
  capturePersonProperties(null, properties)
}

export type InstallMethod = 'express' | 'manual' | 'adopt' | 'migrate'

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
  registerPersonPropertiesOnce({ first_local_install_completed_at: new Date().toISOString() })
}

export function captureException(error: unknown, properties: TelemetryContext = {}): boolean {
  return captureExceptionWrite(error, properties, false)
}

export function captureExceptionAndForward(
  error: unknown,
  properties: TelemetryContext = {}
): boolean {
  return captureExceptionWrite(error, properties, true)
}

function captureExceptionWrite(
  error: unknown,
  properties: TelemetryContext,
  forward: boolean
): boolean {
  if (!canEmit() || !distinctId) return false
  if (consentState !== 'granted') return false
  if (!_checkRateLimit('comfy.desktop.exception.error')) return false
  if (firebaseWritesQuarantined()) {
    if (
      !queueQuarantinedWrite({
        kind: 'exception',
        error,
        properties,
        forward,
        timestamp: new Date()
      })
    )
      return false
    _recordCapturedEvent('comfy.desktop.exception.error')
    return true
  }
  if (!deliverException(error, properties, forward)) return false
  _recordCapturedEvent('comfy.desktop.exception.error')
  return true
}

function isPostHogExceptionCaptureEnabled(): boolean {
  return isFlagEnabled(process.env['COMFY_DESKTOP_POSTHOG_EXCEPTIONS'])
}

function deliverException(error: unknown, properties: TelemetryContext, forward: boolean): boolean {
  try {
    const source = error instanceof Error ? error : new Error(String(error))
    const safeError = new Error(scrubAll(source.message || source.name).slice(0, ERROR_MESSAGE_MAX))
    safeError.name = scrubAll(source.name || 'Error').slice(0, 128)
    if (source.stack) safeError.stack = scrubAll(source.stack).slice(0, ERROR_STACK_MAX)
    const safeErrorRecord = safeError as Error & Record<string, unknown>
    for (const [key, value] of Object.entries(source).slice(0, 32)) {
      if (typeof value === 'string' && !['message', 'name', 'stack'].includes(key)) {
        safeErrorRecord[scrubAll(key).slice(0, 128)] = scrubAll(value).slice(0, ERROR_MESSAGE_MAX)
      }
    }
    if (isPostHogExceptionCaptureEnabled()) {
      client!.captureException(
        safeError,
        distinctId!,
        normalizeExceptionContext(
          enforcePersonProcessingPolicy({ ...defaultEventProperties, ...properties })
        ) as TelemetryContext
      )
    }
    if (forward) forwardExceptionToRenderer(properties, safeError)
    return true
  } catch {
    return false
  }
}

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
    if (timer !== undefined) clearTimeout(timer)
  }
}

type PostHogFeatureFlagResult = NonNullable<Awaited<ReturnType<PostHog['getFeatureFlagResult']>>>

function toOpsFlagValue(
  result: PostHogFeatureFlagResult
): Extract<OpsFlagFetchResult, { kind: 'value' }> {
  return {
    kind: 'value',
    value: result.enabled ? (result.variant ?? true) : false,
    payload: result.payload
  }
}

type LateOpsFlagOutcome = 'value' | 'no_result' | 'rejected'

const OPS_FLAG_LATE_RESULT_EVENT = 'comfy.desktop.ops_flag.late_result'

interface AbandonedOpsFlagFetch {
  key: string
  startedAt: number
  flagPromise: ReturnType<PostHog['getFeatureFlagResult']>
  onLateResult?: (result: Extract<OpsFlagFetchResult, { kind: 'value' }>) => void
}

function observeAbandonedOpsFlagFetch(abandoned: AbandonedOpsFlagFetch): void {
  const report = (outcome: LateOpsFlagOutcome, extra: TelemetryContext = {}): void => {
    try {
      capture(OPS_FLAG_LATE_RESULT_EVENT, {
        flag_key: abandoned.key,
        outcome,
        duration_ms: Date.now() - abandoned.startedAt,
        ...extra
      })
    } catch {}
  }

  void abandoned.flagPromise
    .then(
      (late) => {
        if (!late) {
          report('no_result')
          return
        }
        report('value')
        try {
          abandoned.onLateResult?.(toOpsFlagValue(late))
        } catch {}
      },
      (err: unknown) => report('rejected', { error_bucket: sharedBucketError(err) })
    )
    .catch(() => {})
}

const OPS_FLAG_DEADLINE: unique symbol = Symbol('ops-flag-deadline')

export async function getOpsFlagResult(
  key: string,
  distinctId: string,
  timeoutMs: number,
  onLateResult?: (result: Extract<OpsFlagFetchResult, { kind: 'value' }>) => void
): Promise<OpsFlagFetchResult> {
  if (!client) return { kind: 'unreachable' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const startedAt = Date.now()
  try {
    const flagPromise = client.getFeatureFlagResult(key, distinctId, {
      sendFeatureFlagEvents: false,
      personProperties: opsFlagPersonProperties()
    })
    const timeoutPromise = new Promise<typeof OPS_FLAG_DEADLINE>((resolve) => {
      timer = setTimeout(() => resolve(OPS_FLAG_DEADLINE), timeoutMs)
    })
    const result = await Promise.race([flagPromise, timeoutPromise])
    if (result === OPS_FLAG_DEADLINE) {
      observeAbandonedOpsFlagFetch({ key, startedAt, flagPromise, onLateResult })
      return { kind: 'unreachable' }
    }
    if (!result) return { kind: 'unreachable' }
    return toOpsFlagValue(result)
  } catch {
    return { kind: 'unreachable' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

interface TrackedStepScope {
  failedStage?: string
  failureContext?: TelemetryContext
}

const trackedStepScope = new AsyncLocalStorage<TrackedStepScope>()

export async function trackedStep<T>(
  step: string,
  context: TelemetryContext,
  fn: () => Promise<T>,
  options: { emitError?: boolean; canonicalError?: boolean } = {}
): Promise<T> {
  capture(`${step}.start`, context)
  const t0 = Date.now()
  const canonicalScope: TrackedStepScope | undefined = options.canonicalError ? {} : undefined
  try {
    const result = options.canonicalError
      ? await trackedStepScope.run(canonicalScope!, fn)
      : await fn()
    capture(`${step}.end`, { ...context, duration_ms: Date.now() - t0 })
    return result
  } catch (err) {
    const scope = canonicalScope ?? trackedStepScope.getStore()
    if (scope && !options.canonicalError && !scope.failedStage) {
      scope.failedStage = step
      scope.failureContext = context
    }
    const shouldEmitError =
      options.emitError === true ||
      (options.emitError !== false && (!scope || options.canonicalError))
    if (shouldEmitError) {
      emit(`${step}.error`, {
        ...context,
        ...(scope?.failureContext || {}),
        ...(scope?.failedStage ? { failed_stage: scope.failedStage } : {}),
        duration_ms: Date.now() - t0,
        ...buildErrorFields(err)
      })
    }
    throw err
  }
}

export const bucketError = sharedBucketError

export function forwardToRenderer(event: string, context: TelemetryContext = {}): void {
  if (!isAllowedToFire(event)) return
  if (!isDatadogMirroredEvent(event)) return
  const payload = { event, context, mainAlreadyCaptured: true }
  for (const wc of _telemetryRelayTargets) {
    if (!wc.isDestroyed()) {
      try {
        wc.send('telemetry-action-from-main', payload)
      } catch {}
    }
  }
}

export function forwardExceptionToRenderer(context: TelemetryContext = {}, error?: Error): void {
  const allowedKeys = [
    'origin',
    'source',
    'forwarded_source',
    'level',
    'reason',
    'exitCode',
    'exit_code',
    'type',
    'error_type'
  ]
  const safeContext: TelemetryContext = {}
  for (const key of allowedKeys) {
    const value = context[key]
    if (!Array.isArray(value)) safeContext[key] = value
  }
  const payload = {
    source: String(
      safeContext['source'] ?? safeContext['forwarded_source'] ?? 'captured-exception'
    ),
    message: error?.message || 'Desktop application exception',
    ...(error?.stack ? { stack: error.stack } : {}),
    context: safeContext,
    skipPostHog: true
  }
  for (const wc of _telemetryRelayTargets) {
    if (!wc.isDestroyed()) {
      try {
        wc.send('dd-error', payload)
      } catch {}
    }
  }
}

export function emit(event: string, context: TelemetryContext = {}): void {
  captureEvent(event, context, true)
}

export async function shutdown(reason: string): Promise<void> {
  if (!client) return
  const uptimeMs = Date.now() - bootstrapTimeMs
  try {
    if (firebaseConsensusPending) releaseFirebasePendingConsensus()
    if (pendingLoginAttribution) {
      const { userId, context } = pendingLoginAttribution
      pendingLoginAttribution = null
      if (boundUserId === null || userId === boundUserId) {
        capture(FIREBASE_LOGIN_ATTRIBUTION_EVENT, context)
      }
    }
    capture('comfy.desktop.session.ended', {
      reason,
      uptime_ms: uptimeMs,
      uptime_seconds: Math.round(uptimeMs / 1000)
    })
  } catch {}
  try {
    await flushPendingIdentityMerges()
    await client.shutdown()
  } catch {
  } finally {
    client = null
    initialized = false
  }
}

let beforeQuitHooked = false
let drainingForQuit = false

const SHUTDOWN_DRAIN_TIMEOUT_MS = 1500

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
      app.quit()
    })
  })
}
