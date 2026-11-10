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
  findEntryByComfySender: mocks.findEntryByComfySender
}))

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

function listener(channel: string): IpcListener {
  const call = mocks.on.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcListener
}

function identityEvent(
  url: string,
  mainFrame: boolean = true,
  equivalentWrapper: boolean = false
): unknown {
  const senderMainFrame = { url, processId: 100, routingId: 200 }
  const sender = { mainFrame: senderMainFrame }
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
    registerTelemetryHandlers()
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
    const gpus = [
      { vendor: 'NVIDIA', model: 'RTX 4090', vram_mb: 24576 },
      { vendor: '', model: 'Microsoft Basic Render Driver', vram_mb: null }
    ]
    listener('telemetry:capture')(null, {
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
    listener('telemetry:capture')(null, {
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
