import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import type { TelemetryValue } from './telemetry'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: true,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

/**
 * Build a stub WebContents that records `send()` calls and emits
 * `'destroyed'` so the relay registry can self-clean. Mirrors the surface
 * the production registry actually consumes.
 */
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
const featureFlagCalls: Array<{
  key: string
  distinctId: string
  options?: { sendFeatureFlagEvents?: boolean }
}> = []

const posthogClientMock = vi.hoisted(() => ({
  failNextCaptures: 0,
  failNextFlushes: 0,
  autoFailNextIdentifies: 0,
  failNextExceptionCaptures: 0,
  constructorOptions: [] as Array<Record<string, unknown>>
}))

vi.mock('posthog-node', () => ({
  PostHog: class {
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    private queuedIdentifies: Array<Record<string, unknown>> = []

    constructor(_apiKey: string, options: Record<string, unknown>) {
      posthogClientMock.constructorOptions.push(options)
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
      if (posthogClientMock.failNextExceptionCaptures > 0) {
        posthogClientMock.failNextExceptionCaptures--
        throw new Error('sdk rejected exception')
      }
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
    getFeatureFlag(
      key: string,
      distinctId: string,
      options?: { sendFeatureFlagEvents?: boolean }
    ): Promise<undefined> {
      featureFlagCalls.push({ key, distinctId, options })
      return Promise.resolve(undefined)
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

const telemetry = await import('./telemetry')

function bindTestAnonymous(id: string, properties: Record<string, TelemetryValue> = {}): void {
  telemetry.bindAnonymousId(id, id, properties)
}

interface SetupTelemetryOptions {
  /** Consent state to apply after init; `null` leaves the post-reset 'undecided'. */
  consent?: 'granted' | 'denied' | 'undecided' | null
  /** Anonymous D to bind after the consent transition; `null` skips binding. */
  bind?: string | null
  appVersion?: string
  appEnv?: string
}

/**
 * Reset module state and the capture buffers, then run the standard boot
 * sequence: init → consent → bind D. Volume guards are reset LAST so the
 * `session.started` flushed by a granted-consent bind never counts toward a
 * test's rate-limit or session-cap totals. Buffers are cleared at the start
 * only — tests that measure from a later point clear `captured` themselves.
 */
function setupTelemetry(options: SetupTelemetryOptions = {}): void {
  const {
    consent = 'granted',
    bind = 'test-distinct-id',
    appVersion = '0.0.0',
    appEnv = 'test'
  } = options
  captured.length = 0
  identifies.length = 0
  exceptions.length = 0
  featureFlagCalls.length = 0
  process.env['POSTHOG_API_KEY'] = 'test-key'
  process.env['POSTHOG_ENABLED'] = '1'
  telemetry._resetForTest()
  telemetry._resetTelemetryRelayTargets()
  telemetry.initTelemetry({ appVersion, appEnv, isPackaged: true })
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
  posthogClientMock.failNextExceptionCaptures = 0
  posthogClientMock.constructorOptions.length = 0
  pendingIdentityMergeMock.entries = []
  pendingIdentityMergeMock.nextId = 1
  delete process.env['POSTHOG_API_KEY']
  delete process.env['POSTHOG_ENABLED']
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
    // CUDA / system / Linux OOM-killer
    ['CUDA out of memory', 'oom'],
    ['torch.cuda.OutOfMemoryError: blah', 'oom'],
    ['Killed: process exceeded memory', 'oom'],
    ['CUDA not available', 'cuda_init'],
    ['no CUDA-capable device is detected', 'cuda_init'],
    ['ImportError: cannot import name xformers', 'import_error'],
    ['ModuleNotFoundError: No module named foo', 'import_error'],
    ['node not found: SomeCustomNode', 'node_missing'],
    ['Unknown node type FooNode', 'node_missing'],
    // Generic <Class>Error messages fall back to "python".
    ['RuntimeError: something broke', 'python'],
    ['ValueError: bad input', 'python'],
    // scrubAll can strip a leading path and leave the class name in the
    // middle; previously the `^`-anchored regex would miss this and the
    // event landed in `other`.
    ['execution failed -> RuntimeError: bad input', 'python'],
    ['Got AttributeError while computing', 'python'],
    // The python regex requires an uppercase first letter on the class
    // name — without that, lowercase noise like "user.error: oops" or
    // "config.exception in foo" would slide into the python bucket and
    // pollute the dashboard.
    ['see module.error somewhere in foo.py', 'other'],
    ['the user.exception field is set', 'other'],
    // Tensor / shape mismatches
    ['size mismatch for transformer.h.0.weight', 'shape_mismatch'],
    ["shape '[1, 4, 64, 64]' is invalid for input of size 16384", 'shape_mismatch'],
    ['expected 4 dimensions but got 3', 'shape_mismatch'],
    // Model-load failures
    ['Error while deserializing header: invalid byte 0x12', 'model_load'],
    ['Missing key(s) in state_dict: "transformer.h.0.weight"', 'model_load'],
    ['safetensors_rust.SafetensorError: corrupted', 'model_load'],
    // Workflow-validation failures
    ['Prompt outputs failed validation', 'validation'],
    ['validation_failed for node 5', 'validation'],
    // Migration source-missing failures, observed at launch: gitcode mirror
    // clones that stall mid-stream, and Desktop 1 trees that lost their
    // ComfyUI source path so the adopter has neither a staged copy nor a
    // working clone to source.
    [
      'source-missing: Downloading ComfyUI source from https://gitcode.com/gh_mirrors/co/ComfyUI.git',
      'source_missing'
    ],
    ['source_missing', 'source_missing'],
    // No known signal
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

    telemetry.captureException(new Error('boom'), { foo: 'bar' })

    expect(exceptions).toHaveLength(1)
    expect(exceptions[0]!.properties).toMatchObject({
      foo: 'bar',
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

    // A main-process event and a renderer-routed event both go through
    // capture(), so both must carry installation_id from the defaults.
    telemetry.capture('comfy.desktop.execution.completed', { foo: 'bar' })
    telemetry.capture('comfy.desktop.template.fork', { template_id: 't1' })

    expect(captured).toHaveLength(2)
    expect(captured[0]!.properties).toMatchObject({ installation_id: 'install-abc123' })
    expect(captured[1]!.properties).toMatchObject({ installation_id: 'install-abc123' })
  })

  it('does not identify installation_id or anonymous D at boot', () => {
    setupTelemetry({ appVersion: '1.0.0', appEnv: 'prod', bind: 'install-abc123' })

    // bindAnonymousId stamps installation_id only as a property. Only the
    // Firebase UID login path may call the SDK's identify.
    expect(identifies).toHaveLength(0)
  })
})

describe('telemetry anonymous flag reads', () => {
  it('disables PostHog implicit feature-flag capture', async () => {
    setupTelemetry({ consent: null, bind: null })
    telemetry.bindAnonymousId('anonymous-flag-id', 'installation-id')
    featureFlagCalls.length = 0

    await telemetry.getOpsFlag('desktop-cloud-capacity', 'anonymous-flag-id', 100)

    expect(featureFlagCalls).toEqual([
      {
        key: 'desktop-cloud-capacity',
        distinctId: 'anonymous-flag-id',
        options: { sendFeatureFlagEvents: false }
      }
    ])
  })

  it('constructs the client with sendFeatureFlagEvent: false so NO flag read can emit $feature_flag_called', () => {
    // Client-level default, not just the getOpsFlag per-call opt-out: a
    // future getFeatureFlag/isFeatureEnabled call site must not silently
    // reintroduce a per-evaluation event (3.37M/28d at its peak, 91.7% of it
    // the boot-time desktop-cloud-capacity read).
    setupTelemetry()
    expect(posthogClientMock.constructorOptions.at(-1)).toMatchObject({
      sendFeatureFlagEvent: false
    })
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

    // The milestone stays deferred while anonymous and lands on Firebase UID.
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
    // boot_started -> boot_completed is the per-attempt boot-success funnel.
    // Both must carry the same boot_id (the per-launch correlation id) and
    // installation_id (the cross-event join key from defaults) so the rate is
    // count(boot_completed.boot_id) / count(distinct boot_started.boot_id).
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
    // A boot is the per-launch event; install.completed is once-per-install.
    // Emitting boot_started must never produce an install.completed.
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
    // The raw IP and sub-country geo are dropped by a PostHog ingestion
    // transformation, not at the SDK; the SDK must send the IP so the
    // server can resolve $geoip_country_code. So no forced `$ip: ''`.
    captured.length = 0
    telemetry.capture('comfy.desktop.session.started', { foo: 'bar' })
    expect(captured).toHaveLength(1)
    expect(captured[0]!.properties).not.toHaveProperty('$ip')
  })

  it('scrubs string properties as a last-resort safety net for emit sites that forget', () => {
    captured.length = 0
    // Simulates a call site that forgot to scrub locally — typical
    // future-regression risk. The SDK pass redacts the path.
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
    telemetry.capture('comfy.desktop.execution.completed', {
      duration_seconds: 12.5,
      completed_count: 7,
      crashed: false
    })
    const props = captured[0]!.properties
    expect(props?.duration_seconds).toBe(12.5)
    expect(props?.completed_count).toBe(7)
    expect(props?.crashed).toBe(false)
  })
})

describe('telemetry consent state (3-state)', () => {
  beforeEach(() => {
    // Bind D after state changes per test so the deferral path is exercised.
    setupTelemetry({ consent: null, bind: null })
  })

  it('undecided suppresses regular events but allows the consent_decision event', () => {
    telemetry.setConsentState('undecided')
    bindTestAnonymous('test-distinct-id')
    captured.length = 0

    telemetry.capture('comfy.desktop.execution.started', { foo: 'bar' })
    telemetry.capture('comfy.desktop.first_use.consent_decision', { accepted: false })

    const events = captured.map((c) => c.event)
    expect(events).toEqual(['comfy.desktop.first_use.consent_decision'])
  })

  it('denied suppresses everything EXCEPT the consent_decision allow-list entry', () => {
    // Regression for the 2026-06-03 finding: 232 accepts and 0 declines in
    // 30 days, traced to the renderer's "Continue" handler awaiting the
    // setting write (which flips state to 'denied') BEFORE emitting the
    // decline event. If denied short-circuits without consulting the
    // allow-list, every decline is dropped by its own decision and we
    // lose 100% of decline signal.
    telemetry.setConsentState('denied')
    bindTestAnonymous('test-distinct-id')
    captured.length = 0

    telemetry.capture('comfy.desktop.execution.started', {})
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

    // Nothing should have shipped yet.
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

    // Sanity: granted DOES capture.
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
    // This is the real first-boot path: consent undecided, guard already
    // consumed. A plain capture would be dropped here and never re-fire.
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
    // Reproduce posthog-node's auto-flush race: identify is removed from the
    // SDK queue after an HTTP failure, then our explicit empty flush resolves.
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
    // The authenticated update rides the next event instead of spending a
    // dedicated person.set capture.
    expect(captured).toHaveLength(0)
    telemetry.capture('comfy.desktop.execution.completed')
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      distinctId: 'user-123',
      event: 'comfy.desktop.execution.completed',
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

/**
 * The dedicated `comfy.desktop.person.set` event was 15.2M events/28d whose
 * only job was carrying `$set`. Authenticated person-property updates now
 * ride the next captured event (PostHog applies `$set`/`$set_once` from any
 * event's properties); the dedicated event remains ONLY as the eager flush at
 * identity boundaries so updates can't land on the wrong person.
 */
describe('telemetry authenticated person-property carrier', () => {
  beforeEach(() => {
    setupTelemetry({ bind: null })
    telemetry.bindAnonymousId('anonymous-start', 'installation-id-fake')
    telemetry.applyFirebaseUserConsensus('user-123')
    captured.length = 0
  })

  it('rides $set on the next captured event instead of a dedicated person.set', () => {
    telemetry.registerPersonProperties({ gpu_tier: 'high' })
    expect(captured).toHaveLength(0)

    telemetry.capture('comfy.desktop.execution.completed', { duration_seconds: 3 })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      distinctId: 'user-123',
      event: 'comfy.desktop.execution.completed',
      properties: { duration_seconds: 3, $set: { gpu_tier: 'high' } }
    })
    expect(captured.some((c) => c.event === 'comfy.desktop.person.set')).toBe(false)
  })

  it('clears the queue after a successful carrier; later events ship without $set', () => {
    telemetry.registerPersonProperties({ theme: 'dark' })

    telemetry.capture('carrier.event')
    telemetry.capture('later.event')

    expect(captured[0]!.properties).toMatchObject({ $set: { theme: 'dark' } })
    expect(captured[1]!.properties).not.toHaveProperty('$set')
  })

  it('merges successive updates: last write wins for $set, first for $set_once', () => {
    telemetry.registerPersonProperties({ gpu_tier: 'low', locale: 'en' })
    telemetry.registerPersonProperties({ gpu_tier: 'mid' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'first' })
    telemetry.registerPersonPropertiesOnce({ first_generation_at: 'second' })

    telemetry.capture('carrier.event')

    expect(captured[0]!.properties).toMatchObject({
      $set: { gpu_tier: 'mid', locale: 'en' },
      $set_once: { first_generation_at: 'first' }
    })
  })

  it('keeps the queue when the carrier capture is dropped, so no update is ever lost silently', () => {
    telemetry.registerPersonProperties({ plan: 'pro' })
    posthogClientMock.failNextCaptures = 1

    telemetry.capture('dropped.event')
    expect(captured).toHaveLength(0)

    telemetry.capture('next.event')
    expect(captured[0]!.properties).toMatchObject({ $set: { plan: 'pro' } })
  })

  it('session.ended at shutdown is the guaranteed last carrier of a clean session', async () => {
    telemetry.registerPersonProperties({ plan: 'pro' })

    await telemetry.shutdown('quit')

    const ended = captured.find((c) => c.event === 'comfy.desktop.session.ended')
    expect(ended?.properties).toMatchObject({ $set: { plan: 'pro' } })
  })

  it('flushes to the OLD person as a dedicated person.set at logout, never the next identity', () => {
    telemetry.registerPersonProperties({ plan: 'pro' })

    telemetry.applyFirebaseAnonymousConsensus()

    const personSet = captured.find((c) => c.event === 'comfy.desktop.person.set')
    expect(personSet?.distinctId).toBe('user-123')
    expect((personSet?.properties as { $set?: Record<string, unknown> })?.$set).toMatchObject({
      plan: 'pro',
      is_authenticated: false
    })

    telemetry.capture('post.logout.event')
    expect(captured.at(-1)?.distinctId).toBe('anonymous-next-1')
    expect(captured.at(-1)?.properties).not.toHaveProperty('$set')
  })

  it('scrubs queued person properties before they leave the process', () => {
    telemetry.registerPersonProperties({
      failure_note: "ENOENT 'C:\\Users\\64911\\Documents\\workflow.json'"
    })

    telemetry.capture('carrier.event')

    const set = (captured[0]!.properties as { $set?: Record<string, string> }).$set
    expect(set?.failure_note).toContain('[REDACTED]')
    expect(set?.failure_note).not.toContain('64911')
  })

  it('discards the queue when consent is revoked', () => {
    telemetry.registerPersonProperties({ plan: 'pro' })
    telemetry.setConsentState('denied')
    telemetry.setConsentState('granted')

    telemetry.capture('after.regrant.event')

    expect(captured.at(-1)?.event).toBe('after.regrant.event')
    expect(captured.at(-1)?.properties).not.toHaveProperty('$set')
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

  it('forwards exceptions to Datadog without message, stack, or arbitrary context', () => {
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

  it('emit() captures via PostHog Node AND forwards to relay targets', () => {
    const a = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)

    // Use a name that is in the Datadog allow-list so the forward path runs.
    telemetry.emit('comfy.desktop.execution.error', { variant: 'standalone' })

    // PostHog Node side
    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.execution.error'])
    expect(captured[0]!.properties).toMatchObject({ variant: 'standalone' })
    // Relay side — exactly one IPC send to the registered target
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
    // Use a name in the Datadog allow-list so the forward path actually fires.
    telemetry.emit('comfy.desktop.execution.error', {})
    // Event still captured by PostHog Node even with no renderer alive yet —
    // the architectural guarantee that "telemetry works no matter what".
    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.execution.error'])
  })

  it('skips forwarding for events NOT in the Datadog mirror allow-list (provider split)', () => {
    const a = makeStubWebContents()
    telemetry.registerTelemetryRelayTarget(a.wc)

    // Product / funnel events stay PostHog-only and do not ride the relay.
    telemetry.emit('comfy.desktop.install.flow.opened', { variant: 'standalone' })

    // PostHog Node still captured it.
    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.install.flow.opened'])
    // But the renderer never sees it — no Datadog mirror needed for a product event.
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
    // Clear AFTER the boot sequence — granting consent flushes the deferred
    // `comfy.desktop.session.started` event into `captured`, which would
    // otherwise count toward each test's product-event totals and
    // throw the per-process cap assertions off by one (and make the
    // 5000-cap test loop runaway-guard out, eating the 5s timeout).
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
    // Fire enough rate-limited-bypassing errors to overshoot the 5000
    // session cap by a healthy margin — the cap is the FINAL backstop
    // and must apply even to events that bypass the per-event window.
    // Use a fixed iteration count instead of polling `captured.filter()`
    // each loop turn: that filter is O(N) over a growing array, so a
    // while-condition variant is O(N²) and blows the 5s test timeout
    // on slower CI hosts.
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

/**
 * Crash-loop guard: 93.9% of ~1.9M `$exception`/mo was four Electron
 * crash-loop messages, with individual machines emitting thousands each.
 * Identical messages are capped per process; first occurrences (the actual
 * signal) always ship, and distinct messages are unaffected.
 */
describe('telemetry $exception per-message session cap', () => {
  beforeEach(() => {
    setupTelemetry()
    exceptions.length = 0
  })

  it('ships the first 5 identical exception messages, then drops the rest for the session', () => {
    for (let i = 0; i < 20; i++) {
      expect(telemetry.captureException(new Error('Renderer process gone: launch-failed'))).toBe(
        i < 5
      )
    }
    expect(exceptions).toHaveLength(5)
    expect((exceptions[0]!.error as Error).message).toBe('Renderer process gone: launch-failed')
  })

  it('tracks distinct messages independently — a new failure mode always ships', () => {
    for (let i = 0; i < 7; i++) {
      telemetry.captureException(new Error('Child process GPU exited: crashed'))
      telemetry.captureException(new Error('Child process Utility exited: crashed'))
    }

    expect(exceptions).toHaveLength(10)
    telemetry.captureException(new Error('brand-new failure'))
    expect(exceptions).toHaveLength(11)
  })

  it('keys on the scrubbed name+message so PII variation cannot defeat the cap', () => {
    for (let i = 0; i < 7; i++) {
      // Distinct raw strings that scrub to the same redacted message must
      // count as one crash loop, not seven distinct failures.
      telemetry.captureException(
        new Error(`ENOENT 'C:\\Users\\user-${i}\\Documents\\workflow.json'`)
      )
    }
    expect(exceptions).toHaveLength(5)
  })

  it('does not burn a cap slot when the SDK rejects the exception', () => {
    posthogClientMock.failNextExceptionCaptures = 1
    expect(telemetry.captureException(new Error('flaky'))).toBe(false)

    for (let i = 0; i < 5; i++) {
      expect(telemetry.captureException(new Error('flaky'))).toBe(true)
    }
    expect(telemetry.captureException(new Error('flaky'))).toBe(false)
    expect(exceptions).toHaveLength(5)
  })
})
