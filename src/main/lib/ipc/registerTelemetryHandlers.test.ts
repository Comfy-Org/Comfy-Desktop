import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bindUserId: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  findEntryByComfySender: vi.fn(),
  getFlag: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  recordExposure: vi.fn(),
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
  // Real (pure) narrowing logic, mirrored here because importOriginal would
  // pull in telemetry.ts's electron/posthog-node imports under the stub mock.
  asDeployment: (v: unknown) => (v === 'local' || v === 'cloud' || v === 'remote' ? v : null),
  bindUserId: mocks.bindUserId,
  capture: mocks.capture,
  captureException: mocks.captureException,
  registerPersonProperties: mocks.registerPersonProperties
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

  it('tags relayed events with the deployment of the sender comfyView install', () => {
    const sender = { id: 1 }
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'cloud' })

    listener('telemetry:capture')({ sender }, { event: 'execution_start', properties: { a: 1 } })

    expect(mocks.findEntryByComfySender).toHaveBeenCalledWith(sender)
    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent).toEqual({ deployment: 'cloud', a: 1 })
  })

  it('leaves events untagged when the sender is not an attached comfyView', () => {
    mocks.findEntryByComfySender.mockReturnValue(null)

    listener('telemetry:capture')({ sender: { id: 2 } }, { event: 'launcher.click', properties: {} })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.deployment).toBeUndefined()
  })

  it('overwrites a payload deployment with the sender-derived value', () => {
    // A hosted frontend may forward stale posthog-js super properties (e.g. a
    // cloud bundle's deployment=cloud) — main's attachment lookup is the
    // ground truth for which install actually emitted the event.
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'local' })

    listener('telemetry:capture')(
      { sender: { id: 3 } },
      { event: 'execution_start', properties: { deployment: 'cloud' } }
    )

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.deployment).toBe('local')
  })

  it('keeps a payload deployment when the sender is not an attached comfyView', () => {
    mocks.findEntryByComfySender.mockReturnValue(null)

    listener('telemetry:capture')(
      { sender: { id: 5 } },
      { event: 'popout.event', properties: { deployment: 'local' } }
    )

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.deployment).toBe('local')
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

  it('ignores unknown source categories rather than emitting a junk tag', () => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: null })

    listener('telemetry:capture')({ sender: { id: 4 } }, { event: 'execution_start', properties: {} })

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.deployment).toBeUndefined()
  })

  it('strips an invalid payload deployment even from non-comfyView senders', () => {
    mocks.findEntryByComfySender.mockReturnValue(null)

    listener('telemetry:capture')(
      { sender: { id: 7 } },
      { event: 'popout.event', properties: { deployment: 'banana' } }
    )

    const sent = mocks.capture.mock.calls[0]![1] as Record<string, unknown>
    expect(sent.deployment).toBeUndefined()
  })

  it('applies the same platform-axes handling to relayed exceptions', () => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'local' })

    listener('telemetry:captureException')(
      { sender: { id: 8 } },
      { message: 'boom', properties: { client: 'web', deployment: 'cloud' } }
    )

    const [err, sent] = mocks.captureException.mock.calls[0]! as [Error, Record<string, unknown>]
    expect(err.message).toBe('boom')
    expect(sent.deployment).toBe('local')
    expect(sent.client).toBeUndefined()
  })
})
