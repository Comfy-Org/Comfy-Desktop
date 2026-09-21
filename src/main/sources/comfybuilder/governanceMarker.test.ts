// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const root = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return mkdtempSync(join(tmpdir(), 'cb-marker-'))
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

const lib = vi.hoisted(() => ({
  installArtifact: vi.fn(),
  stageModels: vi.fn(async () => {}),
  resolveModelManifest: vi.fn(async () => ({ models: [] }))
}))
vi.mock('../../comfybuilder', async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyBuilderModule>()
  return { ...actual, ...lib }
})

const store = vi.hoisted(() => ({
  update: vi.fn<(id: string, data: Record<string, unknown>) => Promise<null>>(async () => null)
}))
vi.mock('../../installations', () => ({ update: store.update }))

vi.mock('../../devplatform/session', () => ({ getBuilderClient: () => ({}) }))

vi.mock('../../lib/comfyDownloadManager', () => ({
  releaseParkedModelJobsUnder: vi.fn(),
  acquireModelDownloadRootLock: vi.fn(() => () => {}),
  startManagedModelJob: vi.fn(),
  cancelModelDownload: vi.fn()
}))

import { comfybuilder } from './index'
import type * as ComfyBuilderModule from '../../comfybuilder'
import { GOVERNANCE_MARKER_FIELD } from '../../comfybuilder'
import type { GovernanceMarker } from '../../comfybuilder'
import type { InstallationRecord } from '../../installations'

const MARKER: GovernanceMarker = {
  governanceMarkerVersion: 1,
  governed: true,
  expectedBuildIdentity: 'build-1|release-1|artifact-1|linux/cpu/cpu|sha256:beef',
  publicKey: Buffer.alloc(32, 9).toString('base64url'),
  activeForms: ['customNode', 'model'],
  customNodeMode: 'allowlist'
}

let counter = 0

function makeRecord(): InstallationRecord {
  const id = `marker-inst-${++counter}`
  const installPath = path.join(root, id)
  fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
  return {
    id,
    name: id,
    createdAt: new Date().toISOString(),
    installPath,
    sourceId: 'comfybuilder',
    distributionId: 'dist-1',
    version: '1',
    artifactId: 'a1',
    artifactOs: 'linux',
    artifactGpu: 'cpu',
    artifactAccelVariant: 'cpu',
    artifactSha256: 'a'.repeat(64)
  } as InstallationRecord
}

const tools = { sendProgress: vi.fn(), signal: undefined }

/** Stand in for a real extraction: `makeRecord` leaves an existing `ComfyUI/`
 *  behind, so the install takes the entry-swap path and the swap needs a
 *  populated staging tree to move into place. */
function extractInto(installPath: string): void {
  fs.mkdirSync(path.join(installPath, 'venv'), { recursive: true })
  fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
  fs.writeFileSync(path.join(installPath, 'venv', 'pyvenv.cfg'), 'home = /usr')
  fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), 'code')
}

beforeEach(() => {
  lib.installArtifact.mockImplementation(async ({ installPath }: { installPath: string }) => {
    extractInto(installPath)
    return { governance: MARKER }
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('comfybuilder install persists the governance marker', () => {
  it('writes the marker returned by installArtifact in a single record update', async () => {
    const record = makeRecord()

    await comfybuilder.install!(record, tools as never)

    const markerWrites = store.update.mock.calls.filter(
      (call) => (call[1] as Record<string, unknown>)[GOVERNANCE_MARKER_FIELD] !== undefined
    )
    expect(markerWrites).toHaveLength(1)
    expect(markerWrites[0]![0]).toBe(record.id)
    expect(markerWrites[0]![1]).toEqual({ [GOVERNANCE_MARKER_FIELD]: MARKER })
  })

  it('clears any stale marker when the newly installed archive is not governed', async () => {
    lib.installArtifact.mockImplementation(async ({ installPath }: { installPath: string }) => {
      extractInto(installPath)
      return { governance: null }
    })
    const record = makeRecord()

    await comfybuilder.install!(record, tools as never)

    expect(store.update).toHaveBeenCalledWith(record.id, {
      [GOVERNANCE_MARKER_FIELD]: undefined
    })
  })

  it('never writes a marker when the archive install itself fails', async () => {
    lib.installArtifact.mockRejectedValue(new Error('Artifact checksum mismatch'))
    const record = makeRecord()

    await expect(comfybuilder.install!(record, tools as never)).rejects.toThrow(/checksum mismatch/)

    expect(store.update).not.toHaveBeenCalled()
  })
})

describe('environmentPaths policy location', () => {
  it('resolves the signed policy under the install ComfyUI tree', async () => {
    const { GOVERNANCE_POLICY_RELATIVE, governancePolicyPath } = await import('../../comfybuilder')
    expect(governancePolicyPath(os.tmpdir())).toBe(
      path.join(os.tmpdir(), GOVERNANCE_POLICY_RELATIVE)
    )
    expect(GOVERNANCE_POLICY_RELATIVE).toBe(
      path.join('ComfyUI', 'governance', 'policy.signed.json')
    )
  })
})
