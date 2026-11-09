import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  captureVerifiedProactiveGreeting: vi.fn(),
  canEnrollProactiveGreeting: vi.fn(() => true),
  canCaptureVerifiedProactiveGreeting: vi.fn(() => true),
  enrollProactiveGreeting: vi.fn(() => true),
  getProactiveGreetingActor: vi.fn<() => string | null>(() => null),
  getProactiveGreetingConsentRevision: vi.fn<() => number | null>(() => 1),
  getUnverifiedLocalFirebaseSignInReport: vi.fn(),
  getFirebaseIdentityConsensus: vi.fn<() => { status: string; userId?: string }>(() => ({
    status: 'unknown'
  })),
  observeFirebaseIdentityConsensus: vi.fn(),
  lookupAccount: vi.fn(),
  observeProactiveGreetingAdmissionChanged: vi.fn(),
  captureExceptionAndForward: vi.fn((_error: unknown, _properties: unknown) => true),
  findEntryByComfySender: vi.fn(),
  comfyWindows: new Map(),
  getFlag: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  recordExposure: vi.fn(),
  reportFirebaseAuthState: vi.fn(),
  viewsReportingFirebaseUser: vi.fn((): unknown[] => []),
  registerPersonProperties: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
    on: mocks.on
  }
}))

vi.mock('../../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender,
  comfyWindows: mocks.comfyWindows
}))

vi.mock('../telemetry', () => ({
  // Real (pure) narrowing logic, mirrored here because importOriginal would
  // pull in telemetry.ts's electron/posthog-node imports under the stub mock.
  asDeployment: (v: unknown) => (v === 'local' || v === 'cloud' || v === 'remote' ? v : null),
  emit: mocks.capture,
  captureVerifiedProactiveGreeting: mocks.captureVerifiedProactiveGreeting,
  canEnrollProactiveGreeting: mocks.canEnrollProactiveGreeting,
  canCaptureVerifiedProactiveGreeting: mocks.canCaptureVerifiedProactiveGreeting,
  enrollProactiveGreeting: mocks.enrollProactiveGreeting,
  getProactiveGreetingActor: mocks.getProactiveGreetingActor,
  getProactiveGreetingConsentRevision: mocks.getProactiveGreetingConsentRevision,
  observeProactiveGreetingAdmissionChanged: mocks.observeProactiveGreetingAdmissionChanged,
  captureExceptionAndForward: mocks.captureExceptionAndForward,
  registerPersonProperties: mocks.registerPersonProperties
}))

vi.mock('../firebaseAuthIdentity', () => ({
  reportFirebaseAuthState: mocks.reportFirebaseAuthState,
  viewsReportingFirebaseUser: mocks.viewsReportingFirebaseUser,
  getUnverifiedLocalFirebaseSignInReport: mocks.getUnverifiedLocalFirebaseSignInReport,
  getFirebaseIdentityConsensus: mocks.getFirebaseIdentityConsensus,
  observeFirebaseIdentityConsensus: mocks.observeFirebaseIdentityConsensus
}))

vi.mock('../../auth/desktopLoginCode/customTokenSignIn', () => ({
  lookupAccount: mocks.lookupAccount
}))

vi.mock('../experiments', () => ({
  getFlag: mocks.getFlag,
  recordExposure: mocks.recordExposure
}))

import { registerTelemetryHandlers } from './registerTelemetryHandlers'

type IpcListener = (_event: unknown, payload: unknown) => void

function listener(channel: string): IpcListener {
  const call = mocks.on.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcListener
}

function handler<Result = boolean>(
  channel: string
): (event: unknown, payload: unknown, token?: unknown) => Result {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1]
}

const getAdmission = () => handler<Promise<string>>('telemetry:get-proactive-greeting-admission')

const experimentProperties = {
  proactive_greeting_user_id: 'user-a',
  proactive_greeting_workspace_id: 'workspace-a',
  proactive_greeting_group_key: '["user-a","workspace-a"]',
  proactive_greeting_variant: 'generic',
  canvas_state: 'workflow',
  copy_locale: 'en'
}

const standaloneHost = {
  installationId: 'i',
  sourceCategory: 'local',
  sourceId: 'standalone',
  comfyUrl: 'http://127.0.0.1:8000/'
}

function identityEvent(
  url: string,
  mainFrame: boolean = true,
  equivalentWrapper: boolean = false
): unknown {
  const senderMainFrame = { url, processId: 100, routingId: 200 }
  const sender = {
    mainFrame: senderMainFrame,
    getURL: () => url,
    isDestroyed: () => false,
    send: vi.fn()
  }
  return {
    sender,
    senderFrame: mainFrame
      ? equivalentWrapper
        ? { ...senderMainFrame }
        : senderMainFrame
      : { url, processId: 101, routingId: 201 }
  }
}

describe('registerTelemetryHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.comfyWindows.clear()
    mocks.getProactiveGreetingActor.mockReturnValue(null)
    mocks.getProactiveGreetingConsentRevision.mockReturnValue(1)
    mocks.getUnverifiedLocalFirebaseSignInReport.mockReset().mockReturnValue(null)
    mocks.getFirebaseIdentityConsensus.mockReturnValue({ status: 'unknown' })
    mocks.lookupAccount.mockReset()
    registerTelemetryHandlers()
  })

  it('admits flat pair attribution only from the main frame of its authenticated hosted view', () => {
    const event = identityEvent('https://cloud.comfy.org/') as { sender: unknown }
    const properties = experimentProperties
    mocks.findEntryByComfySender.mockReturnValue({ installationId: 'i', sourceCategory: 'cloud' })
    mocks.viewsReportingFirebaseUser.mockReturnValue([event.sender])
    listener('telemetry:capture')(event, { event: '$experiment_exposure', properties })
    expect(mocks.capture).toHaveBeenCalledWith('$experiment_exposure', {
      ...properties,
      deployment: 'cloud'
    })
    mocks.capture.mockClear()
    mocks.viewsReportingFirebaseUser.mockReturnValue([])
    listener('telemetry:capture')(event, { event: '$experiment_exposure', properties })
    expect(mocks.capture).not.toHaveBeenCalled()
    mocks.viewsReportingFirebaseUser.mockReturnValue([event.sender])
    listener('telemetry:capture')(
      { ...event, senderFrame: null },
      { event: '$experiment_exposure', properties }
    )
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('rejects malformed or incomplete experiment events before the generic relay', () => {
    listener('telemetry:capture')(null, {
      event: '$experiment_exposure',
      properties: {
        $feature_flag: 'agent-proactive-greeting-v1'
      }
    })
    listener('telemetry:capture')(null, {
      event: 'app:agent_message_sent',
      properties: {
        proactive_greeting_user_id: 'user-a'
      }
    })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('answers enrollment eligibility only for the authenticated hosted main-frame actor', async () => {
    const admission = getAdmission()
    const event = identityEvent('https://cloud.comfy.org/') as { sender: unknown }
    mocks.findEntryByComfySender.mockReturnValue({ installationId: 'i', sourceCategory: 'cloud' })
    mocks.viewsReportingFirebaseUser.mockReturnValue([event.sender])
    mocks.canEnrollProactiveGreeting.mockReturnValue(true)
    expect(await admission(event, 'user-a')).toBe('allowed')
    expect(await admission(event, ' user-a ')).toBe('denied')
    expect(await admission({ ...event, senderFrame: null }, 'user-a')).toBe('denied')
    mocks.canEnrollProactiveGreeting.mockReturnValue(false)
    expect(await admission(event, 'user-a')).toBe('denied')
    mocks.canEnrollProactiveGreeting.mockReturnValue(true)
    mocks.viewsReportingFirebaseUser.mockReturnValue([])
    expect(await admission(event, 'user-a', 'unused-token')).toBe('denied')
    expect(mocks.lookupAccount).not.toHaveBeenCalled()
  })

  it('returns the actual main admission result for a valid exposure with effective copy locale', () => {
    const enroll = handler('telemetry:enroll-proactive-greeting')
    const event = identityEvent('http://127.0.0.1:8000/graph') as { sender: unknown }
    mocks.findEntryByComfySender.mockReturnValue(standaloneHost)
    mocks.viewsReportingFirebaseUser.mockReturnValue([event.sender])
    mocks.enrollProactiveGreeting.mockReturnValueOnce(false).mockReturnValueOnce(true)
    expect(enroll(event, experimentProperties)).toBe(false)
    expect(enroll(event, experimentProperties)).toBe(true)
    expect(mocks.enrollProactiveGreeting).toHaveBeenLastCalledWith({
      ...experimentProperties,
      deployment: 'local'
    })
    expect(enroll(event, {})).toBe(false)
    expect(enroll({ ...event, senderFrame: null }, experimentProperties)).toBe(false)
    expect(mocks.enrollProactiveGreeting).toHaveBeenCalledTimes(2)
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('requests proof only for a consented standalone view reporting the requested Firebase UID', async () => {
    const event = identityEvent(standaloneHost.comfyUrl) as { sender: unknown }
    const report = { userId: 'user-a', origin: 'http://127.0.0.1:8000' }
    mocks.findEntryByComfySender.mockReturnValue(standaloneHost)
    mocks.viewsReportingFirebaseUser.mockReturnValue([])
    const admission = getAdmission()

    expect(await admission(event, 'user-a', 'unused-token')).toBe('denied')
    mocks.getUnverifiedLocalFirebaseSignInReport.mockReturnValue(report)
    expect(await admission(event, 'other-user', 'unused-token')).toBe('denied')
    mocks.getProactiveGreetingConsentRevision.mockReturnValue(null)
    expect(await admission(event, 'user-a', 'unused-token')).toBe('denied')
    mocks.getProactiveGreetingConsentRevision.mockReturnValue(1)
    expect(await admission(event, 'user-a')).toBe('verify-firebase')
    expect(mocks.lookupAccount).not.toHaveBeenCalled()

    mocks.lookupAccount.mockResolvedValueOnce({ localId: 'wrong-user' })
    expect(await admission(event, 'user-a', 'wrong-token')).toBe('denied')
    expect(await admission(event, 'user-a')).toBe('verify-firebase')

    mocks.lookupAccount.mockResolvedValueOnce({ localId: 'user-a' })
    expect(await admission(event, 'user-a', 'valid-token')).toBe('allowed')
    expect(await admission(event, 'user-a')).toBe('allowed')
    expect(mocks.reportFirebaseAuthState).not.toHaveBeenCalled()

    const scopedProperties = { ...experimentProperties, deployment: 'local' }
    expect(handler('telemetry:enroll-proactive-greeting')(event, experimentProperties)).toBe(true)
    expect(mocks.enrollProactiveGreeting).toHaveBeenCalledWith(scopedProperties, 'user-a')
    listener('telemetry:capture')(event, {
      event: 'app:agent_message_sent',
      properties: experimentProperties
    })
    expect(mocks.captureVerifiedProactiveGreeting).toHaveBeenCalledWith(
      'app:agent_message_sent',
      scopedProperties,
      'user-a'
    )
    listener('telemetry:capture')(event, { event: 'ordinary:event' })
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith('ordinary:event', { deployment: 'local' })
  })

  it.each(['new report', 'new consent revision', 'conflicting consensus'])(
    'denies a delayed proof after a %s even when the user and consent values match',
    async (change) => {
      const event = identityEvent(standaloneHost.comfyUrl)
      const report = { userId: 'user-a', origin: 'http://127.0.0.1:8000' }
      mocks.findEntryByComfySender.mockReturnValue(standaloneHost)
      mocks.viewsReportingFirebaseUser.mockReturnValue([])
      mocks.getUnverifiedLocalFirebaseSignInReport.mockReturnValue(report)
      const lookup = Promise.withResolvers<{ localId: string }>()
      mocks.lookupAccount.mockReturnValueOnce(lookup.promise)
      const result = getAdmission()(event, 'user-a', 'valid-token')
      expect(mocks.lookupAccount).toHaveBeenCalledTimes(1)
      if (change === 'new report') {
        mocks.getUnverifiedLocalFirebaseSignInReport.mockReturnValue({ ...report })
      } else if (change === 'new consent revision') {
        mocks.getProactiveGreetingConsentRevision.mockReturnValue(2)
      } else {
        mocks.getFirebaseIdentityConsensus.mockReturnValue({ status: 'conflicted' })
      }
      lookup.resolve({ localId: 'user-a' })
      expect(await result).toBe('denied')
      expect(handler('telemetry:enroll-proactive-greeting')(event, experimentProperties)).toBe(
        false
      )
    }
  )

  it('invalidates a denied probe when the first unverified Local Firebase report arrives', async () => {
    const event = identityEvent(standaloneHost.comfyUrl) as { sender: { send: unknown } }
    const report = { userId: 'user-a', origin: 'http://127.0.0.1:8000' }
    mocks.findEntryByComfySender.mockReturnValue(standaloneHost)
    mocks.viewsReportingFirebaseUser.mockReturnValue([])
    const admission = getAdmission()
    expect(await admission(event, 'user-a')).toBe('denied')
    mocks.reportFirebaseAuthState.mockImplementationOnce(() => {
      mocks.getUnverifiedLocalFirebaseSignInReport.mockReturnValue(report)
    })
    listener('telemetry:firebaseAuthState')(event, { status: 'signed_in', userId: 'user-a' })
    expect(event.sender.send).toHaveBeenCalledExactlyOnceWith(
      'telemetry:proactive-greeting-admission-changed'
    )
    expect(await admission(event, 'user-a')).toBe('verify-firebase')
    expect(mocks.lookupAccount).not.toHaveBeenCalled()
  })

  it.each([
    {
      installationId: null,
      sourceId: 'standalone',
      sourceCategory: 'local',
      comfyUrl: 'http://127.0.0.1:8000/'
    },
    {
      installationId: 'i',
      sourceId: 'portable',
      sourceCategory: 'local',
      comfyUrl: 'http://127.0.0.1:8000/'
    },
    {
      installationId: 'i',
      sourceId: 'git',
      sourceCategory: 'local',
      comfyUrl: 'http://127.0.0.1:8000/'
    },
    { installationId: 'i', sourceCategory: 'remote', comfyUrl: 'http://127.0.0.1:8000/' },
    {
      installationId: 'i',
      sourceId: 'standalone',
      sourceCategory: 'local',
      comfyUrl: 'http://127.0.0.1:9000/'
    },
    { installationId: 'i', sourceCategory: 'cloud', comfyUrl: 'http://127.0.0.1:8000/' }
  ])('denies experiment IPC from a view outside the managed host scope %j', async (entry) => {
    const event = identityEvent('http://127.0.0.1:8000/') as { sender: unknown }
    mocks.findEntryByComfySender.mockReturnValue(entry)
    mocks.viewsReportingFirebaseUser.mockReturnValue([event.sender])
    expect(await getAdmission()(event, 'user-a', 'unused-token')).toBe('denied')
    expect(handler('telemetry:enroll-proactive-greeting')(event, experimentProperties)).toBe(false)
    listener('telemetry:capture')(event, {
      event: '$experiment_exposure',
      properties: experimentProperties
    })
    expect(mocks.enrollProactiveGreeting).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.lookupAccount).not.toHaveBeenCalled()
  })

  it('invalidates supported hosted views after main admission or view identity changes', async () => {
    const url = 'https://cloud.comfy.org/'
    const event = identityEvent(url) as { sender: object }
    const send = vi.fn()
    const remoteSend = vi.fn()
    Object.assign(event.sender, { isDestroyed: () => false, getURL: () => url, send })
    const entry = {
      installationId: 'cloud-i',
      sourceCategory: 'cloud',
      comfyView: { webContents: event.sender }
    }
    mocks.comfyWindows.set(1, entry)
    mocks.comfyWindows.set(2, {
      installationId: 'remote-i',
      sourceCategory: 'remote',
      comfyView: { webContents: { isDestroyed: () => false, getURL: () => url, send: remoteSend } }
    })

    const mainAdmissionChanged = mocks.observeProactiveGreetingAdmissionChanged.mock.calls[0]![0]
    mainAdmissionChanged()
    await Promise.resolve()
    expect(send).toHaveBeenCalledExactlyOnceWith('telemetry:proactive-greeting-admission-changed')
    expect(remoteSend).not.toHaveBeenCalled()

    send.mockClear()
    mocks.findEntryByComfySender.mockReturnValue(entry)
    mocks.getProactiveGreetingActor.mockReturnValue('user-a')
    mocks.viewsReportingFirebaseUser.mockReturnValue([])
    mocks.reportFirebaseAuthState.mockImplementationOnce(() => {
      mocks.viewsReportingFirebaseUser.mockReturnValue([event.sender])
    })
    listener('telemetry:firebaseAuthState')(event, { status: 'signed_in', userId: 'user-a' })
    await Promise.resolve()
    expect(send).toHaveBeenCalledExactlyOnceWith('telemetry:proactive-greeting-admission-changed')
    expect(remoteSend).not.toHaveBeenCalled()
  })

  it('caps event property keys, arrays, and strings', () => {
    const properties: Record<string, unknown> = {
      long: 'x'.repeat(3000),
      model_paths: Array.from({ length: 200 }, (_, i) => (i === 0 ? 'y'.repeat(3000) : i))
    }
    for (let i = 0; i < 200; i++) properties[`key_${i}`] = i

    listener('telemetry:capture')(null, { event: 'comfy.desktop.test', properties })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(Object.keys(sent)).toHaveLength(128)
    expect(sent.long).toBe('x'.repeat(2048))
    expect(sent.key_125).toBe(125)
    expect(sent.key_126).toBeUndefined()

    const paths = sent.model_paths as unknown[]
    expect(paths).toHaveLength(128)
    expect(paths[0]).toBe('y'.repeat(2048))
    expect(paths[127]).toBe(127)
  })

  it('drops arrays of objects but preserves a JSON-stringified payload', () => {
    // Contract relied on by the `system_info` / `installs_inventory` telemetry:
    // a native array of objects cannot survive the bridge, so callers serialize
    // it to a JSON string instead.
    const gpus = [
      { vendor: 'NVIDIA', model: 'RTX 4090', vram_mb: 24576 },
      { vendor: '', model: 'Microsoft Basic Render Driver', vram_mb: null }
    ]
    listener('telemetry:capture')(null, {
      event: 'comfy.desktop.session.system_info',
      properties: {
        gpu_count: gpus.length,
        gpus, // native array of objects — expected to be dropped
        gpus_json: JSON.stringify(gpus) // string — expected to survive
      }
    })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.gpu_count).toBe(2)
    expect(sent.gpus).toBeUndefined()
    expect(JSON.parse(sent.gpus_json as string)).toEqual(gpus)
  })

  it('gives allow-listed JSON keys a larger ceiling, clamps everything else', () => {
    // A serialized structured payload (e.g. `installs_json`) legitimately
    // exceeds the 2048 scalar clamp; allow-listed JSON keys get a larger
    // ceiling so they survive intact. Any other field — including one that just
    // mimics the `_json` suffix — stays tightly clamped, so a renderer can't
    // bypass the PII/runaway-size limit by renaming a field.
    const big = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: i, name: `n${i}` })))
    expect(big.length).toBeGreaterThan(2048)
    listener('telemetry:capture')(null, {
      event: 'comfy.desktop.session.installs_inventory',
      properties: {
        installs_json: big, // allow-listed
        sneaky_json: 'q'.repeat(3000), // mimics the suffix but not allow-listed
        plain_long: 'z'.repeat(3000)
      }
    })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.installs_json).toBe(big) // survives untouched
    expect(sent.sneaky_json).toBe('q'.repeat(2048)) // clamped — not allow-listed
    expect(sent.plain_long).toBe('z'.repeat(2048)) // clamped
  })

  it('keeps person properties scalar-only while applying the same caps', () => {
    const properties: Record<string, unknown> = {
      array: [1, 2, 3],
      long: 'x'.repeat(3000),
      // The larger `_json` ceiling is event-only: person records are capped at
      // 512 KB total by PostHog, so `_json` person props stay clamped to 2048.
      blob_json: 'j'.repeat(3000)
    }
    for (let i = 0; i < 200; i++) properties[`key_${i}`] = i

    listener('telemetry:registerProperties')(null, properties)

    const sent = mocks.registerPersonProperties.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(sent)).toHaveLength(127)
    expect(sent.array).toBeUndefined()
    expect(sent.long).toBe('x'.repeat(2048))
    expect(sent.blob_json).toBe('j'.repeat(2048))
    expect(sent.key_124).toBe(124)
    expect(sent.key_125).toBeUndefined()
  })

  it('accepts declarative auth state from Cloud main frames', () => {
    const signedInEvent = identityEvent('https://cloud.comfy.org/workspaces/abc')
    const signedOutEvent = identityEvent('https://pr-123.testingcloud.comfy.org/workspaces/abc')
    listener('telemetry:firebaseAuthState')(signedInEvent, {
      status: 'signed_in',
      userId: ' firebase-uid-123 '
    })
    listener('telemetry:firebaseAuthState')(signedOutEvent, { status: 'signed_out' })

    expect(mocks.reportFirebaseAuthState).toHaveBeenNthCalledWith(
      1,
      (signedInEvent as { sender: unknown }).sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_in', userId: 'firebase-uid-123' }
    )
    expect(mocks.reportFirebaseAuthState).toHaveBeenNthCalledWith(
      2,
      (signedOutEvent as { sender: unknown }).sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_out' }
    )
  })

  it('accepts an equivalent main-frame wrapper and rejects a different frame identity', () => {
    const equivalentMainFrame = identityEvent('https://cloud.comfy.org/workspaces/abc', true, true)
    listener('telemetry:firebaseAuthState')(equivalentMainFrame, { status: 'signed_out' })
    listener('telemetry:firebaseAuthState')(
      identityEvent('https://cloud.comfy.org/workspaces/abc', false),
      { status: 'signed_out' }
    )

    expect(mocks.reportFirebaseAuthState).toHaveBeenCalledTimes(1)
    expect(mocks.reportFirebaseAuthState).toHaveBeenCalledWith(
      (equivalentMainFrame as { sender: unknown }).sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_out' }
    )
  })

  it('rejects PostHog-illegal Firebase UIDs at the IPC boundary', () => {
    listener('telemetry:firebaseAuthState')(
      identityEvent('https://cloud.comfy.org/workspaces/abc'),
      { status: 'signed_in', userId: 'anonymous' }
    )

    expect(mocks.reportFirebaseAuthState).not.toHaveBeenCalled()
  })

  it('forwards main frames for auth-scope validation and rejects subframes or malformed payloads', () => {
    const fileEvent = identityEvent('file:///launcher/index.html')
    const remoteEvent = identityEvent('https://attacker.example/')
    listener('telemetry:firebaseAuthState')(fileEvent, {
      status: 'signed_in',
      userId: 'local-user'
    })
    listener('telemetry:firebaseAuthState')(remoteEvent, {
      status: 'signed_out'
    })
    listener('telemetry:firebaseAuthState')(identityEvent('https://cloud.comfy.org/', false), {
      status: 'pending'
    })
    listener('telemetry:firebaseAuthState')(identityEvent('https://cloud.comfy.org/'), {
      status: 'signed_in',
      userId: '\u0000invalid'
    })
    listener('telemetry:firebaseAuthState')(identityEvent('https://cloud.comfy.org/'), {
      status: 'unknown'
    })

    expect(mocks.reportFirebaseAuthState).toHaveBeenCalledTimes(2)
    expect(mocks.reportFirebaseAuthState).toHaveBeenNthCalledWith(
      1,
      (fileEvent as { sender: unknown }).sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_in', userId: 'local-user' }
    )
    expect(mocks.reportFirebaseAuthState).toHaveBeenNthCalledWith(
      2,
      (remoteEvent as { sender: unknown }).sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_out' }
    )
  })

  it.each([
    // [case, attached comfyView entry, payload properties, expected capture properties]
    // Main's attachment lookup is the ground truth for which install actually
    // emitted an event — a hosted frontend may forward stale posthog-js super
    // properties (e.g. a cloud bundle's deployment=cloud).
    [
      'tags relayed events with the deployment of the sender comfyView install',
      { sourceCategory: 'cloud' },
      { a: 1 },
      { deployment: 'cloud', a: 1 }
    ],
    [
      'leaves events untagged when the sender is not an attached comfyView',
      null,
      { a: 1 },
      { a: 1 }
    ],
    [
      'overwrites a payload deployment with the sender-derived value',
      { sourceCategory: 'local' },
      { deployment: 'cloud' },
      { deployment: 'local' }
    ],
    [
      'keeps a payload deployment when the sender is not an attached comfyView',
      null,
      { deployment: 'local' },
      { deployment: 'local' }
    ],
    [
      'ignores unknown source categories rather than emitting a junk tag',
      { sourceCategory: null },
      {},
      {}
    ],
    [
      'strips an invalid payload deployment even from non-comfyView senders',
      null,
      { deployment: 'banana' },
      {}
    ]
  ])('%s', (_case, entry, properties, expectedSent) => {
    const sender = { id: 1 }
    mocks.findEntryByComfySender.mockReturnValue(entry)

    listener('telemetry:capture')({ sender }, { event: 'execution_start', properties })

    expect(mocks.findEntryByComfySender).toHaveBeenCalledWith(sender)
    expect(mocks.capture.mock.calls[0]![1]).toEqual(expectedSent)
  })

  it('strips a payload client so the SDK default (desktop) applies', () => {
    mocks.findEntryByComfySender.mockReturnValue(null)

    listener('telemetry:capture')(
      { sender: { id: 6 } },
      { event: 'execution_start', properties: { client: 'web', a: 1 } }
    )

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.client).toBeUndefined()
    expect(sent.a).toBe(1)
  })

  it('applies the same platform-axes handling to relayed exceptions', () => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'local' })

    listener('telemetry:captureException')(
      { sender: { id: 8 } },
      {
        message: 'boom',
        stack: 'Error: boom\n at app.ts:1:1',
        properties: {
          client: 'web',
          deployment: 'cloud',
          error_type: 'workspace_auth_gate_initialization_failure'
        }
      }
    )

    const [err, sent] = mocks.captureExceptionAndForward.mock.calls[0]! as [
      Error,
      Record<string, unknown>
    ]
    expect(err.message).toBe('boom')
    expect(err.stack).toBe('Error: boom\n at app.ts:1:1')
    expect(sent.error_type).toBe('workspace_auth_gate_initialization_failure')
    expect(sent.deployment).toBe('local')
    expect(sent.client).toBeUndefined()
  })

  it('scrubs exception properties before applying string limits', () => {
    const secret = `password="${'private words '.repeat(200)}"`
    listener('telemetry:captureException')(
      { sender: { id: 8 } },
      { message: 'boom', properties: { detail: secret, nested: { secret } } }
    )

    const [, sent] = mocks.captureExceptionAndForward.mock.calls[0]! as [
      Error,
      Record<string, unknown>
    ]
    expect(sent.detail).toBe('password=[REDACTED]')
    expect(sent.nested).toBeUndefined()
  })
})
