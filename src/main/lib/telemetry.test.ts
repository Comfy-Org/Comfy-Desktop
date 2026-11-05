import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import type { TelemetryValue } from './telemetry'
import { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST } from '../../shared/posthogConfig'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: true,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

function makeStubWebContents(): {
  wc: Electron.WebContents
  sends: { channel: string; data: unknown }[]
  destroy: () => void
} {
  const sends: { channel: string; data: unknown }[] = []
  let destroyed = false
  const ee = new EventEmitter()
  const wc = {
    isDestroyed: () => destroyed,
    send: (channel: string, data: unknown) => sends.push({ channel, data }),
    once: (event: string, cb: () => void) => {
      ee.once(event, cb)
    }
  } as unknown as Electron.WebContents
  return {
    wc,
    sends,
    destroy: () => {
      destroyed = true
      ee.emit('destroyed')
    }
  }
}

interface CapturedCall {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
  timestamp?: Date
}
const captured: CapturedCall[] = []

interface IdentifyCall {
  distinctId: string
  properties?: {
    $set?: Record<string, unknown>
    $set_once?: Record<string, unknown>
    $anon_distinct_id?: string
  }
}
const identifies: IdentifyCall[] = []

interface ExceptionCall {
  error: unknown
  distinctId: string
  properties?: Record<string, unknown>
}
const exceptions: ExceptionCall[] = []
interface FlagEvaluationOptions {
  sendFeatureFlagEvents?: boolean
  personProperties?: Record<string, string>
}
const featureFlagResultCalls: Array<{
  key: string
  distinctId: string
  options?: FlagEvaluationOptions
}> = []
const posthogConstructorCalls: Array<{ apiKey: string; options: Record<string, unknown> }> = []

const posthogClientMock = vi.hoisted(() => ({
  failNextCaptures: 0,
  failNextFlushes: 0,
  autoFailNextIdentifies: 0,
  featureFlagResult: undefined as
    | { enabled: boolean; variant?: string; payload?: unknown }
    | undefined,
  featureFlagBehavior: 'resolve' as 'resolve' | 'throw' | 'hang' | 'defer',
  evaluateCondition: undefined as
    | ((options?: {
        personProperties?: Record<string, string>
      }) => { enabled: boolean; variant?: string; payload?: unknown } | undefined)
    | undefined,
  deferred: null as {
    resolve: (value: { enabled: boolean; variant?: string; payload?: unknown } | undefined) => void
    reject: (reason: unknown) => void
  } | null
}))

vi.mock('posthog-node', () => ({
  PostHog: class {
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    private queuedIdentifies: Array<Record<string, unknown>> = []

    constructor(apiKey: string, options: Record<string, unknown>) {
      posthogConstructorCalls.push({ apiKey, options })
    }

    on(event: string, listener: (...args: unknown[]) => void): () => void {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return () => listeners.delete(listener)
    }
    private emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
    capture(call: CapturedCall): void {
      if (posthogClientMock.failNextCaptures > 0) {
        posthogClientMock.failNextCaptures--
        throw new Error('sdk rejected capture')
      }
      captured.push(call)
    }
    identify(call: IdentifyCall): void {
      identifies.push(call)
      if (posthogClientMock.autoFailNextIdentifies > 0) {
        posthogClientMock.autoFailNextIdentifies--
        queueMicrotask(() => this.emit('error', new Error('auto-flush failed')))
        return
      }
      this.queuedIdentifies.push({
        event: '$identify',
        distinct_id: call.distinctId,
        properties: call.properties
      })
    }
    captureException(
      error: unknown,
      distinctId: string,
      properties?: Record<string, unknown>
    ): void {
      exceptions.push({ error, distinctId, properties })
    }
    flush(): Promise<void> {
      if (posthogClientMock.failNextFlushes > 0) {
        posthogClientMock.failNextFlushes--
        this.queuedIdentifies = []
        this.emit('error', new Error('offline'))
        return Promise.reject(new Error('offline'))
      }
      const sent = this.queuedIdentifies
      this.queuedIdentifies = []
      if (sent.length > 0) this.emit('flush', sent)
      return Promise.resolve()
    }
    shutdown(): Promise<void> {
      return Promise.resolve()
    }
    getFeatureFlagResult(
      key: string,
      distinctId: string,
      options?: FlagEvaluationOptions
    ): Promise<{ enabled: boolean; variant?: string; payload?: unknown } | undefined> {
      featureFlagResultCalls.push({ key, distinctId, options })
      if (posthogClientMock.evaluateCondition) {
        return Promise.resolve(posthogClientMock.evaluateCondition(options))
      }
      if (posthogClientMock.featureFlagBehavior === 'throw') {
        return Promise.reject(new Error('flag evaluation failed'))
      }
      if (posthogClientMock.featureFlagBehavior === 'hang') return new Promise(() => {})
      if (posthogClientMock.featureFlagBehavior === 'defer') {
        return new Promise((resolve, reject) => {
          posthogClientMock.deferred = { resolve, reject }
        })
      }
      return Promise.resolve(posthogClientMock.featureFlagResult)
    }
  }
}))

const anonymousIdentityMock = vi.hoisted(() => ({
  rotations: ['anonymous-next-1', 'anonymous-next-2', 'anonymous-next-3'],
  index: 0,
  fail: false
}))

const pendingIdentityMergeMock = vi.hoisted(() => ({
  entries: [] as Array<{
    id: string
    anonymousId: string
    userId: string
    nextAnonymousId: string
    installationId: string
    personSet: Record<string, boolean | number | string | null>
    personSetOnce?: Record<string, boolean | number | string | null>
  }>,
  nextId: 1
}))

vi.mock('./anonymousIdentity', () => ({
  rotatePersistedAnonymousDistinctId: () => {
    if (anonymousIdentityMock.fail) return null
    return anonymousIdentityMock.rotations[anonymousIdentityMock.index++] ?? null
  }
}))

vi.mock('./pendingIdentityMerge', () => ({
  readPendingIdentityMerges: () => [...pendingIdentityMergeMock.entries],
  reservePendingIdentityMerge: (
    merge: Omit<(typeof pendingIdentityMergeMock.entries)[number], 'id' | 'nextAnonymousId'>
  ) => {
    if (anonymousIdentityMock.fail) return null
    const nextAnonymousId = anonymousIdentityMock.rotations[anonymousIdentityMock.index++] ?? null
    if (!nextAnonymousId) return null
    const entry = {
      ...merge,
      nextAnonymousId,
      id: `merge-${pendingIdentityMergeMock.nextId++}`
    }
    pendingIdentityMergeMock.entries.push(entry)
    return entry
  },
  clearPendingIdentityMerges: (ids: ReadonlySet<string>) => {
    pendingIdentityMergeMock.entries = pendingIdentityMergeMock.entries.filter(
      (entry) => !ids.has(entry.id)
    )
    return true
  }
}))

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

const telemetry = await import('./telemetry')
const { makeOpsFlag } = await import('./opsFlag')

function bindTestAnonymous(id: string, properties: Record<string, TelemetryValue> = {}): void {
  telemetry.bindAnonymousId(id, id, properties)
}

interface SetupTelemetryOptions {
  consent?: 'granted' | 'denied' | 'undecided' | null
  bind?: string | null
  appVersion?: string
  appEnv?: string
  isPackaged?: boolean
  env?: Partial<Record<PostHogEnvName, string | undefined>>
}

type PostHogEnvName =
  | 'POSTHOG_API_KEY'
  | 'POSTHOG_HOST'
  | 'POSTHOG_ENABLED'
  | 'COMFY_DESKTOP_POSTHOG_API_KEY'
  | 'COMFY_DESKTOP_POSTHOG_HOST'
  | 'COMFY_DESKTOP_POSTHOG_ENABLED'
  | 'COMFY_DESKTOP_POSTHOG_EXCEPTIONS'
  | 'POSTHOG_EXCEPTIONS'

const postHogEnvNames: PostHogEnvName[] = [
  'POSTHOG_API_KEY',
  'POSTHOG_HOST',
  'POSTHOG_ENABLED',
  'COMFY_DESKTOP_POSTHOG_API_KEY',
  'COMFY_DESKTOP_POSTHOG_HOST',
  'COMFY_DESKTOP_POSTHOG_ENABLED',
  'COMFY_DESKTOP_POSTHOG_EXCEPTIONS',
  'POSTHOG_EXCEPTIONS'
]
let previousPostHogEnv: Partial<Record<PostHogEnvName, string>> = {}

beforeEach(() => {
  previousPostHogEnv = Object.fromEntries(
    postHogEnvNames.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]!]]
    )
  )
})

function setupTelemetry(options: SetupTelemetryOptions = {}): void {
  const {
    consent = 'granted',
    bind = 'test-distinct-id',
    appVersion = '0.0.0',
    appEnv = 'test',
    isPackaged = true,
    env = {}
  } = options
  captured.length = 0
  identifies.length = 0
  exceptions.length = 0
  featureFlagResultCalls.length = 0
  posthogConstructorCalls.length = 0
  for (const name of postHogEnvNames) delete process.env[name]
  process.env[isPackaged ? 'COMFY_DESKTOP_POSTHOG_API_KEY' : 'POSTHOG_API_KEY'] = 'test-key'
  process.env['COMFY_DESKTOP_POSTHOG_ENABLED'] = '1'
  process.env['COMFY_DESKTOP_POSTHOG_EXCEPTIONS'] = '1'
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  telemetry._resetForTest()
  telemetry._resetTelemetryRelayTargets()
  telemetry.initTelemetry({ appVersion, appEnv, isPackaged })
  if (consent) telemetry.setConsentState(consent)
  if (bind) bindTestAnonymous(bind)
  telemetry._test_resetVolumeGuards()
}

afterEach(() => {
  anonymousIdentityMock.index = 0
  anonymousIdentityMock.fail = false
  posthogClientMock.failNextCaptures = 0
  posthogClientMock.failNextFlushes = 0
  posthogClientMock.autoFailNextIdentifies = 0
  posthogClientMock.featureFlagResult = undefined
  posthogClientMock.featureFlagBehavior = 'resolve'
  posthogClientMock.evaluateCondition = undefined
  posthogClientMock.deferred = null
  pendingIdentityMergeMock.entries = []
  pendingIdentityMergeMock.nextId = 1
  for (const name of postHogEnvNames) {
    const previous = previousPostHogEnv[name]
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
  telemetry._resetForTest()
  telemetry._resetTelemetryRelayTargets()
})

describe('telemetry.bucketError', () => {
  it.each([
    ['Operation cancelled by user', 'cancelled'],
    ['request timeout after 30s', 'timeout'],
    ['fetch failed: network unreachable', 'network'],
    ['No space left on disk', 'disk'],
    ['permission denied: /var/log', 'permissions'],
    ['CUDA out of memory', 'oom'],
    ['torch.cuda.OutOfMemoryError: blah', 'oom'],
    ['Killed: process exceeded memory', 'oom'],
    ['CUDA not available', 'cuda_init'],
    ['no CUDA-capable device is detected', 'cuda_init'],
    ['ImportError: cannot import name xformers', 'import_error'],
    ['ModuleNotFoundError: No module named foo', 'import_error'],
    ['node not found: SomeCustomNode', 'node_missing'],
    ['Unknown node type FooNode', 'node_missing'],
    ['RuntimeError: something broke', 'python'],
    ['ValueError: bad input', 'python'],
    ['execution failed -> RuntimeError: bad input', 'python'],
    ['Got AttributeError while computing', 'python'],
    ['see module.error somewhere in foo.py', 'other'],
    ['the user.exception field is set', 'other'],
    ['size mismatch for transformer.h.0.weight', 'shape_mismatch'],
    ["shape '[1, 4, 64, 64]' is invalid for input of size 16384", 'shape_mismatch'],
    ['expected 4 dimensions but got 3', 'shape_mismatch'],
    ['Error while deserializing header: invalid byte 0x12', 'model_load'],
    ['Missing key(s) in state_dict: "transformer.h.0.weight"', 'model_load'],
    ['safetensors_rust.SafetensorError: corrupted', 'model_load'],
    ['Prompt outputs failed validation', 'validation'],
    ['validation_failed for node 5', 'validation'],
    [
      'source-missing: Downloading ComfyUI source from https://gitcode.com/gh_mirrors/co/ComfyUI.git',
      'source_missing'
    ],
    ['source_missing', 'source_missing'],
    ['something blew up', 'other'],
    ['this is just a sentence', 'other'],
    ['', 'unknown']
  ])('buckets %j as %s', (message, bucket) => {
    expect(telemetry.bucketError(message)).toBe(bucket)
  })

  it('accepts Error instances', () => {
    expect(telemetry.bucketError(new Error('connection timeout'))).toBe('timeout')
  })

  it('uses messages from serialized error objects', () => {
    expect(telemetry.bucketError({ message: 'ECONNRESET' })).toBe('network')
  })
})

describe('telemetry default event properties', () => {
  it('carries sac_state on session.started when read before binding, as boot does', () => {
    setupTelemetry({ bind: null })
    telemetry.setSmartAppControlState('on')
    bindTestAnonymous('boot-id')

    const started = captured.find((c) => c.event === 'comfy.desktop.session.started')
    expect(started?.properties).toMatchObject({ sac_state: 'on' })
  })

  it('adds sac_state to every capture once read, keeping installation_id', () => {
    setupTelemetry({ bind: 'id' })
    telemetry.setSmartAppControlState('off')
    captured.length = 0

    telemetry.capture('comfy.desktop.test.event', {})

    expect(captured[0]!.properties).toMatchObject({ sac_state: 'off', platform: process.platform })
    expect(captured[0]!.properties).toHaveProperty('installation_id')
  })

  it('injects app_version, app_channel, app_env, platform, arch, client on every capture', () => {
    setupTelemetry({ appVersion: '0.7.0-beta.3', appEnv: 'prod', bind: 'id' })
    captured.length = 0

    telemetry.capture('comfy.desktop.test.event', { foo: 'bar' })

    expect(captured).toHaveLength(1)
    expect(captured[0]!.properties).toMatchObject({
      foo: 'bar',
      app_version: '0.7.0-beta.3',
      app_channel: 'beta',
      app_env: 'prod',
      is_packaged: true,
      platform: process.platform,
      arch: process.arch,
      client: 'desktop',
      $process_person_profile: false
    })
  })

  it('lists every default property in DEFAULT_EVENT_PROPERTY_NAMES', () => {
    setupTelemetry({ bind: 'id' })
    telemetry.setSmartAppControlState('off')
    captured.length = 0
    telemetry.capture('any.event')
    const keys = Object.keys(captured[0]!.properties ?? {}).filter((key) => !key.startsWith('$'))
    expect(new Set(keys)).toEqual(telemetry.DEFAULT_EVENT_PROPERTY_NAMES)
  })

  it('derives stable channel for a clean semver and unknown for an unfamiliar suffix', () => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'id' })
    captured.length = 0
    telemetry.capture('any.event')
    expect(captured[0]!.properties).toMatchObject({ app_channel: 'stable' })

    setupTelemetry({ appVersion: '1.0.0-rc.1', appEnv: 'prod', bind: 'id' })
    captured.length = 0
    telemetry.capture('any.event')
    expect(captured[0]!.properties).toMatchObject({ app_channel: 'unknown' })
  })

  it('per-call properties override defaults on key collision', () => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'id' })
    captured.length = 0

    telemetry.capture('any.event', {
      app_version: 'override-value',
      $process_person_profile: true
    })
    expect(captured[0]!.properties).toMatchObject({
      app_version: 'override-value',
      $process_person_profile: false
    })
  })

  it('merges the same defaults into captureException payloads', () => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'id' })
    exceptions.length = 0

    telemetry.captureException(new Error('boom'), {
      error_type: 'workspace_auth_gate_initialization_failure'
    })

    expect(exceptions).toHaveLength(1)
    expect(exceptions[0]!.properties).toMatchObject({
      error_type: 'workspace_auth_gate_initialization_failure',
      app_version: '1.0.0',
      client: 'desktop',
      $process_person_profile: false
    })
  })

  it('scrubs exception messages, stacks, and properties at the SDK boundary', () => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'id' })
    exceptions.length = 0

    const error = new Error('failed at C:\\Users\\alice\\plugin.py?token=secret123')
    error.stack = 'Error: failed\n at C:\\Users\\alice\\plugin.py:1:1 github_pat_1234567890123456'
    telemetry.captureException(error, { account: 'alice@example.com' })

    const capturedError = exceptions[0]!.error as Error
    expect(capturedError.message).not.toContain('alice')
    expect(capturedError.message).not.toContain('secret123')
    expect(capturedError.stack).not.toContain('github_pat_')
    expect(exceptions[0]!.properties?.account).toBe('[REDACTED]')
  })

  it('stamps installation_id (the bound device id) on every captured event', () => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'install-abc123' })
    captured.length = 0

    telemetry.capture('comfy.desktop.execution.session_summary', { foo: 'bar' })
    telemetry.capture('comfy.desktop.template.fork', { template_id: 't1' })

    expect(captured).toHaveLength(2)
    expect(captured[0]!.properties).toMatchObject({ installation_id: 'install-abc123' })
    expect(captured[1]!.properties).toMatchObject({ installation_id: 'install-abc123' })
  })

  it('does not identify installation_id or anonymous D at boot', () => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'install-abc123' })

    expect(identifies).toHaveLength(0)
  })
})

describe('telemetry PostHog client options', () => {
  function constructorOptions(): Record<string, unknown> {
    expect(posthogConstructorCalls).toHaveLength(1)
    return posthogConstructorCalls[0]!.options
  }

  it('passes a feature-flag request timeout above the SDK default to the client', () => {
    setupTelemetry()

    expect(constructorOptions().featureFlagsRequestTimeoutMs).toBe(10_000)
  })

  it('leaves the delivery and geoip options alone', () => {
    setupTelemetry()

    expect(constructorOptions()).toMatchObject({
      flushAt: 20,
      flushInterval: 10_000,
      disableGeoip: false
    })
  })

  it('does not set requestTimeout, which governs a path this app never takes', () => {
    setupTelemetry()

    expect(constructorOptions()).not.toHaveProperty('requestTimeout')
  })

  it('ignores generic PostHog key and host environment variables in packaged builds', () => {
    setupTelemetry({
      env: {
        POSTHOG_API_KEY: 'phx-unrelated-personal-key',
        POSTHOG_HOST: 'https://unrelated-posthog.example'
      }
    })

    expect(posthogConstructorCalls[0]).toMatchObject({
      apiKey: 'test-key',
      options: { host: DEFAULT_POSTHOG_HOST }
    })
  })

  it('uses packaged defaults when the scoped key and host are absent', () => {
    setupTelemetry({
      env: {
        POSTHOG_API_KEY: 'phx-unrelated-personal-key',
        POSTHOG_HOST: 'https://unrelated-posthog.example',
        COMFY_DESKTOP_POSTHOG_API_KEY: undefined,
        COMFY_DESKTOP_POSTHOG_HOST: undefined
      }
    })

    expect(posthogConstructorCalls[0]).toMatchObject({
      apiKey: DEFAULT_POSTHOG_API_KEY,
      options: { host: DEFAULT_POSTHOG_HOST }
    })
  })

  it('preserves the generic PostHog disable switch in packaged builds', () => {
    setupTelemetry({ env: { POSTHOG_ENABLED: '0' } })

    expect(posthogConstructorCalls).toHaveLength(0)
  })

  it('accepts product-scoped PostHog overrides in packaged builds', () => {
    setupTelemetry({
      env: {
        COMFY_DESKTOP_POSTHOG_API_KEY: 'scoped-key',
        COMFY_DESKTOP_POSTHOG_HOST: 'https://scoped-posthog.example'
      }
    })

    expect(posthogConstructorCalls[0]).toMatchObject({
      apiKey: 'scoped-key',
      options: { host: 'https://scoped-posthog.example' }
    })
  })

  it('keeps generic PostHog overrides available for unpackaged development', () => {
    setupTelemetry({
      isPackaged: false,
      env: {
        POSTHOG_API_KEY: 'dev-key',
        POSTHOG_HOST: 'https://dev-posthog.example'
      }
    })

    expect(posthogConstructorCalls[0]).toMatchObject({
      apiKey: 'dev-key',
      options: { host: 'https://dev-posthog.example' }
    })
  })

  it('prefers product-scoped PostHog overrides during unpackaged development', () => {
    setupTelemetry({
      isPackaged: false,
      env: {
        POSTHOG_API_KEY: 'generic-key',
        POSTHOG_HOST: 'https://generic-posthog.example',
        COMFY_DESKTOP_POSTHOG_API_KEY: 'scoped-key',
        COMFY_DESKTOP_POSTHOG_HOST: 'https://scoped-posthog.example'
      }
    })

    expect(posthogConstructorCalls[0]).toMatchObject({
      apiKey: 'scoped-key',
      options: { host: 'https://scoped-posthog.example' }
    })
  })

  it('honors the product-scoped disable switch during unpackaged development', () => {
    setupTelemetry({ isPackaged: false, env: { COMFY_DESKTOP_POSTHOG_ENABLED: '0' } })

    expect(posthogConstructorCalls).toHaveLength(0)
  })

  it('accepts common privacy opt-out spellings', () => {
    setupTelemetry({ env: { COMFY_DESKTOP_POSTHOG_ENABLED: 'disabled' } })

    expect(posthogConstructorCalls).toHaveLength(0)
  })

  it('does not let an unrelated inherited spelling disable telemetry', () => {
    setupTelemetry({ env: { POSTHOG_ENABLED: 'unrelated-tool-value' } })

    expect(posthogConstructorCalls).toHaveLength(1)
  })

  it('preserves the generic disable switch during unpackaged development', () => {
    setupTelemetry({ isPackaged: false, env: { POSTHOG_ENABLED: '0' } })

    expect(posthogConstructorCalls).toHaveLength(0)
  })

  it('falls back from whitespace-only overrides to packaged defaults', () => {
    setupTelemetry({
      env: {
        COMFY_DESKTOP_POSTHOG_API_KEY: '  ',
        COMFY_DESKTOP_POSTHOG_HOST: '\t'
      }
    })

    expect(posthogConstructorCalls[0]).toMatchObject({
      apiKey: DEFAULT_POSTHOG_API_KEY,
      options: { host: DEFAULT_POSTHOG_HOST }
    })
  })

  it('rejects a non-HTTPS packaged host override', () => {
    setupTelemetry({ env: { COMFY_DESKTOP_POSTHOG_HOST: 'http://posthog.example' } })

    expect(posthogConstructorCalls).toHaveLength(0)
  })

  it('rejects credentials embedded in a packaged host override', () => {
    setupTelemetry({
      env: { COMFY_DESKTOP_POSTHOG_HOST: 'https://user:password@posthog.example' }
    })

    expect(posthogConstructorCalls).toHaveLength(0)
  })
})

const PLATFORM = { platform: process.platform }
const BASE_PROPS = { ...PLATFORM, app_version: '0.0.0' }

describe('telemetry anonymous flag reads', () => {
  it('classifies an enabled flag as a value result, without implicit capture', async () => {
    setupTelemetry({ consent: null, bind: null })
    posthogClientMock.featureFlagResult = {
      enabled: true,
      variant: 'beta',
      payload: { flags: ['enable-assets'] }
    }

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
    ).resolves.toEqual({
      kind: 'value',
      value: 'beta',
      payload: { flags: ['enable-assets'] }
    })
    expect(featureFlagResultCalls).toEqual([
      {
        key: 'desktop_core_beta_features',
        distinctId: 'installation-id',
        options: {
          sendFeatureFlagEvents: false,
          personProperties: BASE_PROPS
        }
      }
    ])
  })

  it('classifies a disabled flag as a value result carrying false', async () => {
    setupTelemetry({ consent: null, bind: null })
    posthogClientMock.featureFlagResult = {
      enabled: false,
      variant: 'beta',
      payload: { flags: ['enable-assets'] }
    }

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
    ).resolves.toMatchObject({ kind: 'value', value: false })
  })

  it('classifies a missing flag result as unreachable', async () => {
    setupTelemetry({ consent: null, bind: null })
    posthogClientMock.featureFlagResult = undefined

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
    ).resolves.toEqual({ kind: 'unreachable' })
  })

  it('classifies a thrown evaluation request as unreachable', async () => {
    setupTelemetry({ consent: null, bind: null })
    posthogClientMock.featureFlagBehavior = 'throw'

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
    ).resolves.toEqual({ kind: 'unreachable' })
  })

  it('classifies a timed-out evaluation request as unreachable', async () => {
    setupTelemetry({ consent: null, bind: null })
    posthogClientMock.featureFlagBehavior = 'hang'

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 10)
    ).resolves.toEqual({ kind: 'unreachable' })
  })
})

describe('ops-flag person targeting', () => {
  function lastPersonProperties(): unknown {
    const call = featureFlagResultCalls.at(-1)
    return (call?.options as { personProperties?: unknown } | undefined)?.personProperties
  }

  async function evaluate(): Promise<void> {
    await telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
  }

  it('attaches comfy_staff for a staff install once consent is granted', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationStaff(true)

    await evaluate()

    expect(lastPersonProperties()).toEqual({
      ...PLATFORM,
      app_version: '0.0.0',
      comfy_staff: 'true'
    })
  })

  it('leaves the distinct id the installation hash, so bucketing is unchanged', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationStaff(true)

    await evaluate()

    expect(featureFlagResultCalls.at(-1)?.distinctId).toBe('installation-id')
  })

  it('never captures an event for the evaluation, so no person is created', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationStaff(true)

    await evaluate()

    expect(
      (featureFlagResultCalls.at(-1)?.options as { sendFeatureFlagEvents?: boolean } | undefined)
        ?.sendFeatureFlagEvents
    ).toBe(false)
    expect(captured.map((event) => event.event)).not.toContain('$feature_flag_called')
  })

  it('sends the OS the app is running on, not a fixed value', async () => {
    setupTelemetry({ consent: null })
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    const other = process.platform === 'win32' ? 'darwin' : 'win32'
    Object.defineProperty(process, 'platform', { value: other, configurable: true })
    try {
      await evaluate()
    } finally {
      Object.defineProperty(process, 'platform', original)
    }

    expect(lastPersonProperties()).toEqual({ platform: other, app_version: '0.0.0' })
  })

  it('sends no comfy_staff for a non-staff install', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationStaff(false)

    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it('sends no comfy_staff when consent is undecided', async () => {
    setupTelemetry({ consent: null })
    telemetry.setFlagEvaluationStaff(true)

    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it('sends no comfy_staff when consent is denied', async () => {
    setupTelemetry({ consent: 'denied' })
    telemetry.setFlagEvaluationStaff(true)

    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it('still evaluates the flag without consent, carrying no staff property', async () => {
    setupTelemetry({ consent: 'denied' })
    telemetry.setFlagEvaluationStaff(true)
    posthogClientMock.featureFlagResult = { enabled: true, variant: 'beta', payload: null }

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
    ).resolves.toMatchObject({ kind: 'value', value: 'beta' })
    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it.each(['granted', 'denied', null] as const)(
    'sends sac_state once read, with consent %s',
    async (consent) => {
      setupTelemetry({ consent })
      telemetry.setSmartAppControlState('on')

      await evaluate()

      expect(lastPersonProperties()).toEqual({ ...BASE_PROPS, sac_state: 'on' })
    }
  )

  it('sends no sac_state before it has been read', async () => {
    setupTelemetry({ consent: 'granted' })

    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it('attaches user_tier once consent is granted', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationUserTier('paid')

    await evaluate()

    expect(lastPersonProperties()).toEqual({
      ...PLATFORM,
      app_version: '0.0.0',
      user_tier: 'paid'
    })
    expect(featureFlagResultCalls.at(-1)?.distinctId).toBe('installation-id')
  })

  it('sends a known free tier too, so a condition can tell free from unknown', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationUserTier('free')

    await evaluate()

    expect(lastPersonProperties()).toEqual({
      ...PLATFORM,
      app_version: '0.0.0',
      user_tier: 'free'
    })
  })

  it('sends no user_tier while the tier is unknown', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationUserTier('paid')
    telemetry.setFlagEvaluationUserTier('unknown')

    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it.each(['denied', null] as const)('sends no user_tier with consent %s', async (consent) => {
    setupTelemetry({ consent })
    telemetry.setFlagEvaluationUserTier('paid')

    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it('sends user_tier alongside comfy_staff for a consented paid staff install', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationStaff(true)
    telemetry.setFlagEvaluationUserTier('paid')

    await evaluate()

    expect(lastPersonProperties()).toEqual({
      ...PLATFORM,
      app_version: '0.0.0',
      comfy_staff: 'true',
      user_tier: 'paid'
    })
  })

  it('drops the consented properties when consent is revoked after binding', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationUserTier('paid')
    telemetry.setConsentState('denied')

    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it('sends a tier bound before consent once consent is granted', async () => {
    setupTelemetry({ consent: null })
    telemetry.setFlagEvaluationUserTier('paid')
    telemetry.setConsentState('granted')

    await evaluate()

    expect(lastPersonProperties()).toEqual({
      ...PLATFORM,
      app_version: '0.0.0',
      user_tier: 'paid'
    })
  })

  it('stops sending once the install is reclassified, as on sign-out', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationStaff(true)
    await evaluate()
    expect(lastPersonProperties()).toEqual({
      ...PLATFORM,
      app_version: '0.0.0',
      comfy_staff: 'true'
    })

    telemetry.setFlagEvaluationStaff(false)
    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  it('does not survive a reset, so no classification leaks between launches in-process', async () => {
    setupTelemetry({ consent: 'granted' })
    telemetry.setFlagEvaluationStaff(true)
    telemetry.setFlagEvaluationUserTier('paid')

    setupTelemetry({ consent: 'granted' })
    await evaluate()

    expect(lastPersonProperties()).toEqual(BASE_PROPS)
  })

  describe('against a stand-in `comfy_staff = true` condition', () => {
    function serveStaffOnlyFlag(): void {
      posthogClientMock.evaluateCondition = (options) => {
        if (options?.personProperties?.['comfy_staff'] !== 'true') return { enabled: false }
        return { enabled: true, variant: 'beta', payload: { flags: [{ arg: '--enable-agent' }] } }
      }
    }

    it('matches for a staff install', async () => {
      setupTelemetry({ consent: 'granted' })
      serveStaffOnlyFlag()
      telemetry.setFlagEvaluationStaff(true)

      await expect(
        telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
      ).resolves.toEqual({
        kind: 'value',
        value: 'beta',
        payload: { flags: [{ arg: '--enable-agent' }] }
      })
    })

    it('does not match a non-staff install', async () => {
      setupTelemetry({ consent: 'granted' })
      serveStaffOnlyFlag()
      telemetry.setFlagEvaluationStaff(false)

      await expect(
        telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
      ).resolves.toEqual({ kind: 'value', value: false, payload: undefined })
    })

    it('does not match on the installation hash alone — the bug this fixes', async () => {
      setupTelemetry({ consent: 'granted' })
      serveStaffOnlyFlag()

      await expect(
        telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
      ).resolves.toEqual({ kind: 'value', value: false, payload: undefined })
    })

    it('does not match a staff install that withheld consent', async () => {
      setupTelemetry({ consent: 'denied' })
      serveStaffOnlyFlag()
      telemetry.setFlagEvaluationStaff(true)

      await expect(
        telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
      ).resolves.toEqual({ kind: 'value', value: false, payload: undefined })
    })
  })

  describe('app_version', () => {
    it.each([
      ['undecided', null],
      ['denied', 'denied'],
      ['granted', 'granted']
    ] as const)('is sent when consent is %s', async (_label, consent) => {
      setupTelemetry({ consent, appVersion: '1.1.4' })

      await evaluate()

      expect(lastPersonProperties()).toEqual({
        ...PLATFORM,
        app_version: '1.1.4'
      })
    })

    it('rides alongside comfy_staff for a consented staff install', async () => {
      setupTelemetry({ consent: 'granted', appVersion: '1.1.4' })
      telemetry.setFlagEvaluationStaff(true)

      await evaluate()

      expect(lastPersonProperties()).toEqual({
        ...PLATFORM,
        app_version: '1.1.4',
        comfy_staff: 'true'
      })
    })

    it('is the version initTelemetry was given, verbatim, prerelease included', async () => {
      setupTelemetry({ consent: null, appVersion: '1.1.4-rc.1' })

      await evaluate()

      expect(lastPersonProperties()).toEqual({ ...PLATFORM, app_version: '1.1.4-rc.1' })
    })

    it('is omitted rather than sent empty when the version is unknown', async () => {
      setupTelemetry({ consent: null, appVersion: '' })

      await evaluate()

      expect(lastPersonProperties()).toEqual(PLATFORM)
    })

    describe('against a stand-in `app_version semver_gte 1.1.4` condition', () => {
      function isAtLeast(version: string | undefined, min: [number, number, number]): boolean {
        if (!version) return false
        const [release = '', ...prerelease] = version.split('-')
        const [major = 0, minor = 0, patch = 0] = release.split('.').map(Number)
        if (major !== min[0]) return major > min[0]
        if (minor !== min[1]) return minor > min[1]
        if (patch !== min[2]) return patch > min[2]
        return prerelease.length === 0
      }

      function serveVersionGatedFlag(): void {
        posthogClientMock.evaluateCondition = (options) => {
          if (!isAtLeast(options?.personProperties?.['app_version'], [1, 1, 4])) {
            return { enabled: false }
          }
          return {
            enabled: true,
            variant: 'beta',
            payload: { flags: [{ arg: '--enable-assets-output-scanning' }] }
          }
        }
      }

      it.each(['1.1.4', '1.2.0'])('matches %s, even before consent', async (appVersion) => {
        setupTelemetry({ consent: null, appVersion })
        serveVersionGatedFlag()

        await expect(
          telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
        ).resolves.toMatchObject({ kind: 'value', value: 'beta' })
      })

      it.each(['1.1.3', '1.1.4-rc.1'])('does not match %s', async (appVersion) => {
        setupTelemetry({ consent: 'granted', appVersion })
        serveVersionGatedFlag()

        await expect(
          telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
        ).resolves.toEqual({ kind: 'value', value: false, payload: undefined })
      })
    })
  })
})

describe('telemetry late ops-flag results', () => {
  async function raceLostWith(onLate: (result: unknown) => void): Promise<void> {
    setupTelemetry({ consent: null, bind: null })
    posthogClientMock.featureFlagBehavior = 'defer'
    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 0, onLate)
    ).resolves.toEqual({ kind: 'unreachable' })
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('reports an explicit value that arrives after the deadline', async () => {
    const late: unknown[] = []
    await raceLostWith((result) => late.push(result))

    posthogClientMock.deferred?.resolve({ enabled: false, variant: 'beta', payload: { a: 1 } })
    await flush()

    expect(late).toEqual([{ kind: 'value', value: false, payload: { a: 1 } }])
  })

  it('reports a late enabled variant as that variant', async () => {
    const late: unknown[] = []
    await raceLostWith((result) => late.push(result))

    posthogClientMock.deferred?.resolve({ enabled: true, variant: 'beta', payload: null })
    await flush()

    expect(late).toEqual([{ kind: 'value', value: 'beta', payload: null }])
  })

  it('withholds a late result that carries no result for the key', async () => {
    const late: unknown[] = []
    await raceLostWith((result) => late.push(result))

    posthogClientMock.deferred?.resolve(undefined)
    await flush()

    expect(late).toEqual([])
  })

  it('withholds a late rejection, without an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const late: unknown[] = []
      await raceLostWith((result) => late.push(result))

      posthogClientMock.deferred?.reject(new Error('connection reset'))
      await flush()

      expect(late).toEqual([])
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('does not report late when the fetch wins the race', async () => {
    setupTelemetry({ consent: null, bind: null })
    posthogClientMock.featureFlagResult = { enabled: true, variant: 'beta', payload: null }
    const late: unknown[] = []

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100, (result) =>
        late.push(result)
      )
    ).resolves.toMatchObject({ kind: 'value', value: 'beta' })
    await flush()

    expect(late).toEqual([])
  })

  it('does not report late when the client is not initialised', async () => {
    delete process.env['COMFY_DESKTOP_POSTHOG_API_KEY']
    delete process.env['COMFY_DESKTOP_POSTHOG_ENABLED']
    telemetry._resetForTest()
    const late: unknown[] = []

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 0, (result) =>
        late.push(result)
      )
    ).resolves.toEqual({ kind: 'unreachable' })
    await flush()

    expect(late).toEqual([])
  })
})

describe('telemetry late ops-flag reporting', () => {
  const EVENT = 'comfy.desktop.ops_flag.late_result'

  function lateEvents(): CapturedCall[] {
    return captured.filter((call) => call.event === EVENT)
  }

  function lateEvent(): Record<string, unknown> {
    expect(lateEvents()).toHaveLength(1)
    return lateEvents()[0]!.properties ?? {}
  }

  async function raceLostReporting(
    onLate?: (result: unknown) => void,
    options: SetupTelemetryOptions = {}
  ): Promise<void> {
    setupTelemetry(options)
    posthogClientMock.featureFlagBehavior = 'defer'
    captured.length = 0
    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 0, onLate)
    ).resolves.toEqual({ kind: 'unreachable' })
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  it('reports a late value, and still hands it to the caller', async () => {
    const late: unknown[] = []
    await raceLostReporting((result) => late.push(result))

    posthogClientMock.deferred?.resolve({ enabled: true, variant: 'beta', payload: { a: 1 } })
    await flush()

    expect(late).toEqual([{ kind: 'value', value: 'beta', payload: { a: 1 } }])
    expect(lateEvent()).toMatchObject({
      flag_key: 'desktop_core_beta_features',
      outcome: 'value'
    })
  })

  it('reports a late miss, and withholds it from the caller', async () => {
    const late: unknown[] = []
    await raceLostReporting((result) => late.push(result))

    posthogClientMock.deferred?.resolve(undefined)
    await flush()

    expect(lateEvent()).toMatchObject({
      flag_key: 'desktop_core_beta_features',
      outcome: 'no_result'
    })
    expect(late).toEqual([])
  })

  it('reports a late rejection with its error bucket, and withholds it from the caller', async () => {
    const late: unknown[] = []
    await raceLostReporting((result) => late.push(result))

    posthogClientMock.deferred?.reject(new Error('request timeout after 30s'))
    await flush()

    expect(lateEvent()).toMatchObject({ outcome: 'rejected', error_bucket: 'timeout' })
    expect(late).toEqual([])
  })

  it('reports how long the abandoned fetch actually ran, not how long it ran past the deadline', async () => {
    await raceLostReporting()
    await sleep(40)

    posthogClientMock.deferred?.resolve(undefined)
    await flush()

    const durationMs = lateEvent()['duration_ms']
    expect(typeof durationMs).toBe('number')
    expect(durationMs as number).toBeGreaterThanOrEqual(25)
  })

  it('reports a timed-out fetch even when no caller registered for late values', async () => {
    await raceLostReporting()

    posthogClientMock.deferred?.resolve(undefined)
    await flush()

    expect(lateEvent()).toMatchObject({ outcome: 'no_result' })
  })

  it('reports nothing when the fetch wins the race', async () => {
    setupTelemetry()
    posthogClientMock.featureFlagResult = { enabled: true, variant: 'beta', payload: null }
    captured.length = 0

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
    ).resolves.toMatchObject({ kind: 'value' })
    await flush()

    expect(lateEvents()).toEqual([])
  })

  it('reports nothing when the fetch answers IN BAND with no result for the key', async () => {
    setupTelemetry()
    posthogClientMock.featureFlagResult = undefined
    captured.length = 0

    await expect(
      telemetry.getOpsFlagResult('desktop_core_beta_features', 'installation-id', 100)
    ).resolves.toEqual({ kind: 'unreachable' })
    await flush()

    expect(lateEvents()).toEqual([])
  })

  it('does not report without consent, though the read itself still happens', async () => {
    const late: unknown[] = []
    await raceLostReporting((result) => late.push(result), { consent: 'denied' })

    posthogClientMock.deferred?.resolve({ enabled: true, variant: 'beta', payload: null })
    await flush()

    expect(lateEvents()).toEqual([])
    expect(late).toEqual([{ kind: 'value', value: 'beta', payload: null }])
  })

  it('still hands the caller its late value when the capture path throws', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const late: unknown[] = []
      await raceLostReporting((result) => late.push(result))
      posthogClientMock.failNextCaptures = 1

      posthogClientMock.deferred?.resolve({ enabled: false, variant: 'beta', payload: null })
      await flush()

      expect(late).toEqual([{ kind: 'value', value: false, payload: null }])
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('reports the outcome exactly once when the caller itself throws', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      await raceLostReporting(() => {
        throw new Error('persist failed')
      })

      posthogClientMock.deferred?.resolve({ enabled: true, variant: 'beta', payload: null })
      await flush()

      expect(lateEvent()).toMatchObject({ outcome: 'value' })
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('late ops-flag results reaching real persistence', () => {
  const EVENT = 'comfy.desktop.ops_flag.late_result'
  const KEY = 'grant-flag'

  function flagsFilePath(): string {
    return path.join(testConfigDir, 'ops-flags.json')
  }

  function seedGrant(): string {
    const stored = JSON.stringify(
      { [KEY]: { value: true, payload: null, fetchedAt: Date.now() } },
      null,
      2
    )
    fs.writeFileSync(flagsFilePath(), stored, 'utf-8')
    fs.writeFileSync(flagsFilePath() + '.bak', stored, 'utf-8')
    return stored
  }

  function makeGrantFlag() {
    return makeOpsFlag<'granted' | 'revoked' | 'unknown'>({
      key: KEY,
      fallback: 'unknown',
      parse: (value) => (value === true ? 'granted' : value === false ? 'revoked' : undefined),
      persist: true
    })
  }

  async function launchLosingTheRace(): Promise<ReturnType<typeof makeGrantFlag>> {
    setupTelemetry()
    posthogClientMock.featureFlagBehavior = 'defer'
    captured.length = 0
    const flag = makeGrantFlag()
    await flag.init({ distinctId: 'installation-id', timeoutMs: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    return flag
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  function lateEventOutcome(): unknown {
    const events = captured.filter((call) => call.event === EVENT)
    expect(events).toHaveLength(1)
    return events[0]!.properties?.['outcome']
  }

  beforeEach(() => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-ops-flag-'))
  })

  it('writes a late VALUE through to disk while reporting it', async () => {
    seedGrant()
    const flag = await launchLosingTheRace()

    const answeredAt = Date.now()
    posthogClientMock.deferred?.resolve({ enabled: false, payload: null })
    await flush()

    expect(lateEventOutcome()).toBe('value')
    const stored = JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))
    expect(stored).toEqual({
      [KEY]: { value: false, payload: null, fetchedAt: expect.any(Number) }
    })
    expect(stored[KEY].fetchedAt).toBeGreaterThanOrEqual(answeredAt)
    expect(stored[KEY].fetchedAt).toBeLessThanOrEqual(Date.now())
    expect(await flag.get()).toBe('revoked')
  })

  it('reports a late MISS without letting it reach the file', async () => {
    const stored = seedGrant()
    const flag = await launchLosingTheRace()

    posthogClientMock.deferred?.resolve(undefined)
    await flush()

    expect(lateEventOutcome()).toBe('no_result')
    expect(fs.readFileSync(flagsFilePath(), 'utf-8')).toBe(stored)
    expect(await flag.get()).toBe('granted')
  })

  it('reports a late REJECTION without letting it reach the file', async () => {
    const stored = seedGrant()
    const flag = await launchLosingTheRace()

    posthogClientMock.deferred?.reject(new Error('connection reset'))
    await flush()

    expect(lateEventOutcome()).toBe('rejected')
    expect(fs.readFileSync(flagsFilePath(), 'utf-8')).toBe(stored)
    expect(await flag.get()).toBe('granted')
  })
})

describe('telemetry.captureInstallCompleted', () => {
  beforeEach(() => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'install-xyz' })
    captured.length = 0
  })

  it('fires comfy.desktop.install.completed exactly once with method + express + installation_id', () => {
    telemetry.captureInstallCompleted({
      installationId: 'install-xyz',
      method: 'express',
      express: true
    })

    const completed = captured.filter((c) => c.event === 'comfy.desktop.install.completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]!.properties).toMatchObject({
      installation_id: 'install-xyz',
      method: 'express',
      express: true
    })
  })

  it('stamps the durable first_local_install_completed_at $set_once person marker (#1224)', () => {
    telemetry.captureInstallCompleted({
      installationId: 'install-xyz',
      method: 'manual',
      express: false
    })

    expect(captured.find((c) => c.event === 'comfy.desktop.person.set')).toBeUndefined()
    telemetry.applyFirebaseUserConsensus('firebase-user')
    expect(identifies.at(-1)?.properties?.$set_once).toHaveProperty(
      'first_local_install_completed_at'
    )
  })

  it.each([
    ['express', true],
    ['manual', false],
    ['adopt', false],
    ['migrate', false]
  ] as const)('carries method=%s / express=%s for each install path', (method, express) => {
    telemetry.captureInstallCompleted({ installationId: 'i1', method, express })
    const completed = captured.filter((c) => c.event === 'comfy.desktop.install.completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]!.properties).toMatchObject({ method, express })
  })

  it('boot_completed is a distinct success event carrying the boot_id join key', () => {
    telemetry.capture('comfy.desktop.comfyui.boot_completed', {
      installation_id: 'install-xyz',
      boot_id: 'boot-1',
      boot_time_ms: 1234
    })
    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.comfyui.boot_completed'])
    expect(captured[0]!.properties).toMatchObject({
      installation_id: 'install-xyz',
      boot_id: 'boot-1',
      boot_time_ms: 1234
    })
  })

  it('does NOT fire on boot — boot_started is a distinct, separately-emitted event', () => {
    telemetry.capture('comfy.desktop.comfyui.boot_started', { installation_id: 'install-xyz' })
    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.comfyui.boot_started'])
    expect(captured.some((c) => c.event === 'comfy.desktop.install.completed')).toBe(false)
  })

  it('is consent-gated: no install.completed when consent is not granted', () => {
    telemetry.setConsentState('denied')
    captured.length = 0
    telemetry.captureInstallCompleted({ installationId: 'i1', method: 'manual', express: false })
    expect(captured).toHaveLength(0)
  })
})

describe('telemetry.trackedStep', () => {
  beforeEach(() => {
    setupTelemetry()
  })

  it('emits .start and .end with duration_ms on success', async () => {
    captured.length = 0
    const result = await telemetry.trackedStep('test.step', { foo: 'bar' }, async () => 42)
    expect(result).toBe(42)
    const events = captured.map((c) => c.event)
    expect(events).toEqual(['test.step.start', 'test.step.end'])
    expect(captured[0]!.properties).toMatchObject({ foo: 'bar' })
    expect(typeof captured[1]!.properties?.duration_ms).toBe('number')
    expect(captured[1]!.properties?.foo).toBe('bar')
  })

  it('emits .start and .error on failure and rethrows', async () => {
    captured.length = 0
    await expect(
      telemetry.trackedStep('install.step', { id: 'x' }, async () => {
        throw new Error('disk full')
      })
    ).rejects.toThrow('disk full')
    const events = captured.map((c) => c.event)
    expect(events).toEqual(['install.step.start', 'install.step.error'])
    expect(captured[1]!.properties).toMatchObject({
      id: 'x',
      error_bucket: 'disk',
      error_message: 'disk full'
    })
    expect(typeof captured[1]!.properties?.duration_ms).toBe('number')
  })

  it('respects consent: capture is skipped when consent is revoked', async () => {
    telemetry.setConsent(false)
    captured.length = 0
    await telemetry.trackedStep('test.step', {}, async () => 'ok')
    expect(captured).toHaveLength(0)
  })

  it('scrubs error_message before emit so user paths never leave the process', async () => {
    captured.length = 0
    await expect(
      telemetry.trackedStep('migrate.flow', { foo: 'bar' }, async () => {
        throw new Error("ENOENT 'C:\\Users\\Administrator\\ComfyUI-Installs\\ComfyUI\\__init__.py'")
      })
    ).rejects.toThrow()
    expect(captured[1]!.event).toBe('migrate.flow.error')
    const msg = captured[1]!.properties?.error_message as string
    expect(msg).toContain('[REDACTED]')
    expect(msg).not.toContain('Administrator')
  })

  it('emits one canonical error for nested steps with failed stage context', async () => {
    captured.length = 0
    await expect(
      telemetry.trackedStep(
        'migrate.flow',
        { source_installation_id: 'source-1' },
        () =>
          telemetry.trackedStep('migrate.register', { installation_id: 'target-1' }, async () => {
            throw new Error('disk full')
          }),
        { canonicalError: true }
      )
    ).rejects.toThrow('disk full')
    const errors = captured.filter((event) => event.event.endsWith('.error'))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      event: 'migrate.flow.error',
      properties: {
        failed_stage: 'migrate.register',
        source_installation_id: 'source-1',
        installation_id: 'target-1'
      }
    })
  })

  it('retains the innermost failure stage through multiple nested steps', async () => {
    captured.length = 0
    await expect(
      telemetry.trackedStep(
        'flow',
        {},
        () =>
          telemetry.trackedStep('middle', {}, () =>
            telemetry.trackedStep('inner', { installation_id: 'target-1' }, async () => {
              throw new Error('disk full')
            })
          ),
        { canonicalError: true }
      )
    ).rejects.toThrow('disk full')

    const errors = captured.filter((event) => event.event.endsWith('.error'))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      event: 'flow.error',
      properties: { failed_stage: 'inner', installation_id: 'target-1' }
    })
  })
})

describe('telemetry SDK-level privacy safety nets', () => {
  beforeEach(() => {
    setupTelemetry()
  })

  it('does not strip $ip: PostHog needs it to derive country (GeoIP enabled)', () => {
    captured.length = 0
    telemetry.capture('comfy.desktop.session.started', { foo: 'bar' })
    expect(captured).toHaveLength(1)
    expect(captured[0]!.properties).not.toHaveProperty('$ip')
  })

  it('scrubs string properties as a last-resort safety net for emit sites that forget', () => {
    captured.length = 0
    telemetry.capture('comfy.desktop.execution.error', {
      error_class: 'FileNotFoundError',
      error_message: "ENOENT 'C:\\Users\\64911\\Documents\\workflow.json'"
    })
    expect(captured).toHaveLength(1)
    const msg = captured[0]!.properties?.error_message as string
    expect(msg).toContain('[REDACTED]')
    expect(msg).not.toContain('64911')
  })

  it('scrubs string array entries as a last-resort safety net', () => {
    captured.length = 0
    telemetry.capture('comfy.desktop.execution.error', {
      model_paths: ['C:\\Users\\64911\\Documents\\model.safetensors', 'LoadImage']
    })
    expect(captured).toHaveLength(1)
    const paths = captured[0]!.properties?.model_paths as string[]
    expect(paths[0]).toContain('[REDACTED]')
    expect(paths[0]).not.toContain('64911')
    expect(paths[1]).toBe('LoadImage')
  })

  it('leaves non-string property types untouched', () => {
    captured.length = 0
    telemetry.capture('comfy.desktop.execution.session_summary', {
      completed_count: 7,
      crashed: false
    })
    const props = captured[0]!.properties
    expect(props?.completed_count).toBe(7)
    expect(props?.crashed).toBe(false)
  })
})

describe('telemetry consent state (3-state)', () => {
  beforeEach(() => {
    setupTelemetry({ consent: null, bind: null })
  })

  it('undecided suppresses regular events but allows the consent_decision event', () => {
    telemetry.setConsentState('undecided')
    bindTestAnonymous('test-distinct-id')
    captured.length = 0

    telemetry.capture('comfy.desktop.session.started', { foo: 'bar' })
    telemetry.capture('comfy.desktop.first_use.consent_decision', { accepted: false })

    const events = captured.map((c) => c.event)
    expect(events).toEqual(['comfy.desktop.first_use.consent_decision'])
  })

  it('denied suppresses everything EXCEPT the consent_decision allow-list entry', () => {
    telemetry.setConsentState('denied')
    bindTestAnonymous('test-distinct-id')
    captured.length = 0

    telemetry.capture('comfy.desktop.session.started', {})
    telemetry.capture('comfy.desktop.first_use.consent_decision', {
      decision: 'decline',
      telemetry_enabled: false
    })

    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.first_use.consent_decision'])
    expect(captured[0]?.properties).toMatchObject({
      decision: 'decline',
      telemetry_enabled: false
    })
  })

  it('defers session.started while consent is undecided', () => {
    telemetry.setConsentState('undecided')
    bindTestAnonymous('deferred-id', { app_version: '1.2.3' })

    expect(captured).toHaveLength(0)

    telemetry.setConsentState('granted')

    const events = captured.map((c) => c.event)
    expect(events).toContain('comfy.desktop.session.started')
    expect(captured.find((c) => c.event === 'comfy.desktop.session.started')?.distinctId).toBe(
      'deferred-id'
    )
  })

  it('legacy setConsent(true) maps to granted; setConsent(false) maps to denied', () => {
    telemetry.setConsent(true)
    bindTestAnonymous('legacy-id')
    captured.length = 0
    telemetry.capture('any.event', {})
    expect(captured).toHaveLength(1)

    telemetry.setConsent(false)
    captured.length = 0
    telemetry.capture('any.event', {})
    expect(captured).toHaveLength(0)
  })

  it('captureException is suppressed outside granted', () => {
    telemetry.setConsentState('denied')
    bindTestAnonymous('any')
    exceptions.length = 0
    telemetry.captureException(new Error('boom'), {})
    expect(exceptions).toHaveLength(0)

    telemetry.setConsentState('undecided')
    exceptions.length = 0
    telemetry.captureException(new Error('boom'), {})
    expect(exceptions).toHaveLength(0)

    telemetry.setConsentState('granted')
    exceptions.length = 0
    telemetry.captureException(new Error('boom'), {})
    expect(exceptions).toHaveLength(1)
  })

  it('discards deferred data when consent is denied', () => {
    telemetry.setConsentState('undecided')
    bindTestAnonymous('anonymous-id')

    telemetry.registerPersonProperties({ plan: 'pro' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'first' })
    telemetry.captureFirstLaunch({ id_class: 'random_uuid' })
    telemetry.setConsentState('denied')

    telemetry.registerPersonProperties({ locale: 'en' })
    telemetry.captureFirstLaunch({ id_class: 'random_uuid' })
    telemetry.setConsentState('granted')
    telemetry.applyFirebaseUserConsensus('firebase-user')

    expect(captured.some((call) => call.event === 'comfy.desktop.app.first_launch')).toBe(false)
    expect(identifies.at(-1)?.properties?.$set).not.toHaveProperty('plan')
    expect(identifies.at(-1)?.properties?.$set).not.toHaveProperty('locale')
    expect(identifies.at(-1)?.properties?.$set_once).toBeUndefined()
  })
})

describe('telemetry pre-consent person properties', () => {
  beforeEach(() => {
    setupTelemetry({ consent: null, bind: null })
  })

  it('applies latest $set and first $set_once values at Firebase bind', () => {
    telemetry.setConsentState('undecided')
    bindTestAnonymous('id', { app_version: '1.0.0' })

    telemetry.registerPersonProperties({ gpu_tier: 'low', locale: 'en' })
    telemetry.registerPersonProperties({ gpu_tier: 'mid', theme: 'dark' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'first' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'second' })

    telemetry.setConsentState('granted')
    expect(identifies).toHaveLength(0)
    telemetry.applyFirebaseUserConsensus('firebase-user')

    expect(identifies.at(-1)?.properties?.$set).toMatchObject({
      app_version: '1.0.0',
      gpu_tier: 'mid',
      locale: 'en',
      theme: 'dark'
    })
    expect(identifies.at(-1)?.properties?.$set_once).toEqual({
      first_generation_at: 'first'
    })
  })
})

describe('telemetry.captureFirstLaunch (deferred once-ever event)', () => {
  beforeEach(() => {
    setupTelemetry({ consent: null, bind: null })
  })

  it('queues on a fresh install (undecided) and ships on the grant transition', () => {
    telemetry.setConsentState('undecided')
    bindTestAnonymous('install-id')
    captured.length = 0

    telemetry.captureFirstLaunch({ id_class: 'machine_derived', locale: 'en' })
    expect(captured).toHaveLength(0)

    telemetry.setConsentState('granted')

    const ev = captured.find((c) => c.event === 'comfy.desktop.app.first_launch')
    expect(ev?.distinctId).toBe('install-id')
    expect(ev?.properties).toMatchObject({ id_class: 'machine_derived', locale: 'en' })
  })

  it('captures immediately when consent is already granted', () => {
    telemetry.setConsentState('granted')
    bindTestAnonymous('install-id')
    captured.length = 0

    telemetry.captureFirstLaunch({ id_class: 'random_uuid', locale: 'fr' })

    const ev = captured.find((c) => c.event === 'comfy.desktop.app.first_launch')
    expect(ev?.properties).toMatchObject({ id_class: 'random_uuid', locale: 'fr' })
  })
})

describe('telemetry Firebase consensus identity lifecycle', () => {
  beforeEach(() => {
    setupTelemetry({ bind: null })
    telemetry.bindAnonymousId('anonymous-start', 'installation-id-fake')
  })

  it('identifies Firebase UID with the active W/D and deferred person properties', () => {
    identifies.length = 0
    captured.length = 0
    telemetry.registerPersonProperties({ gpu_tier: 'high' })
    telemetry.registerPersonProperties({ email_domain: 'example.com' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'first' })

    expect(captured).toHaveLength(0)

    telemetry.applyFirebaseUserConsensus('user-123')

    const last = identifies.at(-1)!
    expect(last.distinctId).toBe('user-123')
    expect(last.properties?.$anon_distinct_id).toBe('anonymous-start')
    expect(last.properties?.$set).toMatchObject({
      is_authenticated: true,
      email_domain: 'example.com',
      gpu_tier: 'high',
      installation_id: 'installation-id-fake'
    })
    expect(last.properties?.$set_once).toEqual({ first_generation_at: 'first' })
    expect(captured.find((c) => c.event === 'app:user_logged_in')).toBeUndefined()
    telemetry.capture('authenticated.event')
    expect(captured.at(-1)?.properties).not.toHaveProperty('$process_person_profile')
  })

  it('keeps pre-first-login enrichment through a signed-out report while unbound', () => {
    identifies.length = 0
    telemetry.registerPersonProperties({ gpu_tier: 'high' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'first' })

    telemetry.applyFirebaseAnonymousConsensus()

    expect(anonymousIdentityMock.index).toBe(0)
    expect(captured.find((c) => c.event === 'comfy.desktop.person.set')).toBeUndefined()

    telemetry.applyFirebaseUserConsensus('user-123')

    const last = identifies.at(-1)!
    expect(last.properties?.$set).toMatchObject({ gpu_tier: 'high' })
    expect(last.properties?.$set_once).toEqual({ first_generation_at: 'first' })
  })

  it('replays an unacknowledged identity merge after restart', async () => {
    posthogClientMock.autoFailNextIdentifies = 1

    telemetry.registerPersonProperties({ gpu_tier: 'high' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'first' })
    telemetry.applyFirebaseUserConsensus('user-123')
    await vi.waitFor(() => expect(pendingIdentityMergeMock.entries).toHaveLength(1))

    telemetry._resetForTest()
    identifies.length = 0
    telemetry.initTelemetry({ appVersion: '0.0.0', appEnv: 'test', isPackaged: true })
    telemetry.setConsentState('granted')
    telemetry.bindAnonymousId('anonymous-next-1', 'installation-id-fake')

    await vi.waitFor(() => expect(pendingIdentityMergeMock.entries).toHaveLength(0))
    expect(identifies).toContainEqual({
      distinctId: 'user-123',
      properties: {
        $set: {
          gpu_tier: 'high',
          installation_id: 'installation-id-fake',
          is_authenticated: true
        },
        $set_once: { first_generation_at: 'first' },
        $anon_distinct_id: 'anonymous-start'
      }
    })
  })

  it('requeues an unacknowledged identity merge on a later same-process trigger', async () => {
    posthogClientMock.autoFailNextIdentifies = 1

    telemetry.applyFirebaseUserConsensus('user-123')
    expect(pendingIdentityMergeMock.entries).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    identifies.length = 0

    telemetry.applyFirebaseUserConsensus('user-123')

    await vi.waitFor(() => expect(pendingIdentityMergeMock.entries).toHaveLength(0))
    expect(identifies).toContainEqual(
      expect.objectContaining({
        distinctId: 'user-123',
        properties: expect.objectContaining({ $anon_distinct_id: 'anonymous-start' })
      })
    )
  })

  it('keeps repeated binds of the same Firebase UID idempotent', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    expect(identifies).toHaveLength(1)
    expect(anonymousIdentityMock.index).toBe(1)
    captured.length = 0

    telemetry.applyFirebaseUserConsensus('user-123')

    expect(identifies).toHaveLength(1)
    expect(anonymousIdentityMock.index).toBe(1)
    expect(captured).toHaveLength(0)

    telemetry.registerPersonProperties({ plan: 'pro' })
    telemetry.applyFirebaseUserConsensus('user-123')

    expect(identifies).toHaveLength(1)
    expect(anonymousIdentityMock.index).toBe(1)
    expect(captured.filter((call) => call.event === 'app:user_logged_in')).toHaveLength(0)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      distinctId: 'user-123',
      event: 'comfy.desktop.person.set',
      properties: { $set: { plan: 'pro' } }
    })
  })

  it('anonymous consensus adopts the fresh D reserved before bind', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    identifies.length = 0
    captured.length = 0

    telemetry.applyFirebaseAnonymousConsensus()

    expect(identifies).toHaveLength(0)
    const personSet = captured.find((c) => c.event === 'comfy.desktop.person.set')
    expect(personSet?.distinctId).toBe('user-123')
    expect((personSet?.properties as { $set?: Record<string, unknown> })?.$set).toEqual({
      is_authenticated: false
    })

    telemetry.capture('any.event', { foo: 1 })
    expect(captured.at(-1)?.distinctId).toBe('anonymous-next-1')
    expect(captured.at(-1)?.properties).toMatchObject({
      installation_id: 'installation-id-fake',
      $process_person_profile: false
    })
  })

  it('quarantines authenticated writes while pending and replays them on same-user resolution', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    identifies.length = 0
    captured.length = 0
    exceptions.length = 0

    telemetry.applyFirebasePendingConsensus()
    expect(telemetry.capture('pending.event')).toBe(true)
    telemetry.captureException(new Error('pending'))
    telemetry.registerPersonProperties({ plan: 'pro' })

    expect(identifies).toHaveLength(0)
    expect(captured).toHaveLength(0)
    expect(exceptions).toHaveLength(0)
    expect(anonymousIdentityMock.index).toBe(1)

    telemetry.applyFirebaseUserConsensus('user-123')

    expect(identifies).toHaveLength(0)
    expect(captured.map((call) => call.event)).toContain('pending.event')
    expect(exceptions).toHaveLength(1)
    expect(captured.every((call) => call.distinctId === 'user-123')).toBe(true)
    expect(captured.at(-1)).toMatchObject({
      distinctId: 'user-123',
      event: 'comfy.desktop.person.set',
      properties: { $set: { plan: 'pro' } }
    })
    telemetry.capture('resolved.event')
    expect(captured.at(-1)?.distinctId).toBe('user-123')
  })

  it('discards quarantined writes when pending resolves to a different user', () => {
    telemetry.applyFirebaseUserConsensus('user-a')
    captured.length = 0
    exceptions.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.capture('during.switch')
    telemetry.captureException(new Error('during switch'))
    telemetry.applyFirebaseUserConsensus('user-b')

    expect(captured.filter((call) => call.event === 'during.switch')).toHaveLength(0)
    expect(exceptions).toHaveLength(0)
  })

  it('release ends the quarantine keeping the bound identity and replays held writes', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    identifies.length = 0
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.capture('held.event')
    expect(captured).toHaveLength(0)

    telemetry.releaseFirebasePendingConsensus()

    expect(identifies).toHaveLength(0)
    expect(captured.map((call) => call.event)).toContain('held.event')
    expect(captured.every((call) => call.distinctId === 'user-123')).toBe(true)
    telemetry.capture('after.release')
    expect(captured.at(-1)?.distinctId).toBe('user-123')
  })

  it('drains quarantined writes and the session end through a mid-navigation quit', async () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.capture('before.quit')
    await telemetry.shutdown('quit')

    expect(captured.map((call) => call.event)).toContain('before.quit')
    const ended = captured.find((call) => call.event === 'comfy.desktop.session.ended')
    expect(ended?.distinctId).toBe('user-123')
  })

  it('captures a still-staged login attribution during shutdown', async () => {
    telemetry.stageLoginAttribution('user-123', { via: 'desktop_login_code' })
    captured.length = 0

    await telemetry.shutdown('quit')

    expect(
      captured.filter((call) => call.event === 'comfy.desktop.identity.login_attributed')
    ).toEqual([
      expect.objectContaining({
        properties: expect.objectContaining({ via: 'desktop_login_code' })
      })
    ])
  })

  it('discards a staged attribution at shutdown while a different user is still bound', async () => {
    telemetry.applyFirebaseUserConsensus('user-a')
    telemetry.applyFirebasePendingConsensus()
    telemetry.stageLoginAttribution('user-b', { via: 'desktop_login_code' })
    captured.length = 0

    await telemetry.shutdown('quit')

    expect(
      captured.filter((call) => call.event === 'comfy.desktop.identity.login_attributed')
    ).toHaveLength(0)
    const ended = captured.find((call) => call.event === 'comfy.desktop.session.ended')
    expect(ended?.distinctId).toBe('user-a')
  })

  it('rate-limits at queue time and replays without re-tripping the limiter', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    for (let i = 0; i < 60; i++) {
      expect(telemetry.capture('burst.event', { i })).toBe(true)
    }
    expect(telemetry.capture('burst.event', { i: 60 })).toBe(false)

    telemetry.applyFirebaseUserConsensus('user-123')

    expect(captured.filter((call) => call.event === 'burst.event')).toHaveLength(60)
    expect(
      captured.filter((call) => call.event === 'comfy.desktop.telemetry.rate_limited')
    ).toHaveLength(0)
    expect(captured.find((call) => call.event === 'burst.event')?.timestamp).toBeInstanceOf(Date)
  })

  it('defers emit() renderer forwarding with the quarantined write until it ships', () => {
    const { wc, sends } = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(wc)
    telemetry.applyFirebaseUserConsensus('user-123')
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.emit('comfy.desktop.execution.error', { variant: 'standalone' })
    expect(sends).toHaveLength(0)

    telemetry.applyFirebaseUserConsensus('user-123')

    expect(captured.map((call) => call.event)).toContain('comfy.desktop.execution.error')
    expect(sends).toHaveLength(1)
  })

  it('drops the deferred Datadog mirror when a quarantined exception is discarded', () => {
    const { wc, sends } = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(wc)
    telemetry.applyFirebaseUserConsensus('user-a')
    captured.length = 0
    exceptions.length = 0

    telemetry.applyFirebasePendingConsensus()
    expect(telemetry.captureExceptionAndForward(new Error('boom'), { source: 'test' })).toBe(true)
    expect(sends).toHaveLength(0)
    expect(exceptions).toHaveLength(0)

    telemetry.applyFirebaseUserConsensus('user-b')

    expect(exceptions).toHaveLength(0)
    expect(sends).toHaveLength(0)
  })

  it('applies $set_once markers deferred by the quarantine before a signed-out detach', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.registerPersonPropertiesOnce({ first_local_install_completed_at: 't1' })
    expect(captured).toHaveLength(0)

    telemetry.applyFirebaseAnonymousConsensus()

    const sets = captured.filter((call) => call.event === 'comfy.desktop.person.set')
    expect(sets[0]).toMatchObject({
      distinctId: 'user-123',
      properties: { $set_once: { first_local_install_completed_at: 't1' } }
    })
  })

  it('keeps anonymous events flowing while first-login consensus is pending', () => {
    telemetry.applyFirebasePendingConsensus()
    telemetry.capture('anon.event')

    expect(captured.at(-1)).toMatchObject({
      distinctId: 'anonymous-start',
      event: 'anon.event',
      properties: expect.objectContaining({ $process_person_profile: false })
    })
  })

  it('emits login attribution when a same-user re-authentication resolves', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    identifies.length = 0
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.stageLoginAttribution('user-123', { via: 'desktop_login_code' })
    telemetry.bindUserId('user-123', {})

    expect(identifies).toHaveLength(0)
    expect(
      captured.filter((call) => call.event === 'comfy.desktop.identity.login_attributed')
    ).toEqual([
      expect.objectContaining({
        distinctId: 'user-123',
        properties: expect.objectContaining({ via: 'desktop_login_code' })
      })
    ])
  })

  it('attributes an account-switch login to the new UID at bind time', () => {
    telemetry.applyFirebaseUserConsensus('user-a')
    identifies.length = 0
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.stageLoginAttribution('user-b', { via: 'desktop_login_code' })
    telemetry.bindUserId('user-b', {})

    expect(identifies).toHaveLength(1)
    expect(identifies[0]).toMatchObject({
      distinctId: 'user-b',
      properties: { $anon_distinct_id: 'anonymous-next-1' }
    })
    expect(
      captured.filter((call) => call.event === 'comfy.desktop.identity.login_attributed')
    ).toEqual([
      expect.objectContaining({
        distinctId: 'user-b',
        properties: expect.objectContaining({ via: 'desktop_login_code' })
      })
    ])
  })

  it('discards a staged login attribution when consensus resolves signed out first', () => {
    telemetry.setConsentState('undecided')
    telemetry.stageLoginAttribution('user-b', { via: 'desktop_login_code' })
    telemetry.bindUserId('user-b', {})
    telemetry.applyFirebaseAnonymousConsensus()
    telemetry.setConsentState('granted')
    telemetry.applyFirebaseUserConsensus('user-b')

    expect(
      captured.filter((call) => call.event === 'comfy.desktop.identity.login_attributed')
    ).toHaveLength(0)
  })

  it('discards a staged login attribution when a different user is confirmed', () => {
    telemetry.stageLoginAttribution('user-a', { via: 'desktop_login_code' })
    telemetry.applyFirebaseUserConsensus('user-b')
    telemetry.applyFirebaseUserConsensus('user-a')

    expect(
      captured.filter((call) => call.event === 'comfy.desktop.identity.login_attributed')
    ).toHaveLength(0)
  })

  it('does not flush a deferred UID while renderer consensus is pending', () => {
    telemetry.setConsentState('undecided')
    telemetry.applyFirebaseUserConsensus('user-123')
    telemetry.applyFirebasePendingConsensus()

    telemetry.setConsentState('granted')
    expect(identifies).toHaveLength(0)

    telemetry.applyFirebaseUserConsensus('user-123')
    expect(identifies).toHaveLength(1)
    expect(identifies[0]?.distinctId).toBe('user-123')
  })

  it('performs the full anonymous transition only after pending resolves signed out', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    captured.length = 0

    telemetry.applyFirebasePendingConsensus()
    telemetry.applyFirebaseAnonymousConsensus()

    const personSet = captured.find((call) => call.event === 'comfy.desktop.person.set')
    expect(personSet).toMatchObject({
      distinctId: 'user-123',
      properties: { $set: { is_authenticated: false } }
    })
    telemetry.capture('after.confirmed.logout')
    expect(captured.at(-1)?.distinctId).toBe('anonymous-next-1')
  })

  it('ends the pending quarantine when consensus resolves while consent is denied', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    telemetry.applyFirebasePendingConsensus()

    telemetry.setConsentState('denied')
    telemetry.applyFirebaseUserConsensus('user-123')
    telemetry.setConsentState('granted')
    captured.length = 0

    expect(telemetry.capture('after.denied.resolution')).toBe(true)
    expect(captured.at(-1)?.distinctId).toBe('user-123')
  })

  it('detaches the stale binding when an account switch resolves during denied consent', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    telemetry.applyFirebasePendingConsensus()

    telemetry.setConsentState('denied')
    telemetry.applyFirebaseUserConsensus('user-456')
    telemetry.setConsentState('granted')

    captured.length = 0
    expect(telemetry.capture('between.replays')).toBe(true)
    expect(captured.at(-1)?.distinctId).toBe('anonymous-next-1')

    telemetry.applyFirebaseUserConsensus('user-456')
    captured.length = 0
    telemetry.capture('after.switch')
    expect(captured.at(-1)?.distinctId).toBe('user-456')
  })

  it('uses a different anonymous D for an account switch', () => {
    telemetry.applyFirebaseUserConsensus('user-123')
    captured.length = 0

    telemetry.applyFirebaseUserConsensus('user-456')

    expect(identifies.at(-1)).toMatchObject({
      distinctId: 'user-456',
      properties: { $anon_distinct_id: 'anonymous-next-1' }
    })
    expect(
      captured.find(
        (call) => call.event === 'comfy.desktop.person.set' && call.distinctId === 'user-123'
      )
    ).toBeDefined()

    telemetry.applyFirebaseAnonymousConsensus()
    telemetry.capture('after.switch.logout')
    expect(captured.at(-1)?.distinctId).toBe('anonymous-next-2')
  })

  it('defers Firebase UID until consent is granted', () => {
    telemetry.setConsentState('undecided')
    identifies.length = 0
    captured.length = 0
    telemetry.applyFirebaseUserConsensus('user-456')
    expect(identifies).toHaveLength(0)
    expect(captured).toHaveLength(0)

    telemetry.setConsentState('granted')

    expect(identifies.at(-1)).toMatchObject({
      distinctId: 'user-456',
      properties: { $anon_distinct_id: 'anonymous-start' }
    })
  })

  it('binds a main-verified interactive sign-in through the consensus path', () => {
    telemetry.bindUserId('bridge-user', { plan: 'pro' })

    expect(identifies).toHaveLength(1)
    expect(identifies.at(-1)).toMatchObject({
      distinctId: 'bridge-user',
      properties: expect.objectContaining({
        $anon_distinct_id: 'anonymous-start',
        $set: expect.objectContaining({ plan: 'pro' })
      })
    })
    expect(captured.find((c) => c.event === 'app:user_logged_in')).toMatchObject({
      distinctId: 'bridge-user'
    })

    telemetry.bindUserId('bridge-user', { plan: 'pro' })
    expect(identifies).toHaveLength(1)
  })

  it('fails closed without identifying when the next D cannot be persisted', () => {
    anonymousIdentityMock.fail = true
    identifies.length = 0

    telemetry.applyFirebaseUserConsensus('user-123')
    telemetry.capture('still.anonymous')

    expect(identifies).toHaveLength(0)
    expect(captured.at(-1)).toMatchObject({
      distinctId: 'anonymous-start',
      properties: { $process_person_profile: false }
    })
  })
})

describe('telemetry.forwardToRenderer + telemetry-relay registry', () => {
  beforeEach(() => {
    setupTelemetry()
    captured.length = 0
  })

  it('forwards to every registered relay target with mainAlreadyCaptured=true', () => {
    const a = makeStubWebContents()
    const b = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)
    telemetry.registerTelemetryRelayTarget(b.wc)

    telemetry.forwardToRenderer('comfy.desktop.execution.error', { foo: 'bar' })

    expect(a.sends).toHaveLength(1)
    expect(a.sends[0]).toMatchObject({
      channel: 'telemetry-action-from-main',
      data: {
        event: 'comfy.desktop.execution.error',
        context: { foo: 'bar' },
        mainAlreadyCaptured: true
      }
    })
    expect(b.sends).toHaveLength(1)
    expect(b.sends[0]).toMatchObject({
      data: { mainAlreadyCaptured: true }
    })
  })

  it('forwards a bare notice to Datadog when no error is supplied', () => {
    const target = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(target.wc)

    telemetry.forwardExceptionToRenderer({
      origin: 'renderer',
      source: 'renderer-window-error',
      reason: 'crashed',
      error_message: 'private failure text',
      error_stack: 'private stack'
    })

    expect(target.sends).toHaveLength(1)
    expect(target.sends[0]).toMatchObject({
      channel: 'dd-error',
      data: {
        source: 'renderer-window-error',
        message: 'Desktop application exception',
        context: { origin: 'renderer', source: 'renderer-window-error', reason: 'crashed' },
        skipPostHog: true
      }
    })
    const forwarded = target.sends[0]!.data as Record<string, unknown>
    const forwardedContext = forwarded['context'] as Record<string, unknown>
    expect(forwarded).not.toHaveProperty('stack')
    expect(forwardedContext).not.toHaveProperty('error_message')
    expect(forwardedContext).not.toHaveProperty('error_stack')
  })

  it('forwards the scrubbed message, stack and error_type so a monitor can tell failures apart', () => {
    const target = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(target.wc)
    const scrubbed = new Error('workspace auth gate failed to initialise')
    scrubbed.stack = 'Error: workspace auth gate failed to initialise\n at gate.ts:1:1'

    telemetry.forwardExceptionToRenderer(
      {
        origin: 'renderer',
        source: 'hosted-frontend',
        error_type: 'workspace_auth_gate_initialization_failure',
        error_message: 'private failure text'
      },
      scrubbed
    )

    expect(target.sends[0]).toMatchObject({
      channel: 'dd-error',
      data: {
        message: 'workspace auth gate failed to initialise',
        stack: scrubbed.stack,
        context: { error_type: 'workspace_auth_gate_initialization_failure' },
        skipPostHog: true
      }
    })
    const forwardedContext = (target.sends[0]!.data as Record<string, unknown>)[
      'context'
    ] as Record<string, unknown>
    expect(forwardedContext).not.toHaveProperty('error_message')
  })

  it('suppresses the PostHog exception copy unless the product-scoped flag opts in', () => {
    delete process.env['COMFY_DESKTOP_POSTHOG_EXCEPTIONS']
    const target = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(target.wc)

    telemetry.captureExceptionAndForward(new Error('boom'), {
      error_type: 'workspace_auth_gate_initialization_failure'
    })

    expect(exceptions).toHaveLength(0)
    expect(target.sends).toHaveLength(1)
    expect(target.sends[0]).toMatchObject({
      channel: 'dd-error',
      data: { message: 'boom' }
    })
  })

  it('emit() captures via PostHog Node AND forwards to relay targets', () => {
    const a = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)

    telemetry.emit('comfy.desktop.execution.error', { variant: 'standalone' })

    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.execution.error'])
    expect(captured[0]!.properties).toMatchObject({ variant: 'standalone' })
    expect(a.sends).toHaveLength(1)
    expect(a.sends[0]).toMatchObject({
      channel: 'telemetry-action-from-main',
      data: {
        event: 'comfy.desktop.execution.error',
        context: { variant: 'standalone' },
        mainAlreadyCaptured: true
      }
    })
  })

  it('only forwards the one-shot warning after the shared session cap is reached', () => {
    const target = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(target.wc)
    telemetry._test_resetVolumeGuards()
    for (let i = 0; i < 5000; i++) {
      telemetry.capture('comfy.desktop.execution.error', { i })
    }

    telemetry.emit('comfy.desktop.execution.error', { i: 5001 })

    expect(target.sends).toHaveLength(1)
    expect(target.sends[0]).toMatchObject({
      data: { event: 'comfy.desktop.telemetry.session_cap_hit', mainAlreadyCaptured: true }
    })
  })

  it('forwards with no relay targets is a no-op (event still captured by PostHog Node)', () => {
    expect(telemetry._telemetryRelayTargetCount()).toBe(0)
    telemetry.emit('comfy.desktop.execution.error', {})
    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.execution.error'])
  })

  it('skips forwarding for events NOT in the Datadog mirror allow-list (provider split)', () => {
    const a = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)

    telemetry.emit('comfy.desktop.install.flow.opened', { variant: 'standalone' })

    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.install.flow.opened'])
    expect(a.sends).toHaveLength(0)
  })

  it('respects consent on forwardToRenderer: relay is skipped when revoked', () => {
    const a = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)
    telemetry.setConsent(false)
    telemetry.forwardToRenderer('comfy.desktop.execution.error', {})
    expect(a.sends).toHaveLength(0)
  })

  it('skips destroyed relay targets', () => {
    const a = makeStubWebContents()
    const b = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)
    telemetry.registerTelemetryRelayTarget(b.wc)
    a.destroy()

    telemetry.forwardToRenderer('comfy.desktop.execution.error', {})

    expect(a.sends).toHaveLength(0)
    expect(b.sends).toHaveLength(1)
  })

  it('auto-removes relay targets on the WebContents `destroyed` event', () => {
    const a = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)
    expect(telemetry._telemetryRelayTargetCount()).toBe(1)

    a.destroy()
    expect(telemetry._telemetryRelayTargetCount()).toBe(0)
  })

  it('unregisterTelemetryRelayTarget removes the target', () => {
    const a = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)
    expect(telemetry._telemetryRelayTargetCount()).toBe(1)

    telemetry.unregisterTelemetryRelayTarget(a.wc)
    expect(telemetry._telemetryRelayTargetCount()).toBe(0)

    telemetry.forwardToRenderer('comfy.desktop.execution.error', {})
    expect(a.sends).toHaveLength(0)
  })
})

describe('telemetry SDK-level volume guards', () => {
  beforeEach(() => {
    setupTelemetry()
    captured.length = 0
  })

  it('per-event sliding window caps at 60/window and emits exactly one rate_limited warning', () => {
    for (let i = 0; i < 100; i++) {
      telemetry.capture('comfy.desktop.test.event', { i })
    }
    const product = captured.filter((c) => c.event === 'comfy.desktop.test.event')
    const warnings = captured.filter((c) => c.event === 'comfy.desktop.telemetry.rate_limited')
    expect(product).toHaveLength(60)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.properties).toMatchObject({
      event_name: 'comfy.desktop.test.event',
      limit: 60,
      window_ms: 60_000,
      $process_person_profile: false
    })
  })

  it('does not consume the event or process budget when the SDK capture throws', () => {
    posthogClientMock.failNextCaptures = 1
    expect(telemetry.capture('comfy.desktop.test.event', { attempt: 0 })).toBe(false)

    for (let i = 0; i < 60; i++) {
      expect(telemetry.capture('comfy.desktop.test.event', { attempt: i + 1 })).toBe(true)
    }
    expect(telemetry.capture('comfy.desktop.test.event', { attempt: 61 })).toBe(false)

    const product = captured.filter((c) => c.event === 'comfy.desktop.test.event')
    const warnings = captured.filter((c) => c.event === 'comfy.desktop.telemetry.rate_limited')
    expect(product).toHaveLength(60)
    expect(warnings).toHaveLength(1)
  })

  it('warning fires once per (event-name, process) — no warning spam', () => {
    for (let i = 0; i < 200; i++) {
      telemetry.capture('comfy.desktop.test.event', { i })
    }
    const warnings = captured.filter((c) => c.event === 'comfy.desktop.telemetry.rate_limited')
    expect(warnings).toHaveLength(1)
  })

  it('different event names have independent windows', () => {
    for (let i = 0; i < 100; i++) {
      telemetry.capture('comfy.desktop.test.a', { i })
      telemetry.capture('comfy.desktop.test.b', { i })
    }
    const a = captured.filter((c) => c.event === 'comfy.desktop.test.a')
    const b = captured.filter((c) => c.event === 'comfy.desktop.test.b')
    expect(a).toHaveLength(60)
    expect(b).toHaveLength(60)
  })

  it('*.error events bypass the per-event rate limit', () => {
    for (let i = 0; i < 200; i++) {
      telemetry.capture('comfy.desktop.execution.error', { i })
    }
    const errors = captured.filter((c) => c.event === 'comfy.desktop.execution.error')
    expect(errors).toHaveLength(200)
    const warnings = captured.filter((c) => c.event === 'comfy.desktop.telemetry.rate_limited')
    expect(warnings).toHaveLength(0)
  })

  it('telemetry-self events bypass the rate limit (no recursion when warning fires)', () => {
    for (let i = 0; i < 200; i++) {
      telemetry.capture('comfy.desktop.telemetry.rate_limited', { i })
    }
    const selfEvents = captured.filter((c) => c.event === 'comfy.desktop.telemetry.rate_limited')
    expect(selfEvents).toHaveLength(200)
  })

  it('per-process cap at 5000 stops everything (including *.error) and warns once', () => {
    for (let i = 0; i < 6000; i++) {
      telemetry.capture('comfy.desktop.execution.error', { i })
    }
    const productEvents = captured.filter(
      (c) => c.event !== 'comfy.desktop.telemetry.session_cap_hit'
    )
    const sessionCapWarnings = captured.filter(
      (c) => c.event === 'comfy.desktop.telemetry.session_cap_hit'
    )
    expect(productEvents).toHaveLength(5000)
    expect(sessionCapWarnings).toHaveLength(1)
    expect(sessionCapWarnings[0]?.properties).toMatchObject({ cap: 5000 })
  })

  it('counts captured exceptions toward the per-process cap', () => {
    exceptions.length = 0
    for (let i = 0; i < 4999; i++) {
      telemetry.capture('comfy.desktop.execution.error', { i })
    }

    telemetry.captureException(new Error('accepted'))
    telemetry.captureException(new Error('dropped'))

    expect(exceptions).toHaveLength(1)
    expect((exceptions[0]!.error as Error).message).toBe('accepted')
    expect(
      captured.filter((c) => c.event === 'comfy.desktop.telemetry.session_cap_hit')
    ).toHaveLength(1)
  })
})
