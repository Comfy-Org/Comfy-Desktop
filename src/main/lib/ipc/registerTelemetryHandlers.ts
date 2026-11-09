// IPC for renderer-originated telemetry: the renderer routes through main so
// identity, consent, and dedup live in one place. Capture messages are
// fire-and-forget (ipcMain.on).
import { ipcMain, type IpcMainEvent, type WebContents, type WebFrameMain } from 'electron'
import { comfyWindows, findEntryByComfySender, type ComfyWindowEntry } from '../../host/registry'
import * as mainTelemetry from '../telemetry'
import {
  getFlagAsync as getExperimentFlagAsync,
  recordExposure,
  type ExperimentExposureSource
} from '../experiments'
import { normalizeExceptionContext } from '../../../shared/piiScrub'
import {
  getFirebaseIdentityConsensus,
  getUnverifiedLocalFirebaseSignInReport,
  observeFirebaseIdentityConsensus,
  reportFirebaseAuthState,
  viewsReportingFirebaseUser
} from '../firebaseAuthIdentity'
import { parseProactiveGreetingAttribution } from '../proactiveGreetingTelemetry'
import type {
  ComfyDesktop2FirebaseAuthState,
  ComfyDesktop2ProactiveGreetingAdmission
} from '../../../types/comfyDesktopBridge'
import { normalizePostHogUserId } from '../opaqueIdentifier'
import { isTrustedCloudUrl } from '../trustedCloudUrl'
import { isLoopbackOrigin } from '../verifiedLocalFirebaseAuth'
import { lookupAccount } from '../../auth/desktopLoginCode/customTokenSignIn'
import { getFirebaseConfig } from '../../auth/firebaseBridge/config'

interface CapturePayload {
  event?: unknown
  properties?: unknown
}

interface CaptureExceptionPayload {
  message?: unknown
  stack?: unknown
  properties?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

type HostedSenderEvent = Pick<IpcMainEvent, 'sender' | 'senderFrame'>

function firebaseAuthReporterFrame(event: HostedSenderEvent): WebFrameMain | null {
  const frame = event.senderFrame
  const mainFrame = event.sender.mainFrame
  if (!frame || frame.processId !== mainFrame.processId || frame.routingId !== mainFrame.routingId)
    return null
  return frame
}

function asFirebaseAuthState(value: unknown): ComfyDesktop2FirebaseAuthState | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (source.status === 'pending' || source.status === 'signed_out') {
    return { status: source.status }
  }
  if (source.status !== 'signed_in') return null
  const userId = normalizePostHogUserId(source.userId)
  if (!userId) return null
  return { status: 'signed_in', userId }
}

function isTelemetryValue(v: unknown): v is mainTelemetry.TelemetryValue {
  return (
    v === null ||
    v === undefined ||
    typeof v === 'boolean' ||
    typeof v === 'number' ||
    typeof v === 'string'
  )
}

const MAX_TELEMETRY_KEYS = 128
const MAX_TELEMETRY_ARRAY_ITEMS = 128
const MAX_TELEMETRY_STRING_LENGTH = 2048
// Explicit allow-list of event-property keys that carry a single
// pre-serialized JSON string legitimately exceeding the scalar clamp. The
// renderer size-guards them via `serializeForTelemetry` (omits + flags
// `*_truncated` when over budget) and they are PII-safe summaries, so they get
// a larger ceiling. Gated by an allow-list rather than a `_json` suffix so a
// renderer can't bypass the tight clamp by renaming an arbitrary field.
const MAX_TELEMETRY_JSON_STRING_LENGTH = 768 * 1024
const LARGE_JSON_TELEMETRY_KEYS: ReadonlySet<string> = new Set([
  'installs_json',
  'gpus_json',
  'installations_json',
  'latest_snapshot_json',
  'snapshot_diffs_json'
])

function clampTelemetryValue(
  v: mainTelemetry.TelemetryValue,
  limit: number = MAX_TELEMETRY_STRING_LENGTH
): mainTelemetry.TelemetryValue {
  return typeof v === 'string' ? v.slice(0, limit) : v
}

function asTelemetryValueArray(v: unknown): mainTelemetry.TelemetryValue[] | null {
  if (!Array.isArray(v)) return null
  const out: mainTelemetry.TelemetryValue[] = []
  for (let i = 0; i < v.length && i < MAX_TELEMETRY_ARRAY_ITEMS; i++) {
    const raw = v[i]
    if (!isTelemetryValue(raw)) return null
    out.push(clampTelemetryValue(raw))
  }
  return out
}

// `allowLargeJsonStrings` is only for event properties: the larger `_json`
// ceiling must not apply to person properties, where PostHog caps the whole
// record at 512 KB total.
function asTelemetryObject(
  value: unknown,
  allowArrays: true,
  allowLargeJsonStrings: boolean
): mainTelemetry.TelemetryContext
function asTelemetryObject(
  value: unknown,
  allowArrays: false,
  allowLargeJsonStrings: boolean
): Record<string, mainTelemetry.TelemetryValue>
function asTelemetryObject(
  value: unknown,
  allowArrays: boolean,
  allowLargeJsonStrings: boolean
): mainTelemetry.TelemetryContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const out: mainTelemetry.TelemetryContext = {}
  let count = 0
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    if (count++ >= MAX_TELEMETRY_KEYS) break
    const raw = source[key]
    if (isTelemetryValue(raw)) {
      const limit =
        allowLargeJsonStrings && LARGE_JSON_TELEMETRY_KEYS.has(key)
          ? MAX_TELEMETRY_JSON_STRING_LENGTH
          : MAX_TELEMETRY_STRING_LENGTH
      out[key] = clampTelemetryValue(raw, limit)
    } else if (allowArrays) {
      const array = asTelemetryValueArray(raw)
      if (array) out[key] = array
    }
  }
  return out
}

// Per-key filter to the TelemetryContext contract.
function asProps(value: unknown): mainTelemetry.TelemetryContext {
  return asTelemetryObject(value, true, true)
}

function asExceptionProps(value: unknown): mainTelemetry.TelemetryContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return normalizeExceptionContext(
    value as Record<string, unknown>
  ) as mainTelemetry.TelemetryContext
}

function asPersonProps(value: unknown): Record<string, mainTelemetry.TelemetryValue> {
  return asTelemetryObject(value, false, false)
}

/**
 * Platform axes (`client` / `deployment`) for relayed events are
 * HOST-AUTHORITATIVE, never trusted from the payload:
 *
 * - `client` is stripped from every relayed payload so the SDK default
 *   ('desktop') applies. Anything arriving over this IPC channel was by
 *   definition emitted from inside the desktop app — but a hosted frontend
 *   bundle that also runs in a browser (the cloud frontend) registers
 *   `client` as a posthog-js super property, and if a future EventSink-style
 *   tap ever forwards posthog-js state through the bridge, its value
 *   ('web') would be wrong here.
 * - `deployment` is resolved from the SENDER: a hosted ComfyUI frontend
 *   doesn't know (and shouldn't have to know) whether its install is local,
 *   cloud, or remote, but main does — via the comfyView → install
 *   attachment. Per-sender (not a process-global default) so two windows in
 *   different modes tag correctly. When the sender resolves, its value
 *   overwrites any payload `deployment` for the same reason as `client`.
 *   Launcher-UI senders have no comfyView entry and stay untagged — their
 *   events are app-level, not deployment-scoped.
 */
function deploymentForSender(sender: WebContents | undefined): mainTelemetry.Deployment | null {
  if (!sender) return null
  return mainTelemetry.asDeployment(findEntryByComfySender(sender)?.sourceCategory)
}

function withPlatformAxes(
  properties: mainTelemetry.TelemetryContext,
  sender: WebContents | undefined
): mainTelemetry.TelemetryContext {
  delete properties['client']
  const deployment = deploymentForSender(sender)
  if (deployment !== null) return { ...properties, deployment }
  // Unknown sender (launcher UI, popouts): a payload deployment may pass
  // through, but only if it's a valid axis value — junk is stripped.
  if (mainTelemetry.asDeployment(properties['deployment']) === null) {
    delete properties['deployment']
  }
  return properties
}

function isProactiveGreetingHost(entry: ComfyWindowEntry, url: string): boolean {
  if (!entry.installationId) return false
  if (entry.sourceCategory === 'cloud') return isTrustedCloudUrl(url)
  if (entry.sourceCategory !== 'local' || entry.sourceId !== 'standalone') return false
  const origin = URL.parse(url)?.origin
  return !!origin && isLoopbackOrigin(origin) && URL.parse(entry.comfyUrl)?.origin === origin
}

function isProactiveGreetingSender(event: HostedSenderEvent, userId: string): boolean {
  const frame = event && firebaseAuthReporterFrame(event)
  if (!frame) return false
  const entry = findEntryByComfySender(event.sender)
  return (
    !!entry &&
    isProactiveGreetingHost(entry, frame.url) &&
    viewsReportingFirebaseUser(userId).includes(event.sender)
  )
}

const verifyingLocalViews = new WeakSet<WebContents>()
const verifiedLocalReports = new WeakSet<object>()

function canUseLocalGreetingProof(userId: string): boolean {
  const consensus = getFirebaseIdentityConsensus()
  return (
    consensus.status !== 'pending' &&
    consensus.status !== 'conflicted' &&
    (consensus.status !== 'signed_in' || consensus.userId === userId) &&
    mainTelemetry.canCaptureVerifiedProactiveGreeting(userId)
  )
}

function hasLocalGreetingProof(event: HostedSenderEvent, userId: string): boolean {
  const frame = event && firebaseAuthReporterFrame(event)
  if (!frame) return false
  const entry = findEntryByComfySender(event.sender)
  if (!entry || entry.sourceId !== 'standalone' || !isProactiveGreetingHost(entry, frame.url))
    return false
  const report = getUnverifiedLocalFirebaseSignInReport(event.sender)
  return (
    report?.userId === userId &&
    verifiedLocalReports.has(report) &&
    canUseLocalGreetingProof(userId)
  )
}

async function getProactiveGreetingAdmission(
  event: HostedSenderEvent,
  value: unknown,
  token: unknown
): Promise<ComfyDesktop2ProactiveGreetingAdmission> {
  const userId = normalizePostHogUserId(value)
  if (!userId || userId !== value) return 'denied'
  const frame = firebaseAuthReporterFrame(event)
  const entry = findEntryByComfySender(event.sender)
  if (!frame || !entry || !isProactiveGreetingHost(entry, frame.url)) return 'denied'
  if (
    mainTelemetry.canEnrollProactiveGreeting(userId) &&
    viewsReportingFirebaseUser(userId).includes(event.sender)
  )
    return 'allowed'
  if (entry.sourceId !== 'standalone' || entry.sourceCategory !== 'local') return 'denied'

  const revision = mainTelemetry.getProactiveGreetingConsentRevision()
  const report = getUnverifiedLocalFirebaseSignInReport(event.sender)
  if (revision === null || report?.userId !== userId || !canUseLocalGreetingProof(userId))
    return 'denied'
  if (verifiedLocalReports.has(report)) return 'allowed'
  if (token === undefined) return 'verify-firebase'
  if (typeof token !== 'string' || !token.length || token.length > 16_384) return 'denied'
  if (verifyingLocalViews.has(event.sender)) return 'denied'

  const { processId, routingId } = frame
  const { installationId } = entry
  verifyingLocalViews.add(event.sender)
  try {
    const account = await lookupAccount(getFirebaseConfig('prod').apiKey, token)
    if (
      account.localId !== userId ||
      event.sender.isDestroyed() ||
      mainTelemetry.getProactiveGreetingConsentRevision() !== revision ||
      getUnverifiedLocalFirebaseSignInReport(event.sender) !== report ||
      !canUseLocalGreetingProof(userId)
    )
      return 'denied'
    const currentFrame = event.sender.mainFrame
    if (
      currentFrame.processId !== processId ||
      currentFrame.routingId !== routingId ||
      URL.parse(currentFrame.url)?.origin !== report.origin ||
      findEntryByComfySender(event.sender) !== entry ||
      entry.installationId !== installationId ||
      entry.sourceId !== 'standalone' ||
      !isProactiveGreetingHost(entry, currentFrame.url)
    )
      return 'denied'
    verifiedLocalReports.add(report)
    notifyProactiveGreetingAdmissionChanged(event.sender)
    return 'allowed'
  } catch {
    // The request and response can contain credentials. Reject without logging.
    return 'denied'
  } finally {
    verifyingLocalViews.delete(event.sender)
    const currentReport = getUnverifiedLocalFirebaseSignInReport(event.sender)
    const currentEntry = findEntryByComfySender(event.sender)
    if (
      currentReport &&
      currentEntry &&
      isProactiveGreetingHost(currentEntry, currentReport.origin) &&
      (currentReport !== report || mainTelemetry.getProactiveGreetingConsentRevision() !== revision)
    )
      notifyProactiveGreetingAdmissionChanged(event.sender)
  }
}

function notifyProactiveGreetingAdmissionChanged(contents: WebContents): void {
  if (contents.isDestroyed()) return
  try {
    contents.send('telemetry:proactive-greeting-admission-changed')
  } catch {
    // The hosted view can close before the notification is sent.
  }
}

export function registerTelemetryHandlers(): void {
  let admissionChangeScheduled = false
  function scheduleAdmissionChange(): void {
    if (admissionChangeScheduled) return
    admissionChangeScheduled = true
    queueMicrotask(() => {
      admissionChangeScheduled = false
      for (const entry of comfyWindows.values()) {
        const contents = entry.comfyView.webContents
        if (contents.isDestroyed() || !isProactiveGreetingHost(entry, contents.getURL())) continue
        notifyProactiveGreetingAdmissionChanged(contents)
      }
    })
  }
  mainTelemetry.observeProactiveGreetingAdmissionChanged(scheduleAdmissionChange)
  observeFirebaseIdentityConsensus(scheduleAdmissionChange)

  ipcMain.handle('telemetry:get-proactive-greeting-admission', getProactiveGreetingAdmission)

  ipcMain.handle('telemetry:enroll-proactive-greeting', (event, payload: unknown) => {
    const properties = asProps(payload)
    const attribution = parseProactiveGreetingAttribution('$experiment_exposure', properties)
    if (!attribution) return false
    const eventProperties = withPlatformAxes(properties, event.sender)
    if (isProactiveGreetingSender(event, attribution.userId))
      return mainTelemetry.enrollProactiveGreeting(eventProperties)
    return (
      hasLocalGreetingProof(event, attribution.userId) &&
      mainTelemetry.enrollProactiveGreeting(eventProperties, attribution.userId)
    )
  })

  ipcMain.on('telemetry:capture', (event, payload: CapturePayload) => {
    const eventName = asString(payload?.event)
    if (!eventName) return
    const properties = asProps(payload.properties)
    const attribution = parseProactiveGreetingAttribution(eventName, properties)
    if (attribution === null) return
    const eventProperties = withPlatformAxes(properties, event?.sender)
    if (attribution && !isProactiveGreetingSender(event, attribution.userId)) {
      if (hasLocalGreetingProof(event, attribution.userId))
        mainTelemetry.captureVerifiedProactiveGreeting(
          eventName,
          eventProperties,
          attribution.userId
        )
      return
    }
    mainTelemetry.emit(eventName, eventProperties)
  })

  ipcMain.on('telemetry:captureException', (event, payload: CaptureExceptionPayload) => {
    const message = asString(payload?.message) ?? 'Unknown renderer error'
    const stackStr = asString(payload?.stack)
    const err = new Error(message)
    if (stackStr) err.stack = stackStr
    const properties = withPlatformAxes(asExceptionProps(payload?.properties), event?.sender)
    mainTelemetry.captureExceptionAndForward(err, properties)
  })

  ipcMain.on('telemetry:registerProperties', (_event, properties: unknown) => {
    const props = asPersonProps(properties)
    if (Object.keys(props).length === 0) return
    mainTelemetry.registerPersonProperties(props)
  })

  // Auth consensus validates trusted Cloud and scoped, main-verified loopback
  // reporters after this handler proves the message came from the main frame.
  ipcMain.on('telemetry:firebaseAuthState', (event, payload: unknown) => {
    const frame = firebaseAuthReporterFrame(event)
    if (!frame) return
    const state = asFirebaseAuthState(payload)
    if (!state) return
    const actor = mainTelemetry.getProactiveGreetingActor()
    const wasAdmitted = actor !== null && isProactiveGreetingSender(event, actor)
    const entry = findEntryByComfySender(event.sender)
    const canVerify =
      !!entry && entry.sourceId === 'standalone' && isProactiveGreetingHost(entry, frame.url)
    const previousReport = canVerify ? getUnverifiedLocalFirebaseSignInReport(event.sender) : null
    reportFirebaseAuthState(
      event.sender,
      { processId: frame.processId, routingId: frame.routingId },
      state
    )
    // This view can join or leave the admitted actor without changing process consensus.
    const canVerifyChanged =
      canVerify && getUnverifiedLocalFirebaseSignInReport(event.sender) !== previousReport
    const actorChanged = actor !== null && isProactiveGreetingSender(event, actor) !== wasAdmitted
    if (!admissionChangeScheduled && (canVerifyChanged || actorChanged)) {
      notifyProactiveGreetingAdmissionChanged(event.sender)
    }
  })

  // Flag lookup for renderer A/B branches; awaits the boot fetch so a query
  // landing before it settles still gets the real variant. null → control.
  ipcMain.handle('telemetry:getExperimentFlag', async (_event, key: unknown) => {
    const flagKey = asString(key)
    if (!flagKey) return null
    const value = await getExperimentFlagAsync(flagKey)
    return value === undefined ? null : value
  })

  // Exposure event; per-session dedup is enforced main-side.
  ipcMain.on('telemetry:recordExposure', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    const experimentKey = asString(p.experimentKey)
    const variant = asString(p.variant)
    const sourceStr = asString(p.source)
    if (!experimentKey || !variant) return
    const source: ExperimentExposureSource =
      sourceStr === 'remote' ? 'remote' : sourceStr === 'fallback' ? 'fallback' : 'cache'
    recordExposure(experimentKey, variant, source)
  })
}
