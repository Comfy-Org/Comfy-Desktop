// @vitest-environment node
import { EventEmitter } from 'node:events'
import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { root, priorXdgDataHome } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'launch-governance-'))
  const priorXdgDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = join(root, 'xdg-data')
  return { root, priorXdgDataHome }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => path.join(root, 'userData'),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

// Only the spawn is replaced; the rest of the launch pipeline stays real so
// "did not launch" is observed at the actual process boundary rather than at a
// stub standing in for it.
const spawned = vi.hoisted(() => ({ spawnProcess: vi.fn() }))
vi.mock('../../process', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessModule>()
  return { ...actual, spawnProcess: spawned.spawnProcess }
})

import { handleLaunch } from './launch'
import type * as ProcessModule from '../../process'
import type { ActionContext } from './types'
import { sourceMap, _removeSession, _runningSessions } from '../shared'
import type { ChildProcess, InstallationRecord } from '../shared'
import type { LaunchCommand, SourcePlugin } from '../../../types/sources'
import { GOVERNANCE_MARKER_FIELD, governancePolicyPath } from '../../../comfybuilder/governance'

const DOMAIN_SEPARATOR = Buffer.from('comfyui-governance-v1\0', 'utf-8')
const BUILD_IDENTITY = 'build-1|release-1|artifact-1|linux/nvidia/cu124|sha256:feed'
const SOURCE_ID = 'governance-test-source'

interface Signer {
  readonly publicKey: string
  readonly privateKey: KeyObject
}

function makeSigner(): Signer {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(12))
  return { publicKey: raw.toString('base64url'), privateKey }
}

function makeEnvelope(signer: Signer): string {
  const payloadBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      audience: 'comfyui-core',
      versionId: 'v1',
      buildIdentity: BUILD_IDENTITY,
      sourcesDigest: `sha256:${'a'.repeat(64)}`,
      policyGeneration: 1,
      activeForms: ['customNode'],
      customNodeMode: 'allowlist',
      packs: [],
      deniedPacks: [],
      disabledNodes: [],
      disabledPartnerNodes: [],
      models: []
    }),
    'utf-8'
  )
  const signature = signBytes(
    null,
    Buffer.concat([DOMAIN_SEPARATOR, payloadBytes]),
    signer.privateKey
  )
  return JSON.stringify({
    schema: 1,
    payload: payloadBytes.toString('base64url'),
    signature: signature.toString('base64url')
  })
}

function fakeChildProcess(): ChildProcess {
  const proc = new EventEmitter() as unknown as Record<string, unknown>
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = 4242
  return proc as unknown as ChildProcess
}

let counter = 0
const launched: string[] = []

/** A minimal launchable install: a real directory, an executable that exists,
 *  and `skipPortWait` so the happy path reaches an actual spawn. */
function makeInstall(overrides: Record<string, unknown> = {}): InstallationRecord {
  const id = `gov-inst-${++counter}`
  const installPath = path.join(root, id)
  fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
  launched.push(id)
  return {
    id,
    name: `Governed ${id}`,
    installPath,
    sourceId: SOURCE_ID,
    status: 'installed',
    ...overrides
  } as InstallationRecord
}

function governedRecord(
  signer: Signer,
  overrides: Record<string, unknown> = {}
): InstallationRecord {
  return makeInstall({
    [GOVERNANCE_MARKER_FIELD]: {
      governanceMarkerVersion: 1,
      governed: true,
      expectedBuildIdentity: BUILD_IDENTITY,
      publicKey: signer.publicKey,
      activeForms: ['customNode'],
      customNodeMode: 'allowlist',
      ...(overrides[GOVERNANCE_MARKER_FIELD] as object | undefined)
    },
    ...overrides
  })
}

function writePolicy(inst: InstallationRecord, envelope: string): void {
  const policy = governancePolicyPath(inst.installPath)
  fs.mkdirSync(path.dirname(policy), { recursive: true })
  fs.writeFileSync(policy, envelope)
}

function ctxFor(inst: InstallationRecord): ActionContext {
  return {
    event: {
      sender: { send: vi.fn(), isDestroyed: () => false }
    } as unknown as Electron.IpcMainInvokeEvent,
    installationId: inst.id,
    inst,
    actionData: {}
  }
}

beforeEach(() => {
  spawned.spawnProcess.mockImplementation(() => fakeChildProcess())
  sourceMap[SOURCE_ID] = {
    id: SOURCE_ID,
    category: 'local',
    getLaunchCommand: (inst: InstallationRecord): LaunchCommand =>
      ({
        // `process.execPath` always exists, so the executable-existence gate
        // after this check cannot mask a governance pass as a refusal.
        cmd: process.execPath,
        args: ['--version'],
        cwd: inst.installPath,
        skipPortWait: true
      }) as unknown as LaunchCommand
  } as unknown as SourcePlugin
})

afterEach(() => {
  for (const id of launched) {
    if (_runningSessions.has(id)) _removeSession(id)
  }
  launched.length = 0
  delete sourceMap[SOURCE_ID]
  vi.clearAllMocks()
})

afterAll(() => {
  if (priorXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = priorXdgDataHome
  fs.rmSync(root, { recursive: true, force: true })
})

describe('governed pre-launch policy check', () => {
  it('lets a governed install with a valid envelope launch', async () => {
    const signer = makeSigner()
    const inst = governedRecord(signer)
    writePolicy(inst, makeEnvelope(signer))

    const result = await handleLaunch(ctxFor(inst))

    expect(result.ok).toBe(true)
    expect(spawned.spawnProcess).toHaveBeenCalledTimes(1)
  })

  it('refuses and never spawns when the envelope was deleted', async () => {
    const signer = makeSigner()
    const inst = governedRecord(signer)

    const result = await handleLaunch(ctxFor(inst))

    // "Did not launch" is the invariant; assert it FIRST so the test cannot
    // pass on message text alone if the refusal ever stops short-circuiting.
    expect(spawned.spawnProcess).toHaveBeenCalledTimes(0)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('managed ComfyUI installation')
    expect(result.message).toContain('contact your administrator')
  })

  it('refuses and never spawns when one signature byte is flipped', async () => {
    const signer = makeSigner()
    const inst = governedRecord(signer)
    const parsed = JSON.parse(makeEnvelope(signer)) as Record<string, string>
    const signature = Buffer.from(parsed.signature!, 'base64url')
    signature[3] = signature[3]! ^ 0x01
    writePolicy(inst, JSON.stringify({ ...parsed, signature: signature.toString('base64url') }))

    const result = await handleLaunch(ctxFor(inst))

    expect(spawned.spawnProcess).toHaveBeenCalledTimes(0)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('managed ComfyUI installation')
  })

  it('refuses and never spawns when the marker itself is truncated', async () => {
    const signer = makeSigner()
    const inst = makeInstall({
      [GOVERNANCE_MARKER_FIELD]: { governanceMarkerVersion: 1, governed: true }
    })
    writePolicy(inst, makeEnvelope(signer))

    const result = await handleLaunch(ctxFor(inst))

    expect(spawned.spawnProcess).toHaveBeenCalledTimes(0)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('managed ComfyUI installation')
  })

  it('is a no-op for a non-governed install, which launches normally', async () => {
    const inst = makeInstall()

    const result = await handleLaunch(ctxFor(inst))

    expect(result.ok).toBe(true)
    expect(spawned.spawnProcess).toHaveBeenCalledTimes(1)
  })

  it('does not block a non-governed install whose tree happens to hold a policy file', async () => {
    // Presence must select nothing: only the durable marker decides.
    const signer = makeSigner()
    const inst = makeInstall()
    writePolicy(inst, 'not even valid json')

    const result = await handleLaunch(ctxFor(inst))

    expect(result.ok).toBe(true)
    expect(spawned.spawnProcess).toHaveBeenCalledTimes(1)
    expect(signer.publicKey).toBeTruthy()
  })
})
