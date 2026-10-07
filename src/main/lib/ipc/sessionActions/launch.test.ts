import { EventEmitter } from 'node:events'
import { execFileSync } from 'child_process'
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
  /** Every `planCoreBetaArgs` input, from the launch and the preview alike. */
  plans: [] as unknown[],
  schemaNames: ['enable-assets', 'listen', 'feature-flag'] as string[],
  schemaThrows: false,
  registryThrows: false,
  registryCalls: 0,
  betaEnabled: true,
  /** Settings can throw on read: `resolveBetaFeaturesEnabled` writes the default back on first
   *  read, so a read-only or full disk surfaces here. */
  betaEnabledThrows: false,
  grants: [] as CoreBetaGrant[],
  /** The boot fetch never settles, as on a link that hangs until its deadline. */
  grantsPending: false,
  /** Runs while `acquireLaunchResources` is in flight — after the launching marker exists and
   *  before either path's pre-spawn abort gate, which is exactly the window under test. */
  duringResourceAcquire: null as null | (() => void),
  spawn: null as null | ((...args: unknown[]) => unknown),
  /** Called in place of the real boot probe, once per spawn attempt. Resolving means "this
   *  attempt booted"; a never-settling promise lets the early-exit rejection win instead. */
  waitForPort: null as null | (() => Promise<void>),
  nextPort: 48999,
  /** Ports the harness reports as held (by pid 31337); null = real probes. */
  busyPorts: null as null | number[],
  /** Ports `waitForPortFree` was asked to wait on. */
  portFreeWaits: [] as number[],
  /** The listeners `findPidsByPort` reports on a busy port. */
  busyPids: [31337] as number[],
  /** A live Desktop port lock on a busy port (the pid it names); null = none. */
  portLockPid: null as null | number,
  /** What the mocked `killProcessTree` reports: false = the tree outlived the kill wait. */
  killExits: true,
  campaigns: { registry: [] as unknown[], answers: new Map<string, unknown>() },
  campaignRecords: {} as Record<string, Record<string, { epoch: number; enrolledAt: number }>>,
  recordWrites: [] as Array<[string, string, number]>,
  recordWriteThrows: false,
  recordWriteRecovers: false,
  idClass: 'machine_derived' as string,
  campaignFetches: 0,
  records: null as null | Map<string, Record<string, unknown>>
}))

vi.mock('../../coreBetaCampaignFlags', () => ({
  getCoreBetaCampaigns: async () => {
    launchHarness.campaignFetches++
    return launchHarness.campaigns
  },
  readCampaignRecords: () => launchHarness.campaignRecords,
  campaignRecordSaved: (key: string, arg: string, epoch: number) =>
    launchHarness.campaignRecords[key]?.[arg]?.epoch === epoch,
  writeCampaignRecord: (key: string, arg: string, epoch: number) => {
    if (launchHarness.recordWriteRecovers) {
      launchHarness.campaignRecords = { [key]: { [arg]: { epoch, enrolledAt: 1 } } }
      throw new Error('ENOSPC')
    }
    if (launchHarness.recordWriteThrows) throw new Error('EIO')
    launchHarness.recordWrites.push([key, arg, epoch])
  }
}))

vi.mock('../../deviceId', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getIdClass: () => launchHarness.idClass
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
    installations: new Proxy(actual.installations, {
      get(target, key) {
        const records = launchHarness.records
        if (records && key === 'get') return async (id: string) => records.get(id) ?? null
        if (records && key === 'update') {
          return async (id: string, data: Record<string, unknown>) => {
            const next = { ...(records.get(id) ?? { id }), ...data }
            records.set(id, next)
            return next
          }
        }
        return Reflect.get(target, key) as unknown
      }
    }),
    spawnProcess: (...args: unknown[]) => launchHarness.spawn?.(...args),
    waitForPort: (...args: Parameters<typeof actual.waitForPort>) =>
      launchHarness.waitForPort ? launchHarness.waitForPort() : actual.waitForPort(...args),
    getComfyFeatureFlagRegistry: async () => {
      launchHarness.registryCalls += 1
      if (launchHarness.registryThrows) throw new Error('feature registry unavailable')
      return {}
    },
    findAvailablePort: async () => launchHarness.nextPort,
    waitForPortFree: async (port: number) => {
      launchHarness.portFreeWaits.push(port)
      // The prior process's port frees up during the wait, as the socket teardown finishes.
      if (launchHarness.busyPorts) {
        launchHarness.busyPorts = launchHarness.busyPorts.filter((p) => p !== port)
      }
      return true
    },
    isPortListening: (...args: Parameters<typeof actual.isPortListening>) =>
      launchHarness.busyPorts
        ? Promise.resolve(launchHarness.busyPorts.includes(args[0]))
        : actual.isPortListening(...args),
    findPidsByPort: (...args: Parameters<typeof actual.findPidsByPort>) =>
      launchHarness.busyPorts
        ? Promise.resolve(launchHarness.busyPorts.includes(args[0]) ? launchHarness.busyPids : [])
        : actual.findPidsByPort(...args),
    readPortLock: (...args: Parameters<typeof actual.readPortLock>) =>
      launchHarness.busyPorts
        ? launchHarness.portLockPid !== null && launchHarness.busyPorts.includes(args[0])
          ? { pid: launchHarness.portLockPid, installationName: 'Other', timestamp: 0 }
          : null
        : actual.readPortLock(...args),
    getProcessInfo: (...args: Parameters<typeof actual.getProcessInfo>) =>
      launchHarness.busyPorts
        ? Promise.resolve({ name: 'python', commandLine: 'python -s ComfyUI/main.py' })
        : actual.getProcessInfo(...args),
    // Never let a test reach the real one: the fake child's pid is invented, and killing it
    // would signal whatever real process happens to hold that pid.
    killProcessTree: async () => ({ exited: launchHarness.killExits, waitMs: 0 })
  }
})

/** The ownership record module, answered from here. Never the real one: records would land in
 *  the real state dir under invented pids, and a later launch could then "prove" an unrelated
 *  live process at one of those pids to be an orphan. */
const ownership = vi.hoisted(() => ({
  prior: null as null | Record<string, unknown>,
  priorCalls: [] as Array<{ sessionKey: string; opts: unknown }>,
  priorThrows: false,
  onResolve: null as null | ((opts: unknown) => unknown),
  holderIsInstall: false as boolean | ((pid: number) => boolean),
  tracked: [] as Array<Record<string, unknown>>
}))
vi.mock('../../comfyProcessRecord', () => ({
  resolvePriorProcess: async (sessionKey: string, opts: unknown) => {
    ownership.priorCalls.push({ sessionKey, opts })
    // Lets a test act while the check is "running" (e.g. cancel the launch).
    ownership.onResolve?.(opts)
    if (ownership.priorThrows) throw new Error('state dir unreadable')
    return ownership.prior
  },
  holderIsInstall: async (pid: number) =>
    typeof ownership.holderIsInstall === 'function'
      ? ownership.holderIsInstall(pid)
      : ownership.holderIsInstall,
  trackSpawn: (_proc: unknown, info: Record<string, unknown>) => {
    ownership.tracked.push(info)
  },
  markStopRequested: () => {},
  listRecords: () => []
}))

vi.mock('../../comfy-args', async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyArgsModule>()
  return {
    ...actual,
    getComfyArgsSchema: async () => {
      if (launchHarness.schemaThrows) throw new Error('schema discovery unavailable')
      return schemaOf(...launchHarness.schemaNames)
    },
    getComfyFeatureFlagRegistry: async () => ({}),
    peekComfyArgsSchema: () =>
      launchHarness.schemaThrows ? null : schemaOf(...launchHarness.schemaNames)
  }
})

vi.mock('../../coreBetaGrants', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreBetaGrantsModule>()
  return {
    ...actual,
    getCoreBetaGrantsAsync: () =>
      launchHarness.grantsPending
        ? new Promise<CoreBetaGrant[]>(() => {})
        : Promise.resolve(launchHarness.grants),
    planCoreBetaArgs: (facts: Parameters<typeof actual.planCoreBetaArgs>[0]) => {
      launchHarness.plans.push(facts)
      return actual.planCoreBetaArgs(facts)
    }
  }
})

/** Stands in for the uv subprocess the agent-requirements step drives, so a launch
 *  under test installs nothing and a test can choose the outcome. */
const pipHarness = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: { code: 0, output: '' },
  respond: null as null | ((args: unknown[]) => { code: number; output: string }),
  installed: '[]',
  duringInstall: null as null | (() => void)
}))

vi.mock('../../pip', async (importOriginal) => {
  const actual = await importOriginal<typeof PipModule>()
  return {
    ...actual,
    installFilteredRequirementsDetailed: async (...args: unknown[]) => {
      pipHarness.calls.push(args)
      pipHarness.duringInstall?.()
      return pipHarness.respond?.(args) ?? pipHarness.result
    },
    runUvPipDetailed: async () => ({ code: 0, output: pipHarness.installed })
  }
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
  attachLaunchStreams,
  createAssetsTapSafe,
  buildLaunchArgs,
  desktopFeatureFlags,
  emitCoreBetaRecords,
  emitCoreBetaTelemetry,
  handleLaunch,
  recordCampaignEnrolments,
  isCrashedExit,
  launchedCoreCommit,
  onProcessTerminated,
  writeLog,
  describeLockHolder,
  describePriorOutcome,
  _cleanupFailedLaunchSetup,
  _resolveLaunchMode,
  _resolvePortConflictPolicy
} from './launch'
import * as assetsTapModule from '../../assetsTap'
import {
  BETA_NOTICE_ANNOUNCED_ARGS_KEY,
  _resetForTest as _resetBetaNotice,
  acknowledgeBetaActivationNotice,
  armBetaActivationNotice,
  peekBetaActivationNotice
} from '../../betaActivationNotice'
import * as settingsModule from '../../../settings'
import { previewCoreBetaArgs } from '../../coreBetaPreview'
import type { ActionContext } from './types'
import type * as ComfyDownloadManagerModule from '../../comfyDownloadManager'
import type { createExecutionTap } from '../../executionTap'
import type { createHardwareTap } from '../../hardwareTap'
import type { LaunchProgressTracker } from '../../launchProgress'
import type { ComfyArgsSchema } from '../../comfy-args'
import type { LaunchCommand } from '../../../types/sources'
import { NO_CORE_COMMITS } from '../../coreBetaGrants'
import { appliedPassThrough, parseCampaignAnswer } from '../../coreBetaCampaigns'
import type { CoreBetaGrant, CoreCommitState } from '../../coreBetaGrants'
import * as telemetry from '../../telemetry'
import * as i18nModule from '../../i18n'
import {
  makeSendOutput,
  _getLaunchingInstallationIds,
  _markLaunching,
  _operationAborts,
  _pendingPorts,
  _runningSessions,
  _reservePort
} from '../shared'
import type { ChildProcess, InstallationRecord } from '../shared'
import type * as SharedModule from '../shared'
import type * as ComfyArgsModule from '../../comfy-args'
import type * as CoreBetaGrantsModule from '../../coreBetaGrants'
import type * as HardwareTapModule from '../../hardwareTap'
import type * as PipModule from '../../pip'
import { getUvPath, getVenvPythonPath } from '../../pythonEnv'
import { getLogDir } from '../../logRotation'
import en from '../../../../../locales/en.json'

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

describe('_resolveLaunchMode', () => {
  it('allows a launch-scoped console override without changing the installation', () => {
    const installation = { ...installOf('standalone'), launchMode: 'window' }

    expect(_resolveLaunchMode(installation, { launchModeOverride: 'console' })).toBe('console')
    expect(installation.launchMode).toBe('window')
  })

  it('uses the persisted mode for unsupported overrides', () => {
    const installation = { ...installOf('standalone'), launchMode: 'window' }

    expect(_resolveLaunchMode(installation, { launchModeOverride: 'external' })).toBe('window')
  })
})

describe('_resolvePortConflictPolicy', () => {
  it('allows a launch-scoped automatic port without changing the installation', () => {
    const installation = {
      ...installOf('standalone'),
      launchArgs: '--enable-manager --port 8188',
      portConflict: 'prompt'
    }

    expect(
      _resolvePortConflictPolicy(
        installation,
        { portConflict: 'prompt' },
        {
          autoPortOnConflict: true
        }
      )
    ).toEqual({ mode: 'auto', portIsExplicit: false })
    expect(installation).toMatchObject({
      launchArgs: '--enable-manager --port 8188',
      portConflict: 'prompt'
    })
  })

  it('preserves the configured policy and explicit port for normal launches', () => {
    const installation = {
      ...installOf('standalone'),
      launchArgs: '--port=8188',
      portConflict: 'prompt'
    }

    expect(_resolvePortConflictPolicy(installation, { portConflict: 'auto' })).toEqual({
      mode: 'prompt',
      portIsExplicit: true
    })
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
    expect(callback).toHaveBeenCalledWith(2, 'SIGTERM', { pipesHeld: false })
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
      // Something still holds the pipes: reported, never acted on.
      expect(callback).toHaveBeenCalledWith(null, 'SIGKILL', { pipesHeld: true })
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

  // Arming happens just before the spawn, and on the `skipPortWait` path a spawn failure
  // rethrows out of `guardLaunchSetup` rather than reaching the `!launchResult.ok` cleanup.
  // This is the chokepoint every guarded setup failure passes through, so the claim is
  // dropped here: otherwise the title bar announces a beta feature for a Core that never ran.
  it('drops a beta claim armed by a launch that then failed to spawn', () => {
    _resetBetaNotice()
    armBetaActivationNotice(INSTALL, [{ arg: '--enable-assets', minCoreVersion: '0.3.80' }])
    expect(peekBetaActivationNotice(INSTALL)?.args).toEqual(['--enable-assets'])

    _cleanupFailedLaunchSetup(INSTALL, new AbortController())

    expect(peekBetaActivationNotice(INSTALL)).toBeNull()
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

  it('allows an isolated performance test session while the installation is already running', async () => {
    const installationId = 'running-install'
    const sessionId = `performance-test:${installationId}`
    _runningSessions.set(installationId, {
      proc: null,
      port: 8188,
      mode: 'window',
      installationName: 'Running Install',
      startedAt: Date.now()
    })

    try {
      const result = await handleLaunch({ ...ctxFor(installationId), sessionId })
      expect(result.message).toMatch(/unknownSource|unrecognized source/)
      expect(result.message).not.toMatch(/alreadyRunning/i)
    } finally {
      _runningSessions.delete(installationId)
      _operationAborts.delete(sessionId)
    }
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

describe('createAssetsTapSafe', () => {
  const BASE = {
    installationId: 'assets-tap-base',
    variant: 'nvidia',
    release: '0.3.68',
    coreBetaFlags: ['--enable-assets']
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the launch-gated core-beta flags with the base context', () => {
    const create = vi.spyOn(assetsTapModule, 'createAssetsTap')
    createAssetsTapSafe(BASE)
    expect(create).toHaveBeenCalledWith({
      installationId: 'assets-tap-base',
      variant: 'nvidia',
      release: '0.3.68',
      coreBetaFlags: ['--enable-assets']
    })
  })

  it('hands back the constructed tap when construction succeeds', () => {
    const real = { ingest: vi.fn(), beginBoot: vi.fn(), flushSummary: vi.fn() }
    vi.spyOn(assetsTapModule, 'createAssetsTap').mockReturnValue(real)
    expect(createAssetsTapSafe(BASE)).toBe(real)
  })

  it('substitutes an inert tap when construction throws, letting no exception escape', () => {
    vi.spyOn(assetsTapModule, 'createAssetsTap').mockImplementation(() => {
      throw new Error('assets tap construction exploded')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    let tap: ReturnType<typeof createAssetsTapSafe> | null = null
    expect(() => {
      tap = createAssetsTapSafe(BASE)
    }).not.toThrow()
    expect(consoleError).toHaveBeenCalled()

    // Every lifecycle call the launch path makes must be a safe no-op on the
    // substitute, or containment at construction buys nothing.
    const inert = tap as unknown as ReturnType<typeof createAssetsTapSafe>
    expect(() => {
      inert.beginBoot()
      inert.ingest('[assets-event] assets.enabled hashing_enabled=true\n', 'stdout')
      inert.ingest(
        '[assets-event] scanner.stat_failed error_type=OSError site=discovery\n',
        'stderr'
      )
      inert.flushSummary()
    }).not.toThrow()
  })
})

describe('attachLaunchStreams assets tap wiring', () => {
  function fakeTap() {
    return { ingest: vi.fn(), beginBoot: vi.fn(), flushSummary: vi.fn() }
  }

  function harness(assetsTap = fakeTap()) {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const proc = { stdout, stderr } as unknown as ChildProcess
    const logStream = { writableEnded: false, write: vi.fn() } as unknown as WriteStream
    const execTap = fakeTap()
    const hwTap = fakeTap()
    const tracker = { ingest: vi.fn() } as unknown as LaunchProgressTracker
    const sendOutput = vi.fn()

    const { getStderr } = attachLaunchStreams(
      proc,
      logStream,
      sendOutput,
      execTap as unknown as ReturnType<typeof createExecutionTap>,
      hwTap as unknown as ReturnType<typeof createHardwareTap>,
      assetsTap,
      tracker
    )
    return { stdout, stderr, execTap, hwTap, assetsTap, getStderr }
  }

  it('feeds stdout chunks to the assets tap tagged as stdout', () => {
    const h = harness()
    h.stdout.emit('data', Buffer.from('[assets-event] assets.enabled hashing_enabled=true\n'))
    expect(h.assetsTap.ingest).toHaveBeenCalledWith(
      '[assets-event] assets.enabled hashing_enabled=true\n',
      'stdout'
    )
  })

  it('feeds stderr chunks to the assets tap tagged as stderr', () => {
    const h = harness()
    h.stderr.emit(
      'data',
      Buffer.from('[assets-event] scanner.stat_failed error_type=OSError site=discovery\n')
    )
    expect(h.assetsTap.ingest).toHaveBeenCalledWith(
      '[assets-event] scanner.stat_failed error_type=OSError site=discovery\n',
      'stderr'
    )
  })

  it('leaves the hardware and execution taps receiving both streams unchanged', () => {
    const h = harness()
    h.stdout.emit('data', Buffer.from('out\n'))
    h.stderr.emit('data', Buffer.from('err\n'))
    for (const tap of [h.execTap, h.hwTap]) {
      expect(tap.ingest).toHaveBeenCalledWith('out\n', 'stdout')
      expect(tap.ingest).toHaveBeenCalledWith('err\n', 'stderr')
    }
    expect(h.getStderr()).toBe('err\n')
  })

  it('keeps piping both streams when the inert substitute tap is attached', () => {
    vi.spyOn(assetsTapModule, 'createAssetsTap').mockImplementation(() => {
      throw new Error('assets tap construction exploded')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const inert = createAssetsTapSafe({
        installationId: 'inert',
        variant: null,
        release: null,
        coreBetaFlags: []
      })
      const h = harness(inert as unknown as ReturnType<typeof fakeTap>)
      expect(() => {
        h.stdout.emit('data', Buffer.from('out\n'))
        h.stderr.emit('data', Buffer.from('err\n'))
      }).not.toThrow()
      expect(h.execTap.ingest).toHaveBeenCalledWith('out\n', 'stdout')
      expect(h.hwTap.ingest).toHaveBeenCalledWith('err\n', 'stderr')
      expect(h.getStderr()).toBe('err\n')
    } finally {
      consoleError.mockRestore()
      vi.restoreAllMocks()
    }
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

const ASSETS_GRANT: CoreBetaGrant = { arg: '--enable-assets', minCoreVersion: '0.3.80' }
const PREFIX = ['/opt/py', '-s', 'ComfyUI/main.py']
const DESKTOP_FLAGS = ['--feature-flag', 'show_signin_button=true']

const build = (over: {
  userArgs?: string[]
  schema: ComfyArgsSchema
  betaFlags?: CoreBetaGrant[]
  coreVersion?: string | null
  coreVersionExact?: boolean
  coreVersionVerified?: boolean
  coreVersionCurrent?: boolean
  coreCommits?: CoreCommitState
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
    coreVersionVerified: over.coreVersionVerified ?? true,
    coreVersionCurrent: over.coreVersionCurrent ?? true,
    coreCommits: over.coreCommits ?? NO_CORE_COMMITS,
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
    expect(built.beta.logRecords).toEqual([
      '[core-beta] --enable-assets withheld: entry 1: core version unknown\n'
    ])
  })

  it("injects nothing when the install's base tag was not established by ancestry", () => {
    const built = build({ schema: schemaOf('enable-assets'), coreVersionVerified: false })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.logRecords).toEqual([
      '[core-beta] --enable-assets withheld: entry 1: no ancestry-proven release (base 0.3.81)\n'
    ])
    // Refusing the version claim is not the core refusing the arg; telemetry must not conflate them.
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it('injects nothing when the live checkout contradicts the recorded commit', () => {
    const built = build({ schema: schemaOf('enable-assets'), coreVersionCurrent: false })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.logRecords).toEqual([
      '[core-beta] --enable-assets withheld: entry 1: checkout does not confirm the record\n'
    ])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it('drops a granted arg the running core does not accept, and reports it', () => {
    // Version window and toggle both pass; only the args schema says no.
    const built = build({ userArgs: ['--listen'], schema: schemaOf('listen') })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--listen'])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.logRecords).toEqual([
      '[core-beta] --enable-assets withheld: not supported by this core\n'
    ])
    expect(built.beta.droppedUnsupported).toEqual(['--enable-assets'])
  })

  it('keeps a supported grant while dropping an unsupported one from the same payload', () => {
    const hashing: CoreBetaGrant = { arg: '--enable-asset-hashing', minCoreVersion: '0.3.80' }
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

  it('names the matched HEAD in the record of a commit-bound grant', () => {
    const head = 'e'.repeat(40)
    const lower = 'a'.repeat(40)
    const commitGrant: CoreBetaGrant = { arg: '--enable-assets', commitRanges: [[lower, null]] }
    const built = build({
      schema: schemaOf('enable-assets'),
      betaFlags: [commitGrant],
      coreVersion: null,
      coreCommits: { head, ancestry: new Map([[lower, true]]) }
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets'])
    expect(built.beta.applied, 'a commit grant reads HEAD, so needs no usable version').toEqual([
      commitGrant
    ])
    expect(built.beta.logRecords).toEqual([
      '[core-beta] --enable-assets (core eeeeeeeeeeee in a granted commit range, opted in)\n'
    ])
  })

  it('reports the core version the grants were matched against', () => {
    expect(build({ schema: schemaOf('enable-assets') }).beta.coreVersion).toBe('0.3.81')
  })

  it('lands the arg exactly once when the user and the grant both supply it', () => {
    const built = build({
      userArgs: ['--enable-assets'],
      schema: schemaOf('enable-assets')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets'])
    expect(built.args.filter((arg) => arg === '--enable-assets')).toHaveLength(1)
    expect(built.beta.applied).toEqual([])
    // A grant withheld because the user already had the arg is not a grant the core refused.
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it("keeps the user's own --enable-assets when the beta toggle is off", () => {
    // `--enable-assets` is a first-class launch argument the Desktop UI invites users to set.
    // Grants may only ADD flags: opting out of beta withdraws the GRANT, never the user's
    // own argument.
    const built = build({
      userArgs: ['--enable-assets', '--listen'],
      schema: schemaOf('enable-assets', 'listen'),
      betaEnabled: false
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets', '--listen'])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it("keeps the user's own --enable-assets when the grant is revoked from the payload", () => {
    const built = build({
      userArgs: ['--enable-assets', '--listen'],
      schema: schemaOf('enable-assets', 'listen'),
      betaFlags: []
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets', '--listen'])
    expect(built.beta.applied).toEqual([])
  })

  it("keeps the user's own --enable-assets when the install is outside the version window", () => {
    const built = build({
      userArgs: ['--enable-assets'],
      schema: schemaOf('enable-assets'),
      coreVersion: '0.3.79'
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets'])
    expect(built.beta.applied).toEqual([])
  })

  it('drops a user arg the running core cannot parse', () => {
    // With no grant in play, the args schema is the only thing left that removes a user token —
    // an unparseable `--enable-assets` goes exactly like any other unsupported user arg.
    const built = build({
      userArgs: ['--enable-assets', '--listen'],
      schema: schemaOf('listen'),
      betaFlags: []
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--listen'])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it('suppresses the grant when the user typed the opposite the core cannot parse', () => {
    // Conflict suppression reads the UNFILTERED user args, so a user who opted out still wins
    // even on a core too old to parse their token.
    const built = build({
      userArgs: ['--disable-assets', '--listen'],
      schema: schemaOf('enable-assets', 'listen')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--listen'])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it("suppresses the grant and lands only the user's token when the core knows both", () => {
    const built = build({
      userArgs: ['--disable-assets'],
      schema: schemaOf('enable-assets', 'disable-assets')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--disable-assets'])
    expect(built.beta.applied).toEqual([])
    expect(built.beta.droppedUnsupported).toEqual([])
  })

  it("suppresses a granted --disable-assets against the user's own --enable-assets", () => {
    const built = build({
      userArgs: ['--enable-assets'],
      betaFlags: [{ arg: '--disable-assets', minCoreVersion: '0.3.80' }],
      schema: schemaOf('enable-assets', 'disable-assets')
    })

    expect(built.args).toEqual([...PREFIX, ...DESKTOP_FLAGS, '--enable-assets'])
    expect(built.beta.applied).toEqual([])
  })

  it('never touches user args the grants have no opinion about', () => {
    const built = build({
      userArgs: ['--listen', '--port', '8188'],
      schema: schemaOf('enable-assets', 'listen', 'port')
    })

    expect(built.args).toEqual([
      ...PREFIX,
      ...DESKTOP_FLAGS,
      '--enable-assets',
      '--listen',
      '--port',
      '8188'
    ])
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
        commitsAhead: 0,
        baseTagVerified: true
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
    launchHarness.registryThrows = false
    launchHarness.registryCalls = 0
    launchHarness.betaEnabled = true
    launchHarness.betaEnabledThrows = false
    launchHarness.schemaNames = ['enable-assets', 'listen', 'feature-flag']
    spawnArgs = []
    launchHarness.grants = [HARNESS_GRANT]
    launchHarness.grantsPending = false
    launchHarness.campaigns = { registry: [], answers: new Map() }
    launchHarness.campaignRecords = {}
    launchHarness.recordWrites = []
    launchHarness.recordWriteThrows = false
    launchHarness.recordWriteRecovers = false
    launchHarness.idClass = 'machine_derived'
    launchHarness.campaignFetches = 0
    launchHarness.duringResourceAcquire = null
    launchHarness.waitForPort = null
    // Both halves of the activation-notice state: the in-process pending queue and the
    // persisted announced list, which the real settings module keeps in this run's temp
    // app dir. Without the reset, the first test to launch spends the notice for the rest.
    _resetBetaNotice()
    settingsModule.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, [])
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
    vi.spyOn(telemetry, 'capture').mockImplementation(((
      event: string,
      properties?: Record<string, unknown>
    ) => {
      events.push({ event, properties })
    }) as unknown as typeof telemetry.capture)
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

  describe('campaigns', () => {
    const KEY = 'desktop_core_beta_agent'
    const agentAnswer = (variant: string): unknown =>
      parseCampaignAnswer(
        variant,
        {
          grants: [
            {
              arg: '--enable-agent',
              min_core_version: '0.3.60',
              requires_args: ['--enable-assets'],
              enrolment: { epoch: 1, epochs: [1] }
            }
          ]
        },
        Date.now() - 5_000
      )
    const serveCampaign = (variant: string): void => {
      launchHarness.campaigns = {
        registry: [{ key: KEY, args: ['--enable-agent'] }],
        answers: new Map([[KEY, agentAnswer(variant)]])
      }
    }
    const appliedEvent = (): Record<string, unknown> | undefined =>
      events.filter((e) => e.event === 'comfy.desktop.core_beta.applied').at(-1)?.properties

    const missedEvent = (): Record<string, unknown> | undefined =>
      events.find((e) => e.event === 'comfy.desktop.core_beta.campaign_missed')?.properties

    beforeEach(() => {
      launchHarness.schemaNames = ['enable-assets', 'enable-agent', 'listen', 'feature-flag']
    })

    it('enrols an assets-on machine on enrol: arg after slot #0, a record, and the enrolled event', async () => {
      serveCampaign('enrol')
      const id = 'campaign-enrol'
      expect((await handleLaunch(ctxFor(id))).ok).toBe(true)
      expect(spawnArgs).toEqual(expect.arrayContaining(['--enable-assets', '--enable-agent']))
      expect(spawnArgs.indexOf('--enable-agent')).toBe(spawnArgs.indexOf('--enable-assets') + 1)
      expect(launchHarness.recordWrites).toEqual([[KEY, '--enable-agent', 1]])
      expect(
        events.find((e) => e.event === 'comfy.desktop.core_beta.enrolled')?.properties
      ).toEqual({
        key: KEY,
        arg: '--enable-agent',
        epoch: 1,
        lag_ms: expect.toSatisfy((lag: number) => lag >= 5_000 && lag < 65_000)
      })
      expect(appliedEvent()).toMatchObject({
        args: ['--enable-assets', '--enable-agent'],
        campaign_args: [`${KEY}:--enable-agent:1`]
      })
      expect(missedEvent()).toBeUndefined()
      expect(_runningSessions.get(id)?.coreBetaArgs?.map((view) => view.arg)).toEqual([
        '--enable-assets',
        '--enable-agent'
      ])
      expect(peekBetaActivationNotice(id)?.args).toEqual(['--enable-assets', '--enable-agent'])
      expect(sent.join('')).toContain('[core-beta] --enable-agent')
    })

    it('holds for an enrolled machine on hold, writing nothing new', async () => {
      serveCampaign('hold')
      launchHarness.campaignRecords = { [KEY]: { '--enable-agent': { epoch: 1, enrolledAt: 1 } } }
      await handleLaunch(ctxFor('campaign-hold'))
      expect(spawnArgs).toContain('--enable-agent')
      expect(launchHarness.recordWrites).toEqual([])
      expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.enrolled')
      expect(appliedEvent()).toMatchObject({ campaign_args: [`${KEY}:--enable-agent:1`] })
      expect(missedEvent()).toBeUndefined()
    })

    it('refuses enrolment while assets is off, and reports why', async () => {
      launchHarness.grants = []
      serveCampaign('enrol')
      await handleLaunch(ctxFor('campaign-assets-off'))
      expect(spawnArgs).not.toContain('--enable-agent')
      expect(launchHarness.recordWrites).toEqual([])
      expect(appliedEvent(), 'nothing applied, so the applied event stays silent').toBeUndefined()
      expect(missedEvent()).toEqual({
        idle: [],
        enrol_refused: [`${KEY}:--enable-agent:requires_args`]
      })
    })

    it('idles an enrolled machine while assets is off, keeping its record', async () => {
      launchHarness.grants = []
      serveCampaign('hold')
      launchHarness.campaignRecords = { [KEY]: { '--enable-agent': { epoch: 1, enrolledAt: 1 } } }
      await handleLaunch(ctxFor('campaign-idle'))
      expect(spawnArgs).not.toContain('--enable-agent')
      expect(missedEvent()).toEqual({
        idle: [`${KEY}:--enable-agent:requires_args`],
        enrol_refused: []
      })
    })

    it('never enrols a random_fallback launch', async () => {
      launchHarness.idClass = 'random_fallback'
      serveCampaign('enrol')
      await handleLaunch(ctxFor('campaign-fallback-id'))
      expect(spawnArgs).not.toContain('--enable-agent')
      expect(launchHarness.recordWrites).toEqual([])
    })

    it('leaves a non-member launch exactly as a launch without campaigns', async () => {
      const commandBeforeLaunchMutatesIt = structuredClone(launchHarness.launchCommand)
      await handleLaunch(ctxFor('campaign-none'))
      const without = spawnArgs
      const withoutApplied = appliedEvent()
      launchHarness.launchCommand = commandBeforeLaunchMutatesIt
      serveCampaign('hold')
      await handleLaunch(ctxFor('campaign-non-member'))
      const normalise = (args: string[]): string[] =>
        args.map((arg) => arg.replace('campaign-non-member', 'campaign-none'))
      expect(normalise(spawnArgs)).toEqual(without)
      expect(appliedEvent()).toEqual(withoutApplied)
      expect(events.filter((e) => e.event === 'comfy.desktop.core_beta.applied')).toHaveLength(2)
    })

    it('applies the arg but counts no enrolment when the record cannot be written', async () => {
      launchHarness.recordWriteThrows = true
      serveCampaign('enrol')
      await handleLaunch(ctxFor('campaign-write-fails'))
      expect(spawnArgs).toContain('--enable-agent')
      expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.enrolled')
      expect(appliedEvent(), 'running, but not counted as active').not.toHaveProperty(
        'campaign_args'
      )
      expect(missedEvent()).toEqual({
        idle: [],
        enrol_refused: [`${KEY}:--enable-agent:record_failed`]
      })
    })

    it('proves a campaign commit range against the live HEAD', async () => {
      const head = gitInitComfyUI()
      launchHarness.campaigns = {
        registry: [{ key: KEY, args: ['--enable-agent'] }],
        answers: new Map([
          [
            KEY,
            parseCampaignAnswer(
              'enrol',
              {
                grants: [
                  {
                    arg: '--enable-agent',
                    commit_ranges: [[head, null]],
                    enrolment: { epoch: 1, epochs: [1] }
                  }
                ]
              },
              Date.now()
            )
          ]
        ])
      }
      await handleLaunch(ctxFor('campaign-commit-range'))
      expect(spawnArgs).toContain('--enable-agent')
    })

    it('counts an enrolment whose record reads back after a failed write', async () => {
      launchHarness.recordWriteRecovers = true
      serveCampaign('enrol')
      await handleLaunch(ctxFor('campaign-write-recovers'))
      expect(reportedEvents()).toContain('comfy.desktop.core_beta.enrolled')
      expect(appliedEvent()).toMatchObject({ campaign_args: [`${KEY}:--enable-agent:1`] })
      expect(missedEvent()).toBeUndefined()
    })

    describe('recordCampaignEnrolments', () => {
      const enrolment = {
        key: KEY,
        grant: { arg: '--enable-agent', minCoreVersion: '0.3.60' },
        epoch: 1,
        enrolledNow: true,
        payload: { agent_requirements_override: { 'comfy-agent': '0.2.3' } },
        fetchedAt: Date.now()
      }

      it('keeps an unrecorded enrolment in applied, so its pass-through still reaches the override', () => {
        launchHarness.recordWriteThrows = true
        const result = recordCampaignEnrolments({ applied: [enrolment], misses: [] })
        expect(appliedPassThrough(result.applied, '--enable-agent')).toEqual({
          'comfy-agent': '0.2.3'
        })
        expect(result.misses).toEqual([
          { key: KEY, arg: '--enable-agent', member: false, reason: 'record_failed' }
        ])
      })

      it('survives a telemetry sink that throws', () => {
        vi.mocked(telemetry.emit).mockImplementation(() => {
          throw new Error('sink down')
        })
        expect(() => recordCampaignEnrolments({ applied: [enrolment], misses: [] })).not.toThrow()
        expect(launchHarness.recordWrites).toEqual([[KEY, '--enable-agent', 1]])
      })
    })

    it('fetches no campaign answer and applies none when beta is off', async () => {
      launchHarness.betaEnabled = false
      serveCampaign('enrol')
      await handleLaunch(ctxFor('campaign-beta-off'))
      expect(spawnArgs).not.toContain('--enable-agent')
      expect(launchHarness.recordWrites).toEqual([])
      expect(launchHarness.campaignFetches, 'an opted-out launch never waits on campaigns').toBe(0)
    })
  })

  it('reports on a launch that reaches the skip-port spawn', async () => {
    const res = await handleLaunch(ctxFor('harness-skip-port-spawns'))

    expect(res.ok).toBe(true)
    expect(sent.join('')).toContain('[core-beta] --enable-assets')
    expect(reportedEvents()).toContain('comfy.desktop.core_beta.applied')
    expect(reportedEvents()).toContain('comfy.desktop.core_beta.opt_state')
  })

  function gitInitComfyUI(): string {
    const cwd = path.join(installDir, 'ComfyUI')
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: os.devNull
    }
    execFileSync('git', ['init', '-q'], { cwd, env })
    execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'c'], { cwd, env })
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, env, encoding: 'utf-8' }).trim()
  }

  it('grants a commit-bound entry the live HEAD falls inside', async () => {
    const head = gitInitComfyUI()
    launchHarness.grants = [{ arg: '--enable-assets', commitRanges: [[head, null]] }]

    const res = await handleLaunch(ctxFor('harness-commit-grant'))

    expect(res.ok).toBe(true)
    expect(
      spawnArgs,
      'the record contradicts the checkout, which refuses version entries but not commit entries'
    ).toContain('--enable-assets')
    expect(sent.join('')).toContain(
      `[core-beta] --enable-assets (core ${head.slice(0, 12)} in a granted commit range`
    )
  })

  it('attributes the beta and boot events to the live HEAD, not the recorded commit', async () => {
    const head = gitInitComfyUI()
    launchHarness.grants = [{ arg: '--enable-assets', commitRanges: [[head, null]] }]
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
      cwd: installDir,
      skipPortWait: false,
      port: 48233
    }
    launchHarness.waitForPort = async () => {}

    await handleLaunch(ctxFor('harness-commit-attribution'))

    const applied = events.find((e) => e.event === 'comfy.desktop.core_beta.applied')
    expect(applied?.properties).toMatchObject({ core_commit: head, core_version_label: 'v0.3.81' })
    const boot = events.find((e) => e.event === 'comfy.desktop.comfyui.boot_started')
    expect(boot?.properties).toMatchObject({ core_commit: head, core_version_label: 'v0.3.81' })
  })

  it('launches a legacy record whose version carries no commit', async () => {
    const ctx = ctxFor('harness-legacy-record')
    ctx.inst = {
      ...ctx.inst,
      comfyVersion: { baseTag: 'v0.3.81' }
    } as unknown as InstallationRecord

    const res = await handleLaunch(ctx)

    expect(res.ok).toBe(true)
    expect(spawnArgs.length).toBeGreaterThan(0)
  })

  it("attributes a not-git install's events to its recorded commit", async () => {
    await handleLaunch(ctxFor('harness-record-attribution'))

    const applied = events.find((e) => e.event === 'comfy.desktop.core_beta.applied')
    expect(applied?.properties).toMatchObject({
      core_commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
    })
  })

  it('reports a commit-bound grant withheld because HEAD is past its upper bound', async () => {
    const head = gitInitComfyUI()
    launchHarness.grants = [{ arg: '--enable-assets', commitRanges: [[head, head]] }]

    const res = await handleLaunch(ctxFor('harness-commit-past-upper'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
    const short = head.slice(0, 12)
    expect(sent.join('')).toContain(
      `[core-beta] --enable-assets withheld: entry 1: commit range ${short}..${short}: HEAD past upper ${short}\n`
    )
  })

  it('withholds a commit-bound entry on a not-git install', async () => {
    launchHarness.grants = [{ arg: '--enable-assets', commitRanges: [['a'.repeat(40), null]] }]

    const res = await handleLaunch(ctxFor('harness-commit-grant-not-git'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
  })

  it('still grants through a version entry for the same arg on a not-git install', async () => {
    launchHarness.grants = [
      { arg: '--enable-assets', commitRanges: [['a'.repeat(40), null]] },
      HARNESS_GRANT
    ]

    const res = await handleLaunch(ctxFor('harness-mixed-not-git'))

    expect(res.ok).toBe(true)
    expect(spawnArgs.filter((arg) => arg === '--enable-assets')).toHaveLength(1)
    expect(sent.join('')).toContain(RECORD)
  })

  it('stops writing to a log stream that has errored', () => {
    const stream = fs.createWriteStream(path.join(installDir, 'destroyed.log'))
    stream.on('error', () => {})
    stream.destroy(new Error('disk gone'))
    const write = vi.spyOn(stream, 'write')

    writeLog(stream, 'a line of ComfyUI output\n')

    expect(
      write,
      'each write to a destroyed stream would raise another error'
    ).not.toHaveBeenCalled()
  })

  it('launches without a log file when the log directory cannot be created', async () => {
    // A plain file where the directory should be: `mkdirSync(..., { recursive: true })` throws ENOTDIR.
    fs.writeFileSync(path.join(installDir, 'logs'), '')

    const res = await handleLaunch(ctxFor('harness-logdir-blocked'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(res.ok, 'a log directory problem must not fail the launch').toBe(true)
  })

  it('launches without a log file, rather than crashing, when comfyui.log cannot be opened', async () => {
    const logs = path.join(installDir, 'logs')
    fs.mkdirSync(logs, { recursive: true })
    fs.chmodSync(logs, 0o500)
    try {
      const res = await handleLaunch(ctxFor('harness-log-unopenable'))
      // Let the asynchronous open fail while the directory is still read-only. (As root it stays
      // writable, and the launch simply has its log.)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(res.ok, 'a log file problem must not fail the launch').toBe(true)
    } finally {
      fs.chmodSync(logs, 0o700)
    }
  })

  it('arms the activation notice from the same latch that reports the grant', async () => {
    const id = 'harness-arms-beta-notice'
    expect(peekBetaActivationNotice(id)).toBeNull()

    const res = await handleLaunch(ctxFor(id))

    expect(res.ok).toBe(true)
    expect(peekBetaActivationNotice(id)?.args).toEqual(['--enable-assets'])
  })

  it('arms nothing on a launch whose grants the args schema refused', async () => {
    // A grant the running core cannot parse is dropped as `dropped_unsupported`, so the
    // feature is NOT on and announcing it would be a lie. The schema is the gate the notice
    // inherits by reading `applied` rather than the selected set.
    launchHarness.schemaNames = ['listen', 'feature-flag']
    const id = 'harness-schema-refused'

    const res = await handleLaunch(ctxFor(id))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
    expect(peekBetaActivationNotice(id)).toBeNull()
  })

  it('arms nothing for an install that opted out of beta features', async () => {
    launchHarness.betaEnabled = false
    const id = 'harness-opted-out'

    const res = await handleLaunch(ctxFor(id))

    expect(res.ok).toBe(true)
    expect(peekBetaActivationNotice(id)).toBeNull()
  })

  it('does not wait on the grant fetch for an install that opted out', async () => {
    launchHarness.betaEnabled = false
    launchHarness.grantsPending = true

    const res = await handleLaunch(ctxFor('harness-opted-out-pending'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
  })

  it('arms nothing when the payload asked for a silent grant', async () => {
    // Copy control, not flag control: the arg still reaches the command line, the user just
    // is not told about it.
    launchHarness.grants = [{ ...HARNESS_GRANT, notice: { silent: true } }]
    const id = 'harness-silent-grant'

    const res = await handleLaunch(ctxFor(id))

    expect(res.ok).toBe(true)
    expect(spawnArgs).toContain('--enable-assets')
    expect(peekBetaActivationNotice(id)).toBeNull()
  })

  it('carries the payload feature name onto the pending card', async () => {
    launchHarness.grants = [{ ...HARNESS_GRANT, notice: { description: 'Asset library' } }]
    const id = 'harness-named-grant'

    await handleLaunch(ctxFor(id))

    expect(peekBetaActivationNotice(id)).toEqual({
      args: ['--enable-assets'],
      direction: 'enabled',
      description: 'Asset library'
    })
  })

  it('stays silent on the NEXT launch once the notice has been acknowledged', async () => {
    const id = 'harness-announces-once'
    await handleLaunch(ctxFor(id))
    acknowledgeBetaActivationNotice(id)
    expect(settingsModule.get(BETA_NOTICE_ANNOUNCED_ARGS_KEY)).toEqual(['--enable-assets'])

    await handleLaunch(ctxFor(id))

    expect(peekBetaActivationNotice(id)).toBeNull()
  })

  /** The commit `harnessInstall`'s record names, i.e. what the version gate believes is running. */
  const RECORDED_COMMIT = '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
  /** A different commit, as a `git pull` would leave the checkout after the record was written. */
  const PULLED_COMMIT = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c'

  /** Give the install a git checkout at `sha`, in the detached-HEAD shape `readGitHead` reads.
   *  Absent by default, which is the standalone/archive install the other cases launch as. */
  function writeGitHead(sha: string): void {
    const gitDir = path.join(installDir, 'ComfyUI', '.git')
    fs.mkdirSync(gitDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'HEAD'), `${sha}\n`)
  }

  /** Give the install a git checkout whose HEAD cannot be established: the `.git` directory is
   *  there, but HEAD is empty. Empty rather than chmod-ed or deleted because it is the one
   *  shape that reproduces identically on every platform CI runs on, and it is a real state —
   *  mid-`git pull`, HEAD is rewritten, which is exactly when this gate is asked. */
  function writeUnreadableGitHead(): void {
    const gitDir = path.join(installDir, 'ComfyUI', '.git')
    fs.mkdirSync(gitDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'HEAD'), '')
  }

  it('withholds grants when the live checkout has moved off the recorded commit', async () => {
    // A `git pull` after the record was written leaves `commitsAhead: 0` true of a commit that
    // is no longer checked out, so `exact` and `verified` both still pass — they are assertions
    // about the recorded commit, not about the checkout still being at it. Core's args schema
    // does not cover for that here: a NEWER core still parses `--enable-assets`, so the upper
    // bound has nothing behind it but the stale record.
    writeGitHead(PULLED_COMMIT)

    const res = await handleLaunch(ctxFor('harness-record-superseded'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
    expect(sent.join(''), 'no grant record').not.toContain('[core-beta] --enable-assets (')
    expect(sent.join(''), 'the refusal is reported with its reason').toContain(
      '[core-beta] --enable-assets withheld: entry 1: checkout does not confirm the record'
    )
  })

  it('applies grants when the live checkout is still at the recorded commit', async () => {
    writeGitHead(RECORDED_COMMIT)

    const res = await handleLaunch(ctxFor('harness-record-current'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).toContain('--enable-assets')
  })

  it('applies grants to a standalone install, which has no HEAD to contradict the record', async () => {
    // No `.git` at all: `readGitHead` returns null and there is no contradiction to observe, so
    // the record stands. Archive installs are the majority of Desktop — they must not lose
    // grants to a check that only git checkouts can answer.
    expect(fs.existsSync(path.join(installDir, 'ComfyUI', '.git'))).toBe(false)

    const res = await handleLaunch(ctxFor('harness-standalone-no-git'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).toContain('--enable-assets')
  })

  it('withholds grants when the install is git-managed but its HEAD cannot be read', async () => {
    // Between "no git" and "HEAD says X" sits a third state: a git checkout whose HEAD we could
    // not establish. Collapsing it into the no-git case grants on it, which inverts the gate —
    // an unreadable HEAD is most likely mid-pull, i.e. precisely the move this check exists to
    // catch. The `.git` directory is the observable difference from the standalone case.
    writeUnreadableGitHead()

    const res = await handleLaunch(ctxFor('harness-git-head-unreadable'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
    expect(sent.join(''), 'no grant record').not.toContain('[core-beta] --enable-assets (')
    expect(sent.join(''), 'the refusal is reported with its reason').toContain(
      '[core-beta] --enable-assets withheld: entry 1: checkout does not confirm the record'
    )
  })

  it('withholds grants when .git is a pointer file the git dir cannot be resolved from', async () => {
    // One layer below the unreadable-HEAD case: `.git` exists, so this IS a git-managed
    // checkout, but it is a worktree/submodule pointer with no `gitdir:` line, so there is no
    // git directory to read a HEAD out of. Classifying that as "not a git install" — which is
    // what a bare `resolveGitDir() === null` check does — hands it the standalone install's
    // unconditional grant, on a checkout whose commit was never established.
    const dotGit = path.join(installDir, 'ComfyUI', '.git')
    fs.writeFileSync(dotGit, 'this file is not a gitdir pointer\n')

    const res = await handleLaunch(ctxFor('harness-git-pointer-unresolvable'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
    expect(sent.join(''), 'no grant record').not.toContain('[core-beta] --enable-assets (')
    expect(sent.join(''), 'the refusal is reported with its reason').toContain(
      '[core-beta] --enable-assets withheld: entry 1: checkout does not confirm the record'
    )
  })

  it('withholds grants when .git is a dangling symlink', async () => {
    // The case that forces `lstat` over `stat`: `stat` follows the link, finds nothing, and
    // raises ENOENT — indistinguishable from an install that never had a `.git` at all, so the
    // checkout is waved through as standalone. `lstat` sees the link itself, and a link
    // pointing at a missing git dir is a broken checkout, not an absent one.
    const dotGit = path.join(installDir, 'ComfyUI', '.git')
    try {
      fs.symlinkSync(path.join(installDir, 'no-such-git-dir'), dotGit)
    } catch {
      // Windows without Developer Mode / SeCreateSymbolicLink cannot create one at all.
      return
    }
    expect(fs.existsSync(dotGit)).toBe(false) // `stat`-based existence says "absent"

    const res = await handleLaunch(ctxFor('harness-git-dangling-symlink'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
    expect(sent.join(''), 'no grant record').not.toContain('[core-beta] --enable-assets (')
    expect(sent.join(''), 'the refusal is reported with its reason').toContain(
      '[core-beta] --enable-assets withheld: entry 1: checkout does not confirm the record'
    )
  })

  it('withholds grants when the .git entry cannot be stat-ed at all', async () => {
    // The third way `.git` resolution fails: the entry is neither absent nor readable — an
    // EACCES/EPERM/ELOOP on the `lstat` itself. No portable way to produce that on a real
    // filesystem (a chmod-ed parent does nothing when the suite runs as root, and Windows has
    // no equivalent), so the error is injected at the one syscall that classifies it. Every
    // other path stays real.
    const realLstatSync = fs.lstatSync
    vi.spyOn(fs, 'lstatSync').mockImplementation(((target: fs.PathLike, opts?: object) => {
      if (String(target).endsWith(`${path.sep}.git`)) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
      return realLstatSync(target, opts as never)
    }) as typeof fs.lstatSync)

    const res = await handleLaunch(ctxFor('harness-git-stat-indeterminate'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).not.toContain('--enable-assets')
    expect(sent.join(''), 'no grant record').not.toContain('[core-beta] --enable-assets (')
    expect(sent.join(''), 'the refusal is reported with its reason').toContain(
      '[core-beta] --enable-assets withheld: entry 1: checkout does not confirm the record'
    )
  })

  it('continues a skip-port launch when renderer reporting throws', async () => {
    const ctx = ctxFor('harness-skip-port-report-throws')
    const send = ctx.event.sender.send.bind(ctx.event.sender)
    ctx.event.sender.send = vi.fn((channel: string, payload: { text?: string }) => {
      if (payload.text?.startsWith('[core-beta]')) throw new Error('renderer unavailable')
      send(channel, payload)
    })

    const res = await handleLaunch(ctx)

    expect(res.ok).toBe(true)
    expect(spawnArgs).toContain('--enable-assets')
    expect(reportedEvents()).toContain('comfy.desktop.core_beta.applied')
    expect(reportedEvents()).toContain('comfy.desktop.core_beta.opt_state')
  })

  it('continues a skip-port launch when beta telemetry reporting throws', async () => {
    vi.mocked(telemetry.emit).mockImplementation((event) => {
      if (event === 'comfy.desktop.core_beta.applied') throw new Error('sink unavailable')
    })

    const res = await handleLaunch(ctxFor('harness-skip-port-telemetry-throws'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).toContain('--enable-assets')
    expect(sent.join('')).toContain('[core-beta] --enable-assets')
  })

  it.each([
    ['supported grant only', true, [HARNESS_GRANT], ['--enable-assets']],
    [
      'mixed supported and unsupported grants',
      true,
      [HARNESS_GRANT, { arg: '--enable-asset-hashing', minCoreVersion: '0.3.80' }],
      ['--enable-assets']
    ],
    ['revoked grant', true, [], []],
    ['beta opt-out', false, [HARNESS_GRANT], []],
    ['outside version window', true, [{ ...HARNESS_GRANT, minCoreVersion: '0.3.82' }], []]
  ])('attributes assets events to %s', async (_name, optedIn, grants, expected) => {
    launchHarness.betaEnabled = optedIn
    launchHarness.grants = grants
    launchHarness.launchCommand!.args = [
      '-s',
      path.join(installDir, 'ComfyUI', 'main.py'),
      '--listen'
    ]
    const child = fakeChild()
    launchHarness.spawn = (_cmd, args) => {
      spawnArgs = args as string[]
      return child
    }

    const res = await handleLaunch(ctxFor(`harness-assets-context-${_name}`))
    expect(res.ok).toBe(true)
    child.stdout.emit('data', Buffer.from('[assets-event] assets.enabled hashing_enabled=false\n'))

    const assetsEvents = events.filter(
      (e) => e.event === 'comfy.desktop.comfyui.assets.assets.enabled'
    )
    expect(assetsEvents).toHaveLength(1)
    expect(assetsEvents[0]!.properties).toMatchObject({ core_beta_flags: expected })
    expect(
      spawnArgs.filter((arg) => arg === '--enable-assets' || arg === '--enable-asset-hashing')
    ).toEqual(expected)
  })

  // Assets can now run without a grant having been applied, so attribution must report what
  // the grant system applied rather than what is on the command line — otherwise a self-enrolled user
  // lands inside the cohort and skews the soak denominator.
  it("reports no beta flags when assets run from the user's own argument", async () => {
    launchHarness.betaEnabled = false
    launchHarness.grants = []
    launchHarness.launchCommand!.args = [
      '-s',
      path.join(installDir, 'ComfyUI', 'main.py'),
      '--listen',
      '--enable-assets'
    ]
    const child = fakeChild()
    launchHarness.spawn = (_cmd, args) => {
      spawnArgs = args as string[]
      return child
    }

    const res = await handleLaunch(ctxFor('harness-assets-context-user-owned'))
    expect(res.ok).toBe(true)
    child.stdout.emit('data', Buffer.from('[assets-event] assets.enabled hashing_enabled=false\n'))

    expect(spawnArgs).toContain('--enable-assets')

    const assetsEvents = events.filter(
      (e) => e.event === 'comfy.desktop.comfyui.assets.assets.enabled'
    )
    expect(assetsEvents).toHaveLength(1)
    expect(assetsEvents[0]!.properties).toMatchObject({ core_beta_flags: [] })
  })

  it.each([
    ['schema', true, false],
    ['feature registry', false, true]
  ])(
    'launches the user args verbatim after failed %s discovery without mutating stored args',
    async (_discovery, schemaThrows, registryThrows) => {
      const storedArgs = [
        '--enable-assets',
        '-s',
        path.join(installDir, 'ComfyUI', 'main.py'),
        '--listen',
        '--enable-assets',
        '--enable-asset-hashing',
        '--cpu'
      ]
      launchHarness.launchCommand = {
        cmd: process.execPath,
        args: storedArgs,
        cwd: installDir,
        skipPortWait: true
      }
      launchHarness.schemaNames = [
        'enable-assets',
        'enable-asset-hashing',
        'listen',
        'cpu',
        'feature-flag',
        'list-feature-flags'
      ]
      launchHarness.schemaThrows = schemaThrows
      launchHarness.registryThrows = registryThrows

      const res = await handleLaunch(ctxFor(`harness-${_discovery}-failure`))

      expect(res.ok).toBe(true)
      expect(launchHarness.registryCalls).toBe(schemaThrows ? 0 : 1)
      expect(spawnArgs.slice(0, 3)).toEqual([
        '--enable-assets',
        '-s',
        path.join(installDir, 'ComfyUI', 'main.py')
      ])
      expect(spawnArgs).toContain('--listen')
      expect(spawnArgs).toContain('--cpu')
      // The fallback injects no grants, but it withdraws nothing either: discovery failing is
      // not a reason to launch with fewer of the user's own args than they asked for.
      expect(spawnArgs.slice(3)).toContain('--enable-assets')
      expect(spawnArgs).toContain('--enable-asset-hashing')
      // Mutating `launchCmd.args` in place would edit the array the source object owns.
      expect(storedArgs).toEqual([
        '--enable-assets',
        '-s',
        path.join(installDir, 'ComfyUI', 'main.py'),
        '--listen',
        '--enable-assets',
        '--enable-asset-hashing',
        '--cpu'
      ])
      expect(reportedEvents()).not.toContain('comfy.desktop.core_beta.applied')
    }
  )

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

  it('reports once and drains both assets tails before a port-conflict retry without resetting caps', async () => {
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
      if (children.length === 1) {
        expect(
          events.filter((e) => e.event === 'comfy.desktop.comfyui.assets.assets.enabled')
        ).toHaveLength(1)
        expect(
          events.filter((e) => e.event === 'comfy.desktop.comfyui.assets.scanner.stat_failed')
        ).toHaveLength(1)
      }
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
      first.stdout.emit(
        'data',
        Buffer.from('[assets-event] seeder.scan_started root=models\n'.repeat(60))
      )
      first.stdout.emit('data', Buffer.from('[assets-event] assets.enabled hashing_enabled=true'))
      first.stderr.emit(
        'data',
        Buffer.from('[assets-event] scanner.stat_failed error_type=OSError site=discovery')
      )
      first.emit('close', 1, null)
      return new Promise<void>(() => {})
    }

    const res = await handleLaunch(ctxFor('harness-retry-reports-once'))

    expect(res.ok).toBe(true)
    expect(attempt).toBe(2)
    expect(children).toHaveLength(2)
    expect(events.filter((e) => e.event === 'comfy.desktop.core_beta.opt_state')).toHaveLength(1)
    expect(sent.join('').match(/\[core-beta\]/g) ?? []).toHaveLength(1)
    children[1]!.stdout.emit(
      'data',
      Buffer.from('[assets-event] seeder.scan_started root=models\n')
    )
    expect(
      events.filter((e) => e.event === 'comfy.desktop.comfyui.assets.seeder.scan_started')
    ).toHaveLength(60)
    const bootEvents = events.filter((e) => e.event.startsWith('comfy.desktop.comfyui.boot_'))
    expect(bootEvents.map((e) => e.event)).toEqual([
      'comfy.desktop.comfyui.boot_started',
      'comfy.desktop.comfyui.boot_started',
      'comfy.desktop.comfyui.boot_completed'
    ])
    expect(bootEvents.every((e) => e.properties?.assets_enabled === true)).toBe(true)
    expect(bootEvents.map((e) => e.properties?.core_beta_flags)).toEqual([
      ['--enable-assets'],
      ['--enable-assets'],
      ['--enable-assets']
    ])
    for (const { properties } of bootEvents) {
      expect(properties).toMatchObject({ core_beta_opted_in: true, core_version: '0.3.81' })
    }
  })

  it.each([
    // description, opted in, manual flag, discovery fails, flag supported, expected cohort
    ['opted out without a flag', false, false, false, true, false],
    ['opted out with a manual flag', false, true, false, true, true],
    ['discovery fails with a manual flag', true, true, true, true, true],
    ['discovery fails without a flag', true, false, true, true, false],
    ['schema removes an unsupported manual flag', false, true, false, false, false],
    ['opted in without a grant', true, false, false, true, false]
  ] as const)(
    'tags boot arguments independently of grants: %s',
    async (_description, optedIn, manualFlag, discoveryFails, supported, expected) => {
      launchHarness.betaEnabled = optedIn
      launchHarness.grants = []
      launchHarness.schemaThrows = discoveryFails
      launchHarness.schemaNames = supported ? ['enable-assets', 'listen'] : ['listen']
      launchHarness.launchCommand = {
        cmd: process.execPath,
        args: [
          '-s',
          path.join(installDir, 'ComfyUI', 'main.py'),
          '--listen',
          ...(manualFlag ? ['--enable-assets'] : [])
        ],
        cwd: installDir,
        skipPortWait: false,
        port: 48233
      }
      launchHarness.waitForPort = async () => {}

      const res = await handleLaunch(ctxFor(`harness-assets-cohort-${_description}`))

      expect(res.ok).toBe(true)
      expect(spawnArgs.includes('--enable-assets')).toBe(expected)
      const bootEvents = events.filter((e) => e.event.startsWith('comfy.desktop.comfyui.boot_'))
      expect(bootEvents.map((e) => e.event)).toEqual([
        'comfy.desktop.comfyui.boot_started',
        'comfy.desktop.comfyui.boot_completed'
      ])
      for (const { properties } of bootEvents) {
        expect(properties).toMatchObject({
          assets_enabled: expected,
          core_beta_flags: [],
          core_beta_opted_in: optedIn,
          core_version: '0.3.81'
        })
      }
    }
  )

  it('keeps the applied Assets cohort on terminal boot failure', async () => {
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
      cwd: installDir,
      skipPortWait: false,
      port: 48234
    }
    launchHarness.waitForPort = async () => {
      throw new Error('boot timed out')
    }

    const res = await handleLaunch(ctxFor('harness-assets-failed'))

    expect(res.ok).toBe(false)
    const bootEvents = events.filter((e) =>
      ['comfy.desktop.comfyui.boot_started', 'comfy.desktop.comfyui.boot_failed'].includes(e.event)
    )
    expect(bootEvents.map((e) => e.event)).toEqual([
      'comfy.desktop.comfyui.boot_started',
      'comfy.desktop.comfyui.boot_failed'
    ])
    expect(bootEvents.every((e) => e.properties?.assets_enabled === true)).toBe(true)
    expect(bootEvents.map((e) => e.properties?.core_beta_flags)).toEqual([
      ['--enable-assets'],
      ['--enable-assets']
    ])
    for (const { properties } of bootEvents) {
      expect(properties).toMatchObject({ core_beta_opted_in: true, core_version: '0.3.81' })
    }
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

  describe('session record of the applied grants (settings beta-args pill)', () => {
    const launched: string[] = []
    const launch = async (id: string): Promise<void> => {
      launched.push(id)
      const res = await handleLaunch(ctxFor(id))
      expect(res.ok).toBe(true)
    }
    const recorded = (id: string): unknown => _runningSessions.get(id)?.coreBetaArgs

    afterEach(() => {
      while (launched.length) _runningSessions.delete(launched.pop()!)
    })

    it('still prints the selection trace that explains each grant', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      await launch('harness-session-trace')
      expect(log.mock.calls.map((call) => String(call[0]))).toContain(
        '[core-beta] window --enable-assets: >=0.3.80 version=0.3.81 exact=true'
      )
    })

    it('records each applied grant with its payload name on the skip-port spawn', async () => {
      launchHarness.grants = [{ ...HARNESS_GRANT, notice: { description: 'Asset browser' } }]
      await launch('harness-session-skip-port')
      expect(recorded('harness-session-skip-port')).toEqual([
        { arg: '--enable-assets', name: 'Asset browser' }
      ])
    })

    it('records the grants on the port-wait spawn too', async () => {
      launchHarness.grants = [{ ...HARNESS_GRANT, notice: { description: 'Asset browser' } }]
      launchHarness.launchCommand = {
        cmd: process.execPath,
        args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
        cwd: installDir,
        skipPortWait: false,
        port: 48236
      }
      launchHarness.waitForPort = async () => {}
      await launch('harness-session-port-wait')
      expect(recorded('harness-session-port-wait')).toEqual([
        { arg: '--enable-assets', name: 'Asset browser' }
      ])
    })

    it('records a silent grant, since it is still on the command line', async () => {
      launchHarness.grants = [{ ...HARNESS_GRANT, notice: { silent: true } }]
      await launch('harness-session-silent')
      expect(recorded('harness-session-silent')).toEqual([{ arg: '--enable-assets', name: null }])
    })

    it('records no grants for an opted-out launch', async () => {
      launchHarness.betaEnabled = false
      await launch('harness-session-opted-out')
      expect(recorded('harness-session-opted-out')).toEqual([])
    })

    it("omits a grant the user's own args override", async () => {
      launchHarness.schemaNames = ['enable-assets', 'disable-assets', 'listen', 'feature-flag']
      launchHarness.launchCommand = {
        cmd: process.execPath,
        args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--disable-assets'],
        cwd: installDir,
        skipPortWait: true
      }
      await launch('harness-session-user-override')
      expect(spawnArgs).not.toContain('--enable-assets')
      expect(recorded('harness-session-user-override')).toEqual([])
    })
  })

  describe('the next-launch preview decides from the facts the launch uses', () => {
    afterEach(() => {
      _runningSessions.delete('harness-equivalence')
    })

    it('hands planCoreBetaArgs the same facts as the launch that follows it', async () => {
      settingsModule.set('betaFeaturesEnabled', true)
      launchHarness.grants = [{ ...HARNESS_GRANT, notice: { description: 'Asset browser' } }]
      launchHarness.plans = []

      const preview = await previewCoreBetaArgs(
        'harness-equivalence',
        harnessInstall(),
        launchHarness.launchCommand as LaunchCommand
      )
      const res = await handleLaunch(ctxFor('harness-equivalence'))
      expect(res.ok).toBe(true)

      expect(launchHarness.plans).toHaveLength(2)
      const [previewFacts, launchFacts] = launchHarness.plans
      expect(previewFacts).toEqual(launchFacts)
      expect(preview).toEqual(_runningSessions.get('harness-equivalence')?.coreBetaArgs)
      expect(preview).toEqual([{ arg: '--enable-assets', name: 'Asset browser' }])
    })
  })
})

describe('emitCoreBetaTelemetry', () => {
  const COMMIT = '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
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
      coreCommit: COMMIT,
      coreVersionLabel: 'v0.3.81+15',
      optedIn: true
    })

    const applied = captured.find((c) => c.event === 'comfy.desktop.core_beta.applied')
    expect(applied!.ctx).toEqual({
      args: ['--enable-assets'],
      core_version: '0.3.81',
      core_commit: COMMIT,
      core_version_label: 'v0.3.81+15',
      dropped_unsupported: []
    })
  })

  it('reports a grant the core rejected even though nothing was applied', () => {
    emitCoreBetaTelemetry({
      appliedArgs: [],
      droppedUnsupported: ['--enable-assets'],
      coreVersion: '0.3.81',
      coreCommit: COMMIT,
      coreVersionLabel: 'v0.3.81+15',
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
      coreCommit: null,
      coreVersionLabel: null,
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
      coreCommit: COMMIT,
      coreVersionLabel: 'v0.3.81+15',
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
      coreCommit: COMMIT,
      coreVersionLabel: 'v0.3.81+15',
      optedIn: true
    })

    expect(captured.map((c) => c.event)).toEqual([
      'comfy.desktop.core_beta.applied',
      'comfy.desktop.core_beta.opt_state'
    ])
  })
})

describe('agent requirements at launch', () => {
  const AGENT_GRANT: CoreBetaGrant = { arg: '--enable-agent', minCoreVersion: '0.3.80' }
  let installDir = ''
  let sent: string[] = []
  let progress: { phase: string; steps?: { phase: string }[] }[] = []
  let spawnArgs: string[] = []
  let spawned = 0

  /** Create a file (and its parents) the way the real install layout has it. */
  const touch = (target: string): void => {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '')
  }

  const agentReqPath = (): string => path.join(installDir, 'ComfyUI', 'agent_requirements.txt')

  const harnessInstall = (): InstallationRecord =>
    ({
      id: 'agent-reqs-inst',
      name: 'Agent Harness',
      sourceId: 'harness-source',
      installPath: installDir,
      version: '0.3.81',
      comfyVersion: {
        commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        baseTag: 'v0.3.81',
        commitsAhead: 0,
        baseTagVerified: true
      }
    }) as unknown as InstallationRecord

  const ctxFor = (installationId: string): ActionContext => ({
    event: {
      sender: {
        isDestroyed: () => false,
        send: (channel: string, payload: { text?: string; phase?: string }) => {
          if (typeof payload?.text === 'string') sent.push(payload.text)
          if (channel === 'install-progress' && typeof payload?.phase === 'string') {
            progress.push(payload as { phase: string; steps?: { phase: string }[] })
          }
        }
      }
    } as unknown as Electron.IpcMainInvokeEvent,
    installationId,
    inst: harnessInstall(),
    actionData: {}
  })

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reqs-launch-'))
    fs.mkdirSync(path.join(installDir, 'ComfyUI'), { recursive: true })
    // The managed pair the shared uv helper targets, plus the file Core ships.
    touch(getUvPath(installDir))
    touch(getVenvPythonPath(installDir))
    fs.writeFileSync(agentReqPath(), 'comfyui-agent==1.0.0\n')
    sent = []
    progress = []
    spawnArgs = []
    spawned = 0
    pipHarness.calls = []
    pipHarness.result = { code: 0, output: '' }
    pipHarness.duringInstall = null
    pipHarness.respond = null
    launchHarness.records = null
    launchHarness.schemaThrows = false
    launchHarness.registryThrows = false
    launchHarness.betaEnabled = true
    launchHarness.betaEnabledThrows = false
    launchHarness.schemaNames = ['enable-agent', 'listen', 'feature-flag']
    launchHarness.grants = []
    launchHarness.duringResourceAcquire = null
    launchHarness.spawn = (_cmd: unknown, args: unknown) => {
      spawned += 1
      spawnArgs = args as string[]
      const proc = new EventEmitter() as FakeChild
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.pid = 4243
      proc.killed = false
      proc.kill = () => true
      return proc
    }
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--enable-agent', '--listen'],
      cwd: installDir,
      skipPortWait: true
    }
    vi.spyOn(telemetry, 'emit').mockImplementation((() => {}) as unknown as typeof telemetry.emit)
  })

  afterEach(async () => {
    // The launch log stream opens asynchronously after the spawn: removing the
    // install dir first fails that open with an ENOENT nothing is listening for.
    // The file appears exactly when the open lands, so waiting on it is the
    // teardown's own gate rather than a guess at how long the open takes.
    if (spawned > 0) {
      const logFile = path.join(getLogDir(installDir), 'comfyui.log')
      await vi.waitFor(() => expect(fs.existsSync(logFile)).toBe(true))
    }
    vi.restoreAllMocks()
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  it('installs the requirements when the user typed the flag by hand', async () => {
    const res = await handleLaunch(ctxFor('agent-reqs-hand-typed'))

    expect(res.ok).toBe(true)
    expect(pipHarness.calls).toHaveLength(1)
    expect(pipHarness.calls[0]![0]).toBe(agentReqPath())
    expect(pipHarness.calls[0]![1]).toBe(getUvPath(installDir))
    expect(pipHarness.calls[0]![2]).toBe(getVenvPythonPath(installDir))
    expect(spawnArgs).toContain('--enable-agent')
  })

  it('installs the requirements when a beta grant added the flag', async () => {
    // The grant is the only source of the flag here: the install's own args have none.
    launchHarness.grants = [AGENT_GRANT]
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
      cwd: installDir,
      skipPortWait: true
    }

    const res = await handleLaunch(ctxFor('agent-reqs-granted'))

    expect(res.ok).toBe(true)
    expect(pipHarness.calls).toHaveLength(1)
    expect(spawnArgs).toContain('--enable-agent')
  })

  it('installs nothing when the flag never reaches the final args', async () => {
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen'],
      cwd: installDir,
      skipPortWait: true
    }

    const res = await handleLaunch(ctxFor('agent-reqs-flag-absent'))

    expect(res.ok).toBe(true)
    expect(pipHarness.calls).toEqual([])
  })

  it('installs nothing when the running core cannot parse the flag', async () => {
    // A core predating `--enable-agent` has it filtered out of the final args,
    // so there is nothing to install for and nothing reaches the spawn either.
    launchHarness.schemaNames = ['listen', 'feature-flag']

    const res = await handleLaunch(ctxFor('agent-reqs-unsupported-core'))

    expect(res.ok).toBe(true)
    expect(pipHarness.calls).toEqual([])
    expect(spawnArgs).not.toContain('--enable-agent')
  })

  it('installs nothing when core ships no agent requirements file', async () => {
    fs.rmSync(agentReqPath())

    const res = await handleLaunch(ctxFor('agent-reqs-file-absent'))

    expect(res.ok).toBe(true)
    expect(pipHarness.calls).toEqual([])
    expect(spawnArgs).toContain('--enable-agent')
  })

  it('installs nothing for an install with no Desktop-managed Python environment', async () => {
    fs.rmSync(getUvPath(installDir))

    const res = await handleLaunch(ctxFor('agent-reqs-unmanaged-env'))

    expect(res.ok).toBe(true)
    expect(pipHarness.calls).toEqual([])
    expect(spawnArgs).toContain('--enable-agent')
  })

  it('launches with the flag still set when the install fails', async () => {
    pipHarness.result = { code: 1, output: 'No solution found\n' }

    const res = await handleLaunch(ctxFor('agent-reqs-install-failed'))

    expect(res.ok).toBe(true)
    expect(spawnArgs).toContain('--enable-agent')
    expect(sent.join('')).toContain('exited with code 1')
  })

  it('publishes the install as a step the renderer can show', async () => {
    // The renderer drops progress for a phase absent from the steps payload, so
    // the payload is what makes the step visible at all.
    await handleLaunch(ctxFor('agent-reqs-step-published'))

    const lastSteps = progress.filter((p) => p.phase === 'steps').at(-1)
    expect(lastSteps?.steps?.map((s) => s.phase)).toContain('agentRequirements')
    expect(progress.some((p) => p.phase === 'agentRequirements')).toBe(true)
  })

  it('cancels the launch without spawning when it is aborted mid-install', async () => {
    pipHarness.duringInstall = () => _operationAborts.get('agent-reqs-cancelled')?.abort()

    const res = await handleLaunch(ctxFor('agent-reqs-cancelled'))

    expect(res).toEqual({ ok: false, cancelled: true })
    expect(spawned).toBe(0)
  })

  describe('with a version override from the agent campaign', () => {
    const KEY = 'desktop_core_beta_agent'
    const ID = 'agent-override-inst'
    const CORE_FILE = 'comfy-agent==0.2.0\ncomfy-cli==1.21.0\n'
    const OVERRIDDEN = 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\n'
    let proc: FakeChild | null = null
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
    }

    const serveCampaign = (override: unknown): void => {
      const answer = parseCampaignAnswer(
        'enrol',
        {
          grants: [
            {
              arg: '--enable-agent',
              min_core_version: '0.3.60',
              enrolment: { epoch: 1, epochs: [1] }
            }
          ],
          agent_requirements_override: override
        },
        Date.now()
      )
      launchHarness.campaigns = {
        registry: [{ key: KEY, args: ['--enable-agent'] }],
        answers: new Map([[KEY, answer]])
      }
    }

    let installed: string[] = []
    const overrideEvents = (): Record<string, unknown>[] =>
      vi
        .mocked(telemetry.emit)
        .mock.calls.filter(([event]) => event === 'comfy.desktop.agent_requirements_override')
        .map(([, props]) => props as Record<string, unknown>)
    const overrideState = (): unknown => launchHarness.records!.get(ID)?.agentRequirementsOverride

    const launchCommand = (...extra: string[]): Record<string, unknown> => ({
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), ...extra, '--listen'],
      cwd: installDir,
      skipPortWait: true
    })

    const launchAndPrint = async (
      opts: { lines?: string[]; stream?: 'stdout' | 'stderr'; handTyped?: boolean } = {}
    ): Promise<void> => {
      launchHarness.launchCommand = opts.handTyped
        ? launchCommand('--enable-agent')
        : launchCommand()
      const ctx = ctxFor(ID)
      ctx.inst = { ...harnessInstall(), ...launchHarness.records!.get(ID), id: ID } as never
      expect((await handleLaunch(ctx)).ok).toBe(true)
      for (const line of opts.lines ?? []) {
        proc![opts.stream ?? 'stderr'].emit('data', Buffer.from(`[INFO] ${line}\n`))
      }
      await settle()
      proc!.emit('exit', 0, null)
      proc!.emit('close', 0, null)
      await vi.waitFor(() => expect(_runningSessions.has(ID)).toBe(false))
    }

    beforeEach(() => {
      fs.writeFileSync(agentReqPath(), CORE_FILE)
      launchHarness.schemaNames = ['enable-agent', 'listen', 'feature-flag']
      launchHarness.campaignRecords = {}
      launchHarness.recordWrites = []
      launchHarness.idClass = 'machine_derived'
      launchHarness.records = new Map([[ID, { id: ID }]])
      const spawn = launchHarness.spawn!
      launchHarness.spawn = (...args: unknown[]) => {
        proc = spawn(...args) as FakeChild
        return proc
      }
      installed = []
      pipHarness.installed = JSON.stringify([{ name: 'requests', version: '2.32.0' }])
      pipHarness.respond = (args) => {
        installed.push(fs.readFileSync(args[0] as string, 'utf-8'))
        return { code: 0, output: '' }
      }
    })

    afterEach(() => {
      launchHarness.campaigns = { registry: [], answers: new Map() }
      launchHarness.recordWriteThrows = false
      pipHarness.installed = '[]'
    })

    it('installs the overridden version the campaign applied, and reports it', async () => {
      serveCampaign({ 'comfy-agent': '0.2.3' })

      await launchAndPrint()

      expect(spawnArgs).toContain('--enable-agent')
      expect(installed).toEqual([OVERRIDDEN])
      expect(overrideEvents()).toEqual([
        expect.objectContaining({ decision: 'applied', pins: 'comfy-agent==0.2.3' })
      ])
    })

    it('applies the override for an enrolment whose record could not be saved', async () => {
      launchHarness.recordWriteThrows = true
      serveCampaign({ 'comfy-agent': '0.2.3' })

      await launchAndPrint()

      expect(spawnArgs, 'the unrecorded enrolment still starts the agent').toContain(
        '--enable-agent'
      )
      expect(installed).toEqual([OVERRIDDEN])
    })

    it('installs core file unchanged when the campaign carries no override', async () => {
      serveCampaign(undefined)

      await launchAndPrint()

      expect(installed).toEqual([CORE_FILE])
      expect(overrideEvents()).toEqual([])
    })

    it('ignores the campaign override when the user typed the flag themselves', async () => {
      serveCampaign({ 'comfy-agent': '0.2.3' })

      await launchAndPrint({ handTyped: true })

      expect(spawnArgs).toContain('--enable-agent')
      expect(installed).toEqual([CORE_FILE])
      expect(overrideEvents()).toEqual([])
    })

    it('refuses an invalid override and installs core file', async () => {
      serveCampaign({ 'comfy-agent': '0.2.3 --index-url https://evil.example/simple' })

      await launchAndPrint()

      expect(installed).toEqual([CORE_FILE])
      expect(overrideEvents()).toEqual([
        expect.objectContaining({ decision: 'refused', reason: 'bad_version' })
      ])
    })

    it('goes back to core file after two failed starts of the same version', async () => {
      serveCampaign({ 'comfy-agent': '0.2.3' })

      await launchAndPrint({ lines: ['[agent-event] health_check_failed reason=crashed'] })
      expect(overrideState()).toEqual({ signature: 'comfy-agent==0.2.3', failures: 1 })

      await launchAndPrint({ lines: ['[agent-event] agent_error reason=spawn_failed'] })
      expect(overrideEvents().at(-1)).toEqual(
        expect.objectContaining({ decision: 'reverted', reason: 'start_failed', failures: 2 })
      )

      installed = []
      await launchAndPrint()
      expect(installed).toEqual([CORE_FILE])
    })

    it('reads the agent lines core logs to stdout too', async () => {
      serveCampaign({ 'comfy-agent': '0.2.3' })

      await launchAndPrint({
        lines: ['[agent-event] health_check_failed reason=crashed'],
        stream: 'stdout'
      })

      expect(overrideState()).toEqual({ signature: 'comfy-agent==0.2.3', failures: 1 })
    })

    it('does not count an agent that exits during a slow start', async () => {
      serveCampaign({ 'comfy-agent': '0.2.3' })

      for (let i = 0; i < 3; i++) {
        await launchAndPrint({
          lines: [
            '[agent-event] agent_starting agent_version=0.2.3',
            '[agent-event] agent_waiting duration_ms=60000',
            '[agent-event] agent_exited code=0'
          ]
        })
      }

      expect(overrideState()).toBeUndefined()
      expect(installed.at(-1)).toBe(OVERRIDDEN)
    })

    it('counts no start failure against an override that did not go in', async () => {
      fs.writeFileSync(agentReqPath(), 'comfy-agent\ncomfy-cli==1.21.0\n')
      serveCampaign({ 'comfy-agent': '0.2.3' })

      await launchAndPrint({ lines: ['[agent-event] agent_error reason=spawn_failed'] })

      expect(overrideEvents()).toEqual([
        expect.objectContaining({ decision: 'refused', reason: 'unsupported_line' })
      ])
      expect(overrideState()).toBeUndefined()
    })
  })
})

describe('agent install status strings', () => {
  // `t()` resolves nothing under vitest (i18n is never initialised and its
  // locales dir does not exist in the source tree), so the lookup itself cannot
  // be exercised here. What can break silently is the contract between the
  // mapper's keys and the locale file, which is what this pins. Cross-locale
  // parity is covered separately by the locale-coverage suite.
  const strings = (en as { launch: { agentRequirements?: Record<string, string> } }).launch
    .agentRequirements

  it('defines every key the mapper asks for', () => {
    expect(Object.keys(strings ?? {}).sort()).toEqual(['downloading', 'failed', 'installing'])
  })

  it('gives the download caption both placeholders the mapper passes', () => {
    expect(strings?.downloading).toContain('{name}')
    expect(strings?.downloading).toContain('{size}')
  })
})

describe('launchedCoreCommit', () => {
  const RECORDED = '61E5E3B5A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4'
  const LIVE = 'AB'.repeat(20)
  const inst = { comfyVersion: { commit: RECORDED } } as unknown as InstallationRecord

  it('names the live HEAD over the record', () => {
    expect(launchedCoreCommit(inst, { kind: 'head', commit: LIVE })).toBe(LIVE.toLowerCase())
  })

  it("falls back to the record's commit on a not-git install", () => {
    expect(launchedCoreCommit(inst, { kind: 'not-git' })).toBe(RECORDED.toLowerCase())
    expect(launchedCoreCommit({} as InstallationRecord, { kind: 'not-git' })).toBeNull()
  })

  it.each([
    ['a short ref', 'abc123'],
    ['a symbolic ref', 'ref: refs/heads/master'],
    ['oversized garbage', 'f'.repeat(4096)]
  ])('names nothing for a HEAD holding %s rather than a full SHA', (_label, commit) => {
    expect(launchedCoreCommit(inst, { kind: 'head', commit })).toBeNull()
  })

  it('names nothing for a git checkout whose HEAD would not read', () => {
    expect(
      launchedCoreCommit(inst, { kind: 'unreadable' }),
      'the record may be what went stale'
    ).toBeNull()
  })
})

describe('prior ComfyUI process handling at launch', () => {
  const PORT = 48300
  let installDir = ''
  let events: { event: string; properties?: Record<string, unknown> }[] = []
  let children: FakeChild[] = []

  const install = (): InstallationRecord =>
    ({
      id: 'prior-inst',
      name: 'Prior',
      sourceId: 'harness-source',
      installPath: installDir,
      version: '0.3.81',
      comfyVersion: {
        commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        baseTag: 'v0.3.81',
        commitsAhead: 0,
        baseTagVerified: true
      }
    }) as unknown as InstallationRecord

  const ctxFor = (
    installationId: string,
    actionData: Record<string, unknown> = {}
  ): ActionContext => ({
    event: {
      sender: { isDestroyed: () => false, send: () => {} }
    } as unknown as Electron.IpcMainInvokeEvent,
    installationId,
    inst: install(),
    actionData
  })

  function fakeChild(): FakeChild {
    const proc = new EventEmitter() as FakeChild
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 4343
    proc.killed = false
    proc.kill = () => true
    return proc
  }

  const setArgs = (...extra: string[]): void => {
    launchHarness.launchCommand = {
      cmd: process.execPath,
      args: ['-s', path.join(installDir, 'ComfyUI', 'main.py'), '--listen', ...extra],
      cwd: installDir,
      skipPortWait: false,
      port: PORT
    }
  }

  const eventsNamed = (name: string): Array<Record<string, unknown> | undefined> =>
    events.filter((e) => e.event === name).map((e) => e.properties)

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prior-process-launch-'))
    fs.mkdirSync(path.join(installDir, 'ComfyUI'), { recursive: true })
    events = []
    children = []
    launchHarness.schemaThrows = false
    launchHarness.registryThrows = false
    launchHarness.betaEnabled = false
    launchHarness.betaEnabledThrows = false
    launchHarness.schemaNames = ['enable-assets', 'listen', 'port']
    launchHarness.grants = []
    launchHarness.duringResourceAcquire = null
    // Never the real probes here: whatever else holds a port on the machine would decide the
    // outcome.
    launchHarness.busyPorts = []
    launchHarness.busyPids = [31337]
    launchHarness.portLockPid = null
    launchHarness.portFreeWaits = []
    launchHarness.killExits = true
    launchHarness.waitForPort = async () => {}
    launchHarness.spawn = () => {
      const child = fakeChild()
      children.push(child)
      return child
    }
    ownership.prior = null
    ownership.priorCalls = []
    ownership.priorThrows = false
    ownership.onResolve = null
    ownership.holderIsInstall = false
    ownership.tracked = []
    setArgs('--enable-assets')
    const record = ((event: string, properties?: Record<string, unknown>) => {
      events.push({ event, properties })
    }) as unknown
    vi.spyOn(telemetry, 'emit').mockImplementation(record as typeof telemetry.emit)
    vi.spyOn(telemetry, 'capture').mockImplementation(record as typeof telemetry.capture)
  })

  afterEach(() => {
    for (const id of [..._runningSessions.keys()]) _runningSessions.delete(id)
    _pendingPorts.clear()
    launchHarness.busyPorts = null
    launchHarness.killExits = true
    vi.restoreAllMocks()
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  const terminated = {
    action: 'terminated',
    proof: 'desktop_record',
    pid: 777,
    port: PORT,
    ageMs: 60_000,
    waitMs: 40,
    exitedInTime: true,
    blocked: null
  }

  it('records every spawn under the session key, joined to the boot id', async () => {
    const res = await handleLaunch(ctxFor('prior-records'))

    expect(res.ok).toBe(true)
    expect(ownership.priorCalls).toEqual([
      { sessionKey: 'prior-records', opts: expect.objectContaining({ stopBusy: false }) }
    ])
    expect(ownership.tracked).toHaveLength(1)
    const [started] = eventsNamed('comfy.desktop.comfyui.boot_started')
    expect(ownership.tracked[0]).toMatchObject({
      sessionKey: 'prior-records',
      installationId: 'prior-records',
      installPath: installDir,
      port: PORT,
      bootId: started?.boot_id
    })
    expect(started?.port_bumped_from).toBeNull()
    expect(eventsNamed('comfy.desktop.comfyui.prior_process_found')).toHaveLength(0)
  })

  it('reports a terminated orphan and launches on the port it freed', async () => {
    ownership.prior = terminated

    const res = await handleLaunch(ctxFor('prior-terminated'))

    expect(res.ok).toBe(true)
    expect(res.port).toBe(PORT)
    expect(eventsNamed('comfy.desktop.comfyui.prior_process_found')).toEqual([
      {
        installation_id: 'prior-terminated',
        action: 'terminated',
        proof: 'desktop_record',
        age_ms: 60_000,
        wait_ms: 40,
        exited_in_time: true,
        busy_override: false,
        lingering_count: 0,
        queue_unknown: false
      }
    ])
  })

  it('waits for a stopped orphan to release its port instead of moving to the next one', async () => {
    ownership.prior = terminated
    // Still bound for a moment after the process exited (Windows socket teardown).
    launchHarness.busyPorts = [PORT]

    const res = await handleLaunch(ctxFor('prior-port-lingers'))

    expect(launchHarness.portFreeWaits).toEqual([PORT])
    expect(res.ok).toBe(true)
    expect(res.port).toBe(PORT)
    const [started] = eventsNamed('comfy.desktop.comfyui.boot_started')
    expect(started).toMatchObject({ port: PORT, port_bumped_from: null })
  })

  it('does not wait on the port of a process that is still there', async () => {
    ownership.prior = { ...terminated, action: 'left', exitedInTime: false }

    await handleLaunch(ctxFor('prior-left-no-wait'))

    expect(launchHarness.portFreeWaits).toEqual([])
  })

  it('names the process holding the port, not only the recorded launcher, when refusing', async () => {
    ownership.prior = { ...terminated, pid: 11944, exitedInTime: false, blocked: 'stuck' }
    launchHarness.busyPorts = [PORT]
    launchHarness.busyPids = [17348]
    const t = vi.spyOn(i18nModule, 't')

    await handleLaunch(ctxFor('prior-stuck-holder'))

    expect(t).toHaveBeenCalledWith('errors.priorProcessStuck', { pid: '11944, 17348' })
  })

  it('leaves a busy orphan alone and hands the choice to the user without spawning', async () => {
    ownership.prior = {
      ...terminated,
      action: 'busy_left',
      exitedInTime: false,
      blocked: 'busy',
      queue: { running: 1, pending: 2 }
    }

    const res = await handleLaunch(ctxFor('prior-busy'))

    expect(res.ok).toBe(false)
    expect(res.portConflict).toEqual({ port: PORT, pids: [777], isComfy: true, priorBusy: true })
    expect(children).toHaveLength(0)
    expect(_operationAborts.has('prior-busy')).toBe(false)
    expect(eventsNamed('comfy.desktop.comfyui.prior_process_found')[0]).toMatchObject({
      action: 'busy_left'
    })
  })

  it('asks the user about an orphan that never answered, with its own message', async () => {
    ownership.prior = {
      ...terminated,
      action: 'busy_left',
      exitedInTime: false,
      blocked: 'busy',
      queueUnknown: true
    }

    const res = await handleLaunch(ctxFor('prior-unknown'))

    expect(res.ok).toBe(false)
    expect(res.message).toBe('errors.priorProcessUnresponsive')
    expect(res.portConflict).toEqual({
      port: PORT,
      pids: [777],
      isComfy: true,
      priorBusy: true,
      priorUnknown: true
    })
    expect(children).toHaveLength(0)
    expect(eventsNamed('comfy.desktop.comfyui.prior_process_found')[0]).toMatchObject({
      action: 'busy_left',
      queue_unknown: true
    })
  })

  it('reports a cancel during the busy check as cancelled, whatever the check found', async () => {
    ownership.prior = { ...terminated, action: 'busy_left', exitedInTime: false, blocked: 'busy' }
    ownership.onResolve = () => _operationAborts.get('prior-cancel-during-probe')?.abort()
    const res = await handleLaunch(ctxFor('prior-cancel-during-probe'))

    expect(res).toMatchObject({ ok: false, cancelled: true })
    expect(children).toHaveLength(0)
  })

  it('names the survivors when they serve no port, with their own prompt', async () => {
    ownership.prior = {
      ...terminated,
      action: 'busy_left',
      exitedInTime: false,
      blocked: 'busy',
      queueUnknown: true,
      survivorPids: [555, 556]
    }

    const res = await handleLaunch(ctxFor('prior-survivors'))

    expect(res.message).toBe('errors.priorSurvivorsRunning')
    expect(res.portConflict).toEqual({
      port: PORT,
      pids: [555, 556],
      isComfy: true,
      priorBusy: true,
      priorUnknown: true,
      priorSurvivors: true
    })
  })

  it('passes the user choice to stop a busy orphan through to the check', async () => {
    await handleLaunch(ctxFor('prior-stop-busy', { stopBusyPriorProcess: true }))

    expect(ownership.priorCalls[0]?.opts).toMatchObject({ stopBusy: true })
  })

  it('refuses to launch beside an orphan that outlived the kill', async () => {
    ownership.prior = { ...terminated, exitedInTime: false, blocked: 'stuck' }

    const res = await handleLaunch(ctxFor('prior-stuck'))

    expect(res.ok).toBe(false)
    expect(res.message).toBe('errors.priorProcessStuck')
    expect(res.portConflict).toBeUndefined()
    expect(children).toHaveLength(0)
  })

  it('refuses to launch beside an orphan it could not re-verify', async () => {
    ownership.prior = { ...terminated, action: 'left', exitedInTime: false, blocked: 'unverified' }

    const res = await handleLaunch(ctxFor('prior-unverified'))

    expect(res.ok).toBe(false)
    expect(res.message).toBe('errors.priorProcessUnverified')
    expect(children).toHaveLength(0)
  })

  it('names only the port holder when an owed exit scan blocks the launch', async () => {
    // The recorded child is long gone; telling the user to end it would be impossible.
    ownership.prior = {
      ...terminated,
      action: 'left',
      exitedInTime: false,
      blocked: 'unverified',
      scanOwed: true
    }

    const res = await handleLaunch(ctxFor('prior-scan-owed'))

    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/^errors\.priorScanUnavailable(Pid)?$/)
    expect(children).toHaveLength(0)
  })

  it('says to try again later when an owed scan blocks right after the exit', async () => {
    ownership.prior = {
      ...terminated,
      action: 'left',
      exitedInTime: false,
      blocked: 'unverified',
      scanOwed: true,
      scanRecent: true
    }

    const res = await handleLaunch(ctxFor('prior-scan-recent'))

    expect(res.ok).toBe(false)
    expect(res.message).toBe('errors.priorScanRecent')
    expect(children).toHaveLength(0)
  })

  it('reports a left process once, even when it is also the port holder', async () => {
    ownership.prior = { ...terminated, action: 'left', exitedInTime: false, blocked: null }
    launchHarness.busyPorts = [PORT]
    ownership.holderIsInstall = true

    const res = await handleLaunch(ctxFor('prior-left-holder'))

    expect(res.portConflict).toEqual({ port: PORT, pids: [31337], isComfy: true })
    expect(eventsNamed('comfy.desktop.comfyui.prior_process_found')).toHaveLength(1)
  })

  it('launches as before when the check itself fails', async () => {
    ownership.priorThrows = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await handleLaunch(ctxFor('prior-throws'))

    expect(res.ok).toBe(true)
    expect(children).toHaveLength(1)
  })

  it('does not bump past its own install when assets make a second copy fatal', async () => {
    launchHarness.busyPorts = [PORT]
    ownership.holderIsInstall = true

    const res = await handleLaunch(ctxFor('prior-same-install'))

    expect(res.ok).toBe(false)
    expect(res.portConflict).toEqual({ port: PORT, pids: [31337], isComfy: true })
    expect(res.message).toBe('errors.portConflictSameInstall')
    expect(children).toHaveLength(0)
    expect(eventsNamed('comfy.desktop.comfyui.prior_process_found')).toEqual([
      expect.objectContaining({ action: 'left', proof: 'none', age_ms: null })
    ])
  })

  it("recognises this install's ComfyUI from a port lock when no listener can be listed", async () => {
    // lsof sees nothing (another user's or another namespace's process); the lock still names it.
    launchHarness.busyPorts = [PORT]
    launchHarness.busyPids = []
    launchHarness.portLockPid = 40003
    ownership.holderIsInstall = (pid) => pid === 40003

    const res = await handleLaunch(ctxFor('prior-port-lock'))

    expect(res.ok).toBe(false)
    expect(res.message).toBe('errors.portConflictSameInstall')
    expect(res.portConflict).not.toHaveProperty('nextPort')
    expect(children).toHaveLength(0)
  })

  it("finds this install's ComfyUI among several listeners on the port", async () => {
    launchHarness.busyPorts = [PORT]
    launchHarness.busyPids = [40001, 40002]
    ownership.holderIsInstall = (pid) => pid === 40002

    const res = await handleLaunch(ctxFor('prior-second-listener'))

    expect(res.ok).toBe(false)
    expect(res.portConflict).toEqual({ port: PORT, pids: [40001, 40002], isComfy: true })
    expect(children).toHaveLength(0)
  })

  it('does not offer the next port with an explicit --port when the holder is this install', async () => {
    setArgs('--enable-assets', '--port', String(PORT))
    launchHarness.launchCommand = { ...launchHarness.launchCommand!, port: PORT }
    launchHarness.busyPorts = [PORT]
    ownership.holderIsInstall = true

    const res = await handleLaunch({
      ...ctxFor('prior-explicit-port'),
      inst: { ...install(), launchArgs: `--enable-assets --port ${PORT}` } as InstallationRecord
    })

    expect(res.ok).toBe(false)
    expect(res.message).toBe('errors.portConflictSameInstall')
    expect(res.portConflict).toEqual({ port: PORT, pids: [31337], isComfy: true })
    expect(children).toHaveLength(0)
  })

  it.each([
    ['assets are off', [], {}, true],
    ['the holder is not this install', ['--enable-assets'], {}, false],
    ['the caller asked for a bump', ['--enable-assets'], { autoPortOnConflict: true }, true]
  ] as const)('bumps as before when %s', async (_why, extra, actionData, sameInstall) => {
    setArgs(...extra)
    launchHarness.busyPorts = [PORT]
    ownership.holderIsInstall = sameInstall

    const res = await handleLaunch(ctxFor('prior-bump', { ...actionData }))

    expect(res.ok).toBe(true)
    expect(res.port).toBe(launchHarness.nextPort)
    const [started] = eventsNamed('comfy.desktop.comfyui.boot_started')
    expect(started?.port_bumped_from).toBe(PORT)
  })

  it('does not retry on top of a failed boot whose process outlived the kill', async () => {
    launchHarness.killExits = false
    launchHarness.waitForPort = async () => {
      const first = children[0]!
      first.stderr.emit('data', Buffer.from('OSError: [Errno 98] Address already in use\n'))
      first.emit('close', 1, null)
      return new Promise<void>(() => {})
    }

    const res = await handleLaunch(ctxFor('prior-kill-timeout'))

    expect(res.ok).toBe(false)
    expect(children).toHaveLength(1)
    expect(eventsNamed('comfy.desktop.comfyui.boot_failed')).toHaveLength(1)
  })

  it('does not blame the database lock when assets are off (ComfyUI only logs it then)', async () => {
    setArgs()
    launchHarness.waitForPort = async () => {
      const first = children[0]!
      first.stderr.emit(
        'data',
        Buffer.from(
          'Database is locked. Another ComfyUI process is already using this database.\n' +
            'Traceback (most recent call last):\nRuntimeError: CUDA error\n'
        )
      )
      first.emit('close', 1, null)
      return new Promise<void>(() => {})
    }

    const res = await handleLaunch(ctxFor('prior-lock-no-assets'))

    expect(res.ok).toBe(false)
    expect(res.message).not.toBe('errors.comfyDbLocked')
    const [failed] = eventsNamed('comfy.desktop.comfyui.boot_failed')
    expect(failed?.error_class).not.toBe('comfyui_db_locked')
  })

  it('classifies a database-lock boot failure regardless of the last traceback', async () => {
    launchHarness.waitForPort = async () => {
      const first = children[0]!
      first.stderr.emit(
        'data',
        Buffer.from(
          'Database is locked. Another ComfyUI process is already using this database.\n' +
            'Traceback (most recent call last):\nImportError: custom node noise\n'
        )
      )
      first.emit('close', 1, null)
      return new Promise<void>(() => {})
    }

    const res = await handleLaunch(ctxFor('prior-db-locked'))

    expect(res.ok).toBe(false)
    // The lock, not "Process exited with code 1".
    expect(res.message).toBe('errors.comfyDbLocked')
    await vi.waitFor(() =>
      expect(eventsNamed('comfy.desktop.comfyui.boot_failed')).toEqual([
        expect.objectContaining({
          error_class: 'comfyui_db_locked',
          lock_holder_pid: null,
          lock_holder_source: 'unknown',
          lock_holder_same_install: null,
          lock_holder_name: null,
          lock_holder_runs_main_py: null,
          lock_holder_age_s: null
        })
      ])
    )
  })
})

describe('describePriorOutcome', () => {
  const base = {
    proof: 'desktop_record' as const,
    pid: 11944,
    port: 8188,
    ageMs: 1,
    waitMs: 1,
    blocked: null
  }
  it('names the survivors, not the dead child, in the log', () => {
    expect(
      describePriorOutcome({
        ...base,
        action: 'busy_left',
        exitedInTime: false,
        blocked: 'busy',
        queueUnknown: true,
        survivorPids: [555, 556]
      })
    ).toBe(
      "processes left by an earlier ComfyUI (pids 555, 556, proof desktop_record): left running: they do not answer on this installation's port, so whether they are working cannot be asked; launch refused (unknown)"
    )
    expect(
      describePriorOutcome({
        ...base,
        action: 'terminated',
        exitedInTime: true,
        lingering: 2,
        survivorPids: [555, 556]
      })
    ).toBe(
      'processes left by an earlier ComfyUI (pids 555, 556, proof desktop_record): stopped, and they exited'
    )
  })

  it.each([
    [{ action: 'terminated', exitedInTime: true }, 'stopped, and it exited'],
    [
      { action: 'terminated', exitedInTime: false, blocked: 'stuck' },
      'stopped, but it did not exit; launch refused (stuck)'
    ],
    [
      { action: 'left', exitedInTime: false, blocked: 'unverified' },
      'left running: not proven to be ours; launch refused (unverified)'
    ],
    [{ action: 'waited', exitedInTime: true }, 'it exited on its own'],
    [
      { action: 'busy_left', exitedInTime: false, blocked: 'busy', queueUnknown: true },
      'left running: it did not answer whether it is working on a prompt; launch refused (unknown)'
    ],
    [
      { action: 'terminated', exitedInTime: true, lingering: 2 },
      'stopped, and it exited; 2 surviving subprocess(es) stopped'
    ]
  ] as const)('%o', (outcome, text) => {
    expect(describePriorOutcome({ ...base, ...outcome })).toBe(
      `earlier ComfyUI (pid 11944, port 8188, proof desktop_record): ${text}`
    )
  })
})

describe('describeLockHolder', () => {
  it('names what the probe found', () => {
    expect(
      describeLockHolder({
        pid: 13708,
        source: 'restart_manager',
        sameInstall: true,
        name: 'python',
        runsMainPy: true,
        ageS: 192
      })
    ).toBe(
      'holder pid 13708, source restart_manager, same install true, name python, runs main.py true, running 192s'
    )
  })

  it('says so when nothing was found', () => {
    expect(describeLockHolder(null)).toBe('holder not identified')
  })
})
