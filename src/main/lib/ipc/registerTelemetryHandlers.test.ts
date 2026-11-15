import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  captureExceptionAndForward: vi.fn((_error: unknown, _properties: unknown) => true),
  findEntryByComfySender: vi.fn(),
  getFlag: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  recordExposure: vi.fn(),
  reportFirebaseAuthState: vi.fn(),
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
  findEntryByTitleBarSender: () => null,
  isPanelSender: (sender: unknown) => sender === PANEL
}))

vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => false }))
vi.mock('../embeddedSession', () => ({ isTrustedSender: () => false }))
vi.mock('../logsPopoutWindow', () => ({ findLogsPopoutInstallationIdBySender: () => null }))

vi.mock('../telemetry', () => ({
  asDeployment: (v: unknown) => (v === 'local' || v === 'cloud' || v === 'remote' ? v : null),
  emit: mocks.capture,
  captureExceptionAndForward: mocks.captureExceptionAndForward,
  registerPersonProperties: mocks.registerPersonProperties
}))

vi.mock('../firebaseAuthIdentity', () => ({
  reportFirebaseAuthState: mocks.reportFirebaseAuthState
}))

vi.mock('../experiments', () => ({
  getFlag: mocks.getFlag,
  recordExposure: mocks.recordExposure
}))

import { registerTelemetryHandlers } from './registerTelemetryHandlers'

type IpcListener = (_event: unknown, payload: unknown) => void
type PageEvent = { sender: unknown; senderFrame: unknown }

const PANEL = { id: 'panel' }
const FROM_PANEL: PageEvent = { sender: PANEL, senderFrame: null }
const INSTALL_URL = 'http://127.0.0.1:8188'

function installOf(sender: unknown): unknown {
  return (sender as { install?: unknown } | null)?.install ?? null
}

function installPageEvent(install: Record<string, unknown> = {}): PageEvent {
  return identityEvent(`${INSTALL_URL}/`, true, false, {
    installationId: 'inst-1',
    comfyUrl: INSTALL_URL,
    ...install
  })
}

function listener(channel: string): IpcListener {
  const call = mocks.on.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcListener
}

function identityEvent(
  url: string,
  mainFrame: boolean = true,
  equivalentWrapper: boolean = false,
  install: Record<string, unknown> = { installationId: 'inst-1', comfyUrl: url }
): PageEvent {
  const senderMainFrame = { url, processId: 100, routingId: 200 }
  const sender = { mainFrame: senderMainFrame, install }
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
    mocks.findEntryByComfySender.mockReset()
    mocks.findEntryByComfySender.mockImplementation(installOf)
    registerTelemetryHandlers()
  })

  it('caps event property keys, arrays, and strings', () => {
    const properties: Record<string, unknown> = {
      long: 'x'.repeat(3000),
      model_paths: Array.from({ length: 200 }, (_, i) => (i === 0 ? 'y'.repeat(3000) : i))
    }
    for (let i = 0; i < 200; i++) properties[`key_${i}`] = i

    listener('telemetry:capture')(FROM_PANEL, { event: 'comfy.desktop.test', properties })

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
    const gpus = [
      { vendor: 'NVIDIA', model: 'RTX 4090', vram_mb: 24576 },
      { vendor: '', model: 'Microsoft Basic Render Driver', vram_mb: null }
    ]
    listener('telemetry:capture')(FROM_PANEL, {
      event: 'comfy.desktop.session.system_info',
      properties: {
        gpu_count: gpus.length,
        gpus,
        gpus_json: JSON.stringify(gpus)
      }
    })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.gpu_count).toBe(2)
    expect(sent.gpus).toBeUndefined()
    expect(JSON.parse(sent.gpus_json as string)).toEqual(gpus)
  })

  it('gives allow-listed JSON keys a larger ceiling, clamps everything else', () => {
    const big = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: i, name: `n${i}` })))
    expect(big.length).toBeGreaterThan(2048)
    listener('telemetry:capture')(FROM_PANEL, {
      event: 'comfy.desktop.session.installs_inventory',
      properties: {
        installs_json: big,
        sneaky_json: 'q'.repeat(3000),
        plain_long: 'z'.repeat(3000)
      }
    })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.installs_json).toBe(big)
    expect(sent.sneaky_json).toBe('q'.repeat(2048))
    expect(sent.plain_long).toBe('z'.repeat(2048))
  })

  it('keeps person properties scalar-only while applying the same caps', () => {
    const properties: Record<string, unknown> = {
      array: [1, 2, 3],
      long: 'x'.repeat(3000),
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
      signedInEvent.sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_in', userId: 'firebase-uid-123' }
    )
    expect(mocks.reportFirebaseAuthState).toHaveBeenNthCalledWith(
      2,
      signedOutEvent.sender,
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
      equivalentMainFrame.sender,
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

  it("forwards the install's own page for auth-scope validation and drops other sites, subframes and malformed payloads", () => {
    const localEvent = installPageEvent()
    const remoteEvent = identityEvent('https://remote.example.test/')
    listener('telemetry:firebaseAuthState')(localEvent, {
      status: 'signed_in',
      userId: 'local-user'
    })
    listener('telemetry:firebaseAuthState')(remoteEvent, {
      status: 'signed_out'
    })
    listener('telemetry:firebaseAuthState')(
      identityEvent('https://attacker.example/', true, false, {
        installationId: 'inst-1',
        comfyUrl: 'https://cloud.comfy.org/'
      }),
      { status: 'signed_out' }
    )
    listener('telemetry:firebaseAuthState')(identityEvent('file:///launcher/index.html'), {
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
      localEvent.sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_in', userId: 'local-user' }
    )
    expect(mocks.reportFirebaseAuthState).toHaveBeenNthCalledWith(
      2,
      remoteEvent.sender,
      { processId: 100, routingId: 200 },
      { status: 'signed_out' }
    )
  })

  it.each([
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
    const event = entry ? installPageEvent(entry) : FROM_PANEL

    listener('telemetry:capture')(event, { event: 'execution_start', properties })

    expect(mocks.findEntryByComfySender).toHaveBeenCalledWith(event.sender)
    expect(mocks.capture.mock.calls[0]![1]).toEqual(expectedSent)
  })

  it('takes nothing from a ComfyUI view that shows another site', () => {
    const elsewhere = identityEvent('https://elsewhere.example.test/', true, false, {
      installationId: 'inst-1',
      comfyUrl: INSTALL_URL,
      sourceCategory: 'local'
    })

    listener('telemetry:capture')(elsewhere, { event: 'execution_start', properties: { a: 1 } })
    listener('telemetry:captureException')(elsewhere, { message: 'boom' })

    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.captureExceptionAndForward).not.toHaveBeenCalled()
  })

  it('strips a payload client so the SDK default (desktop) applies', () => {
    listener('telemetry:capture')(FROM_PANEL, {
      event: 'execution_start',
      properties: { client: 'web', a: 1 }
    })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.client).toBeUndefined()
    expect(sent.a).toBe(1)
  })

  it('applies the same platform-axes handling to relayed exceptions', () => {
    listener('telemetry:captureException')(installPageEvent({ sourceCategory: 'local' }), {
      message: 'boom',
      stack: 'Error: boom\n at app.ts:1:1',
      properties: {
        client: 'web',
        deployment: 'cloud',
        error_type: 'workspace_auth_gate_initialization_failure'
      }
    })

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
    listener('telemetry:captureException')(FROM_PANEL, {
      message: 'boom',
      properties: { detail: secret, nested: { secret } }
    })

    const [, sent] = mocks.captureExceptionAndForward.mock.calls[0]! as [
      Error,
      Record<string, unknown>
    ]
    expect(sent.detail).toBe('password=[REDACTED]')
    expect(sent.nested).toBeUndefined()
  })
})
