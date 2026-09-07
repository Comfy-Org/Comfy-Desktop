import { EventEmitter } from 'node:events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WriteStream } from 'fs'

// Stub the electron surface ../shared touches so the test needs no runtime.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => path.join(os.tmpdir(), 'core-beta-launch-test'),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
    on: () => {}
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

// Override only the model-download startup gate; everything else in the
// download manager stays real (it is already part of launch.ts's graph).
const modelStartup = vi.hoisted(() => ({
  impl: null as null | (() => Promise<{ safe: boolean; unsafePaths: string[] }>)
}))
vi.mock('../../comfyDownloadManager', async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyDownloadManagerModule>()
  return {
    ...actual,
    initializeModelDownloads: () =>
      modelStartup.impl ? modelStartup.impl() : actual.initializeModelDownloads()
  }
})

/** Drives a real `handleLaunch` far enough to reach the pre-spawn gates. Everything the launch
 *  touches on the way (source, args schema, grants, taps, spawn) is answered from here, so a
 *  test can park the launch at an exact point and observe what was reported by then. */
const launchHarness = vi.hoisted(() => ({
  launchCommand: null as null | Record<string, unknown>,
  schemaNames: ['enable-assets', 'listen', 'feature-flag'] as string[],
  schemaThrows: false,
  betaEnabled: true,
  /** Settings can throw on read: `resolveBetaFeaturesEnabled` writes the default back on first
   *  read, so a read-only or full disk surfaces here. */
  betaEnabledThrows: false,
  grants: [] as { arg: string; minCoreVersion: string }[],
  /** Runs while `acquireLaunchResources` is in flight — after the launching marker exists and
   *  before either path's pre-spawn abort gate, which is exactly the window under test. */
  duringResourceAcquire: null as null | (() => void),
  spawn: null as null | ((...args: unknown[]) => unknown),
  /** Called in place of the real boot probe, once per spawn attempt. Resolving means "this
   *  attempt booted"; a never-settling promise lets the early-exit rejection win instead. */
  waitForPort: null as null | (() => Promise<void>),
  nextPort: 48999
}))

vi.mock('../shared', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>()
  return {
    ...actual,
    sourceMap: {
      ...actual.sourceMap,
      'harness-source': {
        skipInstall: true,
        getDefaults: () => ({}),
        getLaunchCommand: () => launchHarness.launchCommand
      }
    },
    settings: new Proxy(actual.settings, {
      get(target, key) {
        if (key === 'resolveBetaFeaturesEnabled') {
          return () => {
            if (launchHarness.betaEnabledThrows) throw new Error('settings write failed: EROFS')
            return launchHarness.betaEnabled
          }
        }
        const value = Reflect.get(target, key) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
    }),
    spawnProcess: (...args: unknown[]) => launchHarness.spawn?.(...args),
    waitForPort: (...args: Parameters<typeof actual.waitForPort>) =>
      launchHarness.waitForPort ? launchHarness.waitForPort() : actual.waitForPort(...args),
    findAvailablePort: async () => launchHarness.nextPort,
    // Never let a test reach the real one: the fake child's pid is invented, and killing it
    // would signal whatever real process happens to hold that pid.
    killProcessTree: async () => {}
  }
})

vi.mock('../../comfy-args', async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyArgsModule>()
  return {
    ...actual,
    getComfyArgsSchema: async () => {
      if (launchHarness.schemaThrows) throw new Error('schema discovery unavailable')
      return schemaOf(...launchHarness.schemaNames)
    },
    getComfyFeatureFlagRegistry: async () => ({})
  }
})

vi.mock('../../coreCanary', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreCanaryModule>()
  return { ...actual, getCoreCanaryFlagsAsync: async () => launchHarness.grants }
})

vi.mock('../../hardwareTap', async (importOriginal) => {
  const actual = await importOriginal<typeof HardwareTapModule>()
  return {
    ...actual,
    createHardwareTap: (...args: Parameters<typeof actual.createHardwareTap>) => {
      launchHarness.duringResourceAcquire?.()
      return actual.createHardwareTap(...args)
    }
  }
})

import {
  buildLaunchArgs,
  desktopFeatureFlags,
  emitCoreBetaRecords,
  emitCoreBetaTelemetry,
  handleLaunch,
  isCrashedExit,
  onProcessTerminated,
  writeLog,
  _cleanupFailedLaunchSetup
} from './launch'
import type { ActionContext } from './types'
import type * as ComfyDownloadManagerModule from '../../comfyDownloadManager'
import type { ComfyArgsSchema } from '../../comfy-args'
import type { CoreCanaryFlag } from '../../coreCanary'
import * as telemetry from '../../telemetry'
import {
  makeSendOutput,
  _getLaunchingInstallationIds,
  _markLaunching,
  _operationAborts,
  _pendingPorts,
  _reservePort
} from '../shared'
import type { ChildProcess, InstallationRecord } from '../shared'
import type * as SharedModule from '../shared'
import type * as ComfyArgsModule from '../../comfy-args'
import type * as CoreCanaryModule from '../../coreCanary'
import type * as HardwareTapModule from '../../hardwareTap'

const installOf = (sourceId: string) => ({ sourceId }) as InstallationRecord

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  pid: number
  kill: () => boolean
  killed: boolean
}

describe('desktopFeatureFlags', () => {
  it('always injects the unconditional desktop flags', () => {
    const flags = desktopFeatureFlags(installOf('standalone'), false)
    expect(flags.show_signin_button).toBe('true')
    expect(flags.supports_terminal).toBe('false')
  })

  it('injects enable_telemetry only for standalone installs that opted in', () => {
    expect(desktopFeatureFlags(installOf('standalone'), true).enable_telemetry).toBe('true')
  })

  it('omits enable_telemetry when telemetry is disabled (default off)', () => {
    expect(desktopFeatureFlags(installOf('standalone'), false)).not.toHaveProperty(
      'enable_telemetry'
    )
  })

  it('omits enable_telemetry for non-standalone installs even when opted in', () => {
    expect(desktopFeatureFlags(installOf('portable'), true)).not.toHaveProperty('enable_telemetry')
    expect(desktopFeatureFlags(installOf('git'), true)).not.toHaveProperty('enable_telemetry')
  })
})

describe('isCrashedExit', () => {
  it('treats a clean exit (code 0, no signal) as not crashed', () => {
    expect(isCrashedExit(0, null)).toBe(false)
  })

  it('treats a non-zero exit code (Linux/macOS normal crash) as crashed', () => {
    expect(isCrashedExit(1, null)).toBe(true)
    expect(isCrashedExit(137, null)).toBe(true)
  })

  it('treats a POSIX signal-only kill (code null, signal set) as crashed', () => {
    // SIGKILL via `kill -9` or OOM: Node hands back null code + signal.
    expect(isCrashedExit(null, 'SIGKILL')).toBe(true)
    expect(isCrashedExit(null, 'SIGTERM')).toBe(true)
  })

  it('treats both code and signal present (signal-with-code path) as crashed', () => {
    expect(isCrashedExit(137, 'SIGKILL')).toBe(true)
  })

  it('treats Windows TerminateProcess (numeric code, null signal) as crashed', () => {
    // Windows force-kill reports a large unsigned code; signal is always null.
    expect(isCrashedExit(4294967295, null)).toBe(true)
    expect(isCrashedExit(0xc0000005, null)).toBe(true)
  })
})

describe('onProcessTerminated', () => {
  it('prefers close and invokes the callback once', () => {
    const proc = new EventEmitter() as unknown as ChildProcess
    const callback = vi.fn()
    onProcessTerminated(proc, callback)

    proc.emit('exit', 1, null)
    proc.emit('close', 2, 'SIGTERM')
    proc.emit('close', 3, null)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(2, 'SIGTERM')
  })

  it('handles rejected async termination callbacks', async () => {
    const proc = new EventEmitter() as unknown as ChildProcess
    const failure = new Error('callback failed')
    const callback = vi.fn(async () => Promise.reject(failure))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      onProcessTerminated(proc, callback)
      proc.emit('close', 1, null)

      expect(callback).toHaveBeenCalledOnce()
      await vi.waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith('Process termination callback failed:', failure)
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('falls back to exit when inherited pipes prevent close', () => {
    vi.useFakeTimers()
    try {
      const proc = new EventEmitter() as unknown as ChildProcess
      const callback = vi.fn()
      onProcessTerminated(proc, callback)

      proc.emit('exit', null, 'SIGKILL')
      expect(callback).not.toHaveBeenCalled()
      vi.runAllTimers()

      expect(callback).toHaveBeenCalledOnce()
      expect(callback).toHaveBeenCalledWith(null, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('_cleanupFailedLaunchSetup', () => {
  const INSTALL = 'cleanup-under-test'
  const PORT = 59_311

  afterEach(() => {
    _operationAborts.delete(INSTALL)
    _pendingPorts.delete(PORT)
  })

  it('releases the port, clears the launching marker, frees the slot, and aborts', () => {
    const abort = new AbortController()
    _reservePort(PORT, 'Cleanup Test')
    _markLaunching(INSTALL, 'Cleanup Test')
    _operationAborts.set(INSTALL, abort)

    _cleanupFailedLaunchSetup(INSTALL, abort, { port: PORT })

    expect(_pendingPorts.has(PORT)).toBe(false)
    expect(_getLaunchingInstallationIds()).not.toContain(INSTALL)
    expect(_operationAborts.has(INSTALL)).toBe(false)
    expect(abort.signal.aborted).toBe(true)
  })

  it('ends the log stream when one was opened', () => {
    const end = vi.fn()
    _cleanupFailedLaunchSetup(INSTALL, new AbortController(), { logStream: { end } })
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('never evicts an operation slot a newer operation already claimed', () => {
    const stale = new AbortController()
    const newer = new AbortController()
    _operationAborts.set(INSTALL, newer)

    _cleanupFailedLaunchSetup(INSTALL, stale)

    expect(_operationAborts.get(INSTALL)).toBe(newer)
    expect(newer.signal.aborted).toBe(false)
    expect(stale.signal.aborted).toBe(true)
  })

  it('is safe when nothing was acquired yet', () => {
    expect(() => _cleanupFailedLaunchSetup(INSTALL, new AbortController())).not.toThrow()
  })
})

describe('handleLaunch model-download startup await (#1322)', () => {
  const ctxFor = (installationId: string): ActionContext => ({
    event: { sender: { send: vi.fn() } } as unknown as Electron.IpcMainInvokeEvent,
    installationId,
    // An unknown source makes runLaunch fail at the FIRST check after the
    // gate, proving how far a safe pass proceeded without spawning anything.
    inst: installOf('not-a-real-source'),
    actionData: {}
  })

  afterEach(() => {
    modelStartup.impl = null
  })

  it('never blocks the launch while incomplete files are visible under final model names', async () => {
    modelStartup.impl = async () => ({
      safe: false,
      unsafePaths: ['C:\\models\\checkpoints\\broken.safetensors']
    })
    const res = await handleLaunch(ctxFor('gate-unsafe-paths'))
    expect(res.ok).toBe(false)
    // Failure comes from the NEXT check (unknown source): the unsafe pass
    // warned and the launch proceeded past the model-download startup await.
    // A truncated file that fails to load in ComfyUI is strictly better than
    // refusing to start; the Downloads warning rows carry the details.
    expect(res.message).toMatch(/unknownSource|unrecognized source/)
  })

  it('never blocks the launch when the startup pass itself could not certify safety', async () => {
    modelStartup.impl = async () => ({ safe: false, unsafePaths: [] })
    const res = await handleLaunch(ctxFor('gate-unsafe-nopaths'))
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/unknownSource|unrecognized source/)
  })

  it('never blocks the launch when the startup pass throws outright', async () => {
    modelStartup.impl = async () => {
      throw new Error('startup pass exploded')
    }
    const res = await handleLaunch(ctxFor('gate-throw'))
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/unknownSource|unrecognized source/)
  })

  it('lets a safe pass proceed beyond the startup await', async () => {
    modelStartup.impl = async () => ({ safe: true, unsafePaths: [] })
    const res = await handleLaunch(ctxFor('gate-safe'))
    expect(res.ok).toBe(false)
    // Failure comes from the NEXT check (unknown source), not the gate.
    expect(res.message).toMatch(/unknownSource|unrecognized source/)
  })

  it('releases the operation slot after a launch that failed past the startup await', async () => {
    modelStartup.impl = async () => ({ safe: false, unsafePaths: [] })
    await handleLaunch(ctxFor('gate-slot-release'))
    expect(_operationAborts.has('gate-slot-release')).toBe(false)
  })
})

/** Every arg the pinned core knows is boolean here; the beta grants and the
 *  opposite tokens under test are all switches. */
const schemaOf = (...names: string[]): ComfyArgsSchema => ({
  args: names.map((name) => ({
    name,
    flag: `--${name}`,
    help: '',
    type: 'boolean' as const,
    category: 'other'
  })),
  knownFlags: new Set(names)
})

const ASSETS_GRANT: CoreCanaryFlag = { arg: '--enable-assets', minCoreVersion: '0.3.80' }
const PREFIX = ['/opt/py', '-s', 'ComfyUI/main.py']
const DESKTOP_FLAGS = ['--feature-flag', 'show_signin_button=true']

const build = (over: {
  userArgs?: string[]
  schema: ComfyArgsSchema
  betaFlags?: CoreCanaryFlag[]
  coreVersion?: string | null
  coreVersionExact?: boolean
  betaEnabled?: boolean
}): ReturnType<typeof buildLaunchArgs> =>
  buildLaunchArgs({
    prefixArgs: PREFIX,
    userArgs: over.userArgs ?? [],
    desktopFlagArgs: DESKTOP_FLAGS,
    schema: over.schema,
    betaFlags: over.betaFlags ?? [ASSETS_GRANT],
    coreVersion: over.coreVersion === undefined ? '0.3.81' : over.coreVersion,
    coreVersionExact: over.coreVersionExact ?? true,
    betaEnabled: over.betaEnabled ?? true
  })

describe('buildLaunchArgs core beta injection', () => {
  afterEach(() => {
    telemetry.setConsentState('undecided')
  })

  it('places the granted beta arg after the desktop flags and before the user args', () => {
    const built = build({
      userArgs: ['--listen'],
      schema: schemaOf('enable-assets', 'listen', 'feature-flag')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets', '--listen'])
    expect(built.beta.applied).toEqual([ASSETS_GRANT])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it('injects nothing when the beta toggle is off', () => {
    const built = build({
      userArgs: ['--listen'],
      schema: schemaOf('enable-assets', 'listen'),
      betaEnabled: false
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--listen'])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.logRecords).toEqual([])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it('injects nothing when the running core is below the grant floor', () => {
    const built = build({ schema: schemaOf('enable-assets'), coreVersion: '0.3.79' })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS])
    expect(built.beta.applied).toEqual([])
  })

  it('injects nothing when the install version is unparseable', () => {
    const built = build({ schema: schemaOf('enable-assets'), coreVersion: null })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.logRecords).toEqual([])
  })

  it('drops a granted arg the running core does not accept, and reports it', () => {
    // Version window and toggle both pass; only the args schema says no.
    const built = build({ userArgs: ['--listen'], schema: schemaOf('listen') })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--listen'])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.logRecords).toEqual([])
    expect(built.beta.droppedUnsupported).toEqual(['--enable-assets'])
  })

  it('keeps a supported grant while dropping an unsupported one from the same payload', () => {
    const hashing: CoreCanaryFlag = { arg: '--enable-asset-hashing', minCoreVersion: '0.3.80' }
    const built = build({
      schema: schemaOf('enable-assets'),
      betaFlags: [ASSETS_GRANT, hashing]
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets'])
    expect(built.beta.applied).toEqual([ASSETS_GRANT])
    expect(built.beta.droppedUnsupported).toEqual(['--enable-asset-hashing'])
  })

  it('builds one newline-terminated record per applied grant, naming the matched floor', () => {
    const built = build({ schema: schemaOf('enable-assets') })

    expect(built.beta.logRecords).toEqual([
      '[core-beta] --enable-assets (core 0.3.81 >= 0.3.80, opted in)\n'
    ])
  })

  it('reports the core version the grants were matched against', () => {
    expect(build({ schema: schemaOf('enable-assets') }).beta.coreVersion).toBe('0.3.81')
  })

  it('skips a grant the user already typed, leaving their token in place', () => {
    const built = build({
      userArgs: ['--enable-assets'],
      schema: schemaOf('enable-assets')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets'])
    expect(built.beta.applied).toEqual([])
  })

  it('reads the args the user actually typed, not the schema-filtered set', () => {
    // Their own --enable-assets is unsupported by this core and gets filtered
    // out, but it still means "already asked for": selecting against the
    // filtered set would re-grant it and report a phantom drop.
    const built = build({ userArgs: ['--enable-assets'], schema: schemaOf('listen') })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it('still applies the grant when the user typed the opposite token the core cannot parse', () => {
    // No opposite modeling: `--disable-assets` is filtered like any other
    // unsupported user arg, and the grant is unaffected by its presence.
    const built = build({
      userArgs: ['--disable-assets', '--listen'],
      schema: schemaOf('enable-assets', 'listen')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets', '--listen'])
    expect(built.beta.applied).toEqual([ASSETS_GRANT])
  })

  it('lands both tokens when the core knows the opposite the user typed', () => {
    // A future core that parses both: we suppress neither side and let core decide.
    const built = build({
      userArgs: ['--disable-assets'],
      schema: schemaOf('enable-assets', 'disable-assets')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets', '--disable-assets'])
    expect(built.beta.applied).toEqual([ASSETS_GRANT])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it.each([
    ['opted in', true],
    ['opted out', false]
  ])('carries the resolved beta toggle on the DTO when %s', (_label, betaEnabled) => {
    // The DTO is the only carrier of `opt_state`: the report site no longer re-reads settings,
    // so a launch that never reaches arg assembly still reports the real toggle.
    expect(build({ schema: schemaOf('enable-assets'), betaEnabled }).beta.optedIn).toBe(betaEnabled)
  })

  it('keeps injecting for a user who declined telemetry but opted into beta features', () => {
    // Consent is not an input here at all — the gate is the beta toggle alone.
    telemetry.setConsentState('denied')
    const built = build({ schema: schemaOf('enable-assets') })

    expect(built.args).toContain('--enable-assets')
    expect(built.beta.logRecords).toHaveLength(1)
  })
})

const RECORD = '[core-beta] --enable-assets (core 0.3.81 >= 0.3.80, opted in)\n'
const CHILD_LINE = 'Total VRAM 24576 MB, total RAM 64000 MB\n'

// Both launch paths build the same sink pair — the log stream from
// `acquireLaunchResources` and `makeSendOutput` for the renderer — so the wiring is pinned
// once. This was a `describe.each(['skip-port','normal'])` whose callback took no parameter:
// the label alternated while the body stayed byte-identical, running the same assertions
// twice and proving nothing about either path. Path-specific behaviour is covered by the
// report-placement tests below instead.
describe('emitCoreBetaRecords', () => {
  const sinksWithBuffers = (): {
    sinks: { writeLog: (text: string) => void; sendOutput: (text: string) => void }
    logged: string[]
    sent: string[]
  } => {
    const logged: string[] = []
    const sent: string[] = []
    const logStream = {
      writableEnded: false,
      write: (text: string) => logged.push(text)
    } as unknown as WriteStream
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, payload: { text: string }) => sent.push(payload.text)
    } as unknown as Electron.WebContents
    return {
      sinks: {
        writeLog: (text: string) => writeLog(logStream, text),
        sendOutput: makeSendOutput(sender, 'inst-core-beta')
      },
      logged,
      sent
    }
  }

  it('delivers each record exactly once to the log file and the renderer', () => {
    const { sinks, logged, sent } = sinksWithBuffers()

    emitCoreBetaRecords([RECORD], sinks)

    expect(logged).toEqual([RECORD])
    expect(sent).toEqual([RECORD])
  })

  it('keeps the record on its own line ahead of the first child-process output', () => {
    const { sinks, logged, sent } = sinksWithBuffers()

    emitCoreBetaRecords([RECORD], sinks)
    sinks.writeLog(CHILD_LINE)
    sinks.sendOutput(CHILD_LINE)

    const expected = [
      '[core-beta] --enable-assets (core 0.3.81 >= 0.3.80, opted in)',
      'Total VRAM 24576 MB, total RAM 64000 MB',
      ''
    ]
    expect(logged.join('').split('\n')).toEqual(expected)
    expect(sent.join('').split('\n')).toEqual(expected)
  })

  it('writes nothing when no grant applied', () => {
    const { sinks, logged, sent } = sinksWithBuffers()

    emitCoreBetaRecords([], sinks)

    expect(logged).toEqual([])
    expect(sent).toEqual([])
  })
})

describe('core beta report placement', () => {
  const HARNESS_GRANT = { arg: '--enable-assets', minCoreVersion: '0.3.80' }
  let installDir = ''
  let sent: string[] = []
  let events: { event: string; properties?: Record<string, unknown> }[] = []
  let spawnArgs: string[] = []

  const harnessInstall = (): InstallationRecord =>
    ({
      id: 'harness-inst',
      name: 'Harness',
      sourceId: 'harness-source',
      installPath: installDir,
      version: '0.3.81',
      comfyVersion: {
        commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        baseTag: 'v0.3.81',
        commitsAhead: 0
      }
    }) as unknown as InstallationRecord

  const ctxFor = (installationId: string): ActionContext => ({
    event: {
      sender: {
        isDestroyed: () => false,
        send: (_channel: string, payload: { text?: string }) => {
          if (typeof payload?.text === 'string') sent.push(payload.text)
        }
      }
    } as unknown as Electron.IpcMainInvokeEvent,
    installationId,
    inst: harnessInstall(),
    actionData: {}
  })

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-launch-'))
    fs.mkdirSync(path.join(installDir, 'ComfyUI'), { recursive: true })
    sent = []
    events = []
    launchHarness.schemaThrows = false
    launchHarness.betaEnabled = true
    launchHarness.betaEnabledThrows = false
    launchHarness.schemaNames = ['enable-assets', 'listen', 'feature-flag']
    spawnArgs = []
    launchHarness.grants = [HARNESS_GRANT]
    launchHarness.duringResourceAcquire = null
    launchHarness.spawn = (_cmd: unknown, args: unknown) => {
      spawnArgs = args as string[]
      return fakeChild()
    }
    // `process.execPath` is a real executable, so the pre-launch existsSync passes without
    // mocking fs. `-s <main.py>` is the shape the arg splitter keys on.
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
      cwd: installDir,
      skipPortWait: true
    }
    vi.spyOn(telemetry, 'emit').mockImplementation(((
      event: string,
      properties?: Record<string, unknown>
    ) => {
      events.push({ event, properties })
    }) as unknown as typeof telemetry.emit)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  const reportedEvents = (): string[] => events.map((e) => e.event)

  /** Minimal live child: streams to attach to, a pid to kill, and no exit unless a test
   *  emits one, so a launch that reaches spawn settles instead of hanging. */
  function fakeChild(): FakeChild {
    const proc = new EventEmitter() as FakeChild
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 4242
    proc.killed = false
    proc.kill = () => true
    return proc
  }

  it('reports on a launch that reaches the skip-port spawn', async () => {
    const res = await handleLaunch(ctxFor('harness-skip-port-spawns'))

    expect(res.ok).toBe(true)
    expect(sent.join('')).toContain('[core-beta] --enable-assets')
    expect(reportedEvents()).toContain('comfy.desktop.core_beta.applied')
    expect(reportedEvents()).toContain('comfy.desktop.core_beta.opt_state')
  })

  it('does not report when cancelled at the skip-port pre-spawn gate', async () => {
    // Cancel lands while resources are being acquired — after the launching marker, before
    // the gate. The launch must return cancelled having attributed nothing.
    launchHarness.duringResourceAcquire = () => {
      _operationAborts.get('harness-skip-port-cancelled')?.abort()
    }

    const res = await handleLaunch(ctxFor('harness-skip-port-cancelled'))

    expect(res).toMatchObject({ ok: false, cancelled: true })
    expect(sent.join('')).not.toContain('[core-beta]')
    expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.applied')
    expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.opt_state')
  })

  it('does not report when cancelled at the normal-path pre-spawn gate', async () => {
    // The normal path's last gate sits INSIDE the recursing `tryLaunch`, past port reservation
    // and resource acquisition — a different call site from the skip-port one above.
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
      cwd: installDir,
      skipPortWait: false,
      port: 48231
    }
    launchHarness.duringResourceAcquire = () => {
      _operationAborts.get('harness-normal-cancelled')?.abort()
    }

    const res = await handleLaunch(ctxFor('harness-normal-cancelled'))

    expect(res).toMatchObject({ ok: false, cancelled: true })
    expect(sent.join('')).not.toContain('[core-beta]')
    expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.applied')
    expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.opt_state')
  })

  it('reports exactly once when a port conflict retries the spawn', async () => {
    // The only test that proves the latch: the report site lives INSIDE the recursing
    // `tryLaunch`, so an unlatched report fires once per attempt.
    const children: FakeChild[] = []
    let attempt = 0
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
      cwd: installDir,
      skipPortWait: false,
      port: 48232
    }
    launchHarness.spawn = () => {
      const child = fakeChild()
      children.push(child)
      return child
    }
    launchHarness.waitForPort = async () => {
      attempt++
      if (attempt > 1) return
      // Everything is wired by the time the boot probe runs, so failing the first attempt
      // from here is deterministic — no racing the stream/exit handler registration.
      const first = children[0]!
      first.stderr.emit('data', Buffer.from('OSError: [Errno 98] Address already in use\n'))
      first.emit('close', 1, null)
      return new Promise<void>(() => {})
    }

    const res = await handleLaunch(ctxFor('harness-retry-reports-once'))

    expect(res.ok).toBe(true)
    expect(attempt).toBe(2)
    expect(children).toHaveLength(2)
    expect(events.filter((e) => e.event === 'comfy.desktop.core_beta.opt_state')).toHaveLength(1)
    expect(sent.join('').match(/\[core-beta\]/g) ?? []).toHaveLength(1)
  })

  it('still filters user args, injecting nothing, when the beta setting cannot be resolved', async () => {
    // Resolving the toggle writes the default back on first read, so a read-only profile makes
    // it throw. That must cost the launch its beta grants — never its arg filtering, and never
    // the launch itself.
    launchHarness.betaEnabledThrows = true
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: [
        '-s',
        path.join(installDir, 'ComfyUI', 'main.py'),
        '--listen',
        '--not-a-real-comfy-flag'
      ],
      cwd: installDir,
      skipPortWait: true
    }

    const res = await handleLaunch(ctxFor('harness-beta-setting-throws'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).toContain('--listen')
    // Filtering still ran: an arg the pinned core does not know never reaches it.
    expect(spawnArgs).not.toContain('--not-a-real-comfy-flag')
    // Fail closed: the grant is schema-supported and would have been injected at `true`.
    expect(spawnArgs).not.toContain('--enable-assets')
  })

  it('reports opt_state true when schema discovery is unavailable', async () => {
    // Arg assembly never runs, so there are no grants — but the user IS opted in, and the
    // report site no longer re-reads settings to find that out.
    launchHarness.schemaThrows = true
    launchHarness.betaEnabled = true

    const res = await handleLaunch(ctxFor('harness-schema-unavailable'))

    expect(res.ok).toBe(true)
    const optState = events.find((e) => e.event === 'comfy.desktop.core_beta.opt_state')
    expect(optState?.properties).toMatchObject({ opted_in: true })
    expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.applied')
  })
})

describe('emitCoreBetaTelemetry', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  beforeEach(() => {
    captured = []
    vi.spyOn(telemetry, 'emit').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    telemetry.setConsentState('undecided')
  })

  it('reports the applied grants with the core version they matched', () => {
    emitCoreBetaTelemetry({
      appliedArgs: ['--enable-assets'],
      droppedUnsupported: [],
      coreVersion: '0.3.81',
      optedIn: true
    })

    const applied = captured.find((c) => c.event === 'comfy.desktop.core_beta.applied')
    expect(applied!.ctx).toEqual({
      args: ['--enable-assets'],
      core_version: '0.3.81',
      dropped_unsupported: []
    })
  })

  it('reports a grant the core rejected even though nothing was applied', () => {
    emitCoreBetaTelemetry({
      appliedArgs: [],
      droppedUnsupported: ['--enable-assets'],
      coreVersion: '0.3.81',
      optedIn: true
    })

    const applied = captured.find((c) => c.event === 'comfy.desktop.core_beta.applied')
    expect(applied!.ctx).toMatchObject({ args: [], dropped_unsupported: ['--enable-assets'] })
  })

  it('emits the opt state on a grantless launch and no applied event', () => {
    emitCoreBetaTelemetry({
      appliedArgs: [],
      droppedUnsupported: [],
      coreVersion: null,
      optedIn: false
    })

    expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.core_beta.opt_state'])
    expect(captured[0]!.ctx).toEqual({ opted_in: false })
  })

  it('emits the opt state once per launch alongside an applied event', () => {
    emitCoreBetaTelemetry({
      appliedArgs: ['--enable-assets'],
      droppedUnsupported: [],
      coreVersion: '0.3.81',
      optedIn: true
    })

    expect(captured.map((c) => c.event)).toEqual([
      'comfy.desktop.core_beta.applied',
      'comfy.desktop.core_beta.opt_state'
    ])
  })

  it('hands both events to the consent-gated emit path without consulting consent itself', () => {
    // Delivery for a telemetry-declining user is suppressed by telemetry.ts's
    // own gate — never by a branch here, which would also silence opted-in users.
    telemetry.setConsentState('denied')

    emitCoreBetaTelemetry({
      appliedArgs: ['--enable-assets'],
      droppedUnsupported: [],
      coreVersion: '0.3.81',
      optedIn: true
    })

    expect(captured.map((c) => c.event)).toEqual([
      'comfy.desktop.core_beta.applied',
      'comfy.desktop.core_beta.opt_state'
    ])
  })
})
