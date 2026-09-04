import { EventEmitter } from 'node:events'
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

const installOf = (sourceId: string) => ({ sourceId }) as InstallationRecord

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
  betaEnabled?: boolean
}): ReturnType<typeof buildLaunchArgs> =>
  buildLaunchArgs({
    prefixArgs: PREFIX,
    userArgs: over.userArgs ?? [],
    desktopFlagArgs: DESKTOP_FLAGS,
    schema: over.schema,
    betaFlags: over.betaFlags ?? [ASSETS_GRANT],
    coreVersion: over.coreVersion === undefined ? '0.3.81' : over.coreVersion,
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
// `acquireLaunchResources` and `makeSendOutput` for the renderer — so the
// wiring is pinned once per path label rather than per call site.
describe.each(['skip-port', 'normal'])('emitCoreBetaRecords (%s launch path)', () => {
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
