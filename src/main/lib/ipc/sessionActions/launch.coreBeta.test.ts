import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import type { WriteStream } from 'fs'
import type { ComfyArgsSchema } from '../../comfy-args'
import type { CoreCanaryFlag } from '../../coreCanary'

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

const { buildLaunchArgs, emitCoreBetaRecords, emitCoreBetaTelemetry, writeLog } =
  await import('./launch')
const { makeSendOutput } = await import('../shared')
const telemetry = await import('../../telemetry')

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
