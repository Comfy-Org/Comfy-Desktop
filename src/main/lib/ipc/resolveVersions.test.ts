import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallationRecord } from '../../installations'
import type * as Installations from '../../installations'
import type * as Git from '../git'
import type { ComfyVersion } from '../version'

// Stub the electron surface ../shared touches so the test needs no runtime.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
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

vi.mock('../version-resolve', () => ({
  resolveLocalVersion: vi.fn(),
  clearVersionCache: vi.fn()
}))

vi.mock('../git', async (importOriginal) => ({
  ...(await importOriginal<typeof Git>()),
  hasGitDir: () => true,
  readGitHead: () => null,
  // No origin, so no tag fetch and no latest-tag override: the resolver mock is the only input.
  readGitRemoteUrl: () => null
}))

vi.mock('../github-mirror', () => ({ ensureRemoteUrl: vi.fn() }))

vi.mock('../../installations', async (importOriginal) => ({
  ...(await importOriginal<typeof Installations>()),
  update: vi.fn()
}))

vi.mock('./broadcast', () => ({ _broadcastToRenderer: vi.fn() }))

import { _resolveAndBroadcastVersions } from './shared'
import { resolveLocalVersion } from '../version-resolve'
import * as installations from '../../installations'
import { _broadcastToRenderer } from './broadcast'

const COMMIT = 'b0f4b7b294ce1b2c3d4e5f6a1b2c3d4e5f6a1b2c'

function install(comfyVersion: ComfyVersion): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'ComfyUI',
    createdAt: '2026-01-01T00:00:00.000Z',
    installPath: '/tmp/comfy',
    sourceId: 'standalone',
    comfyVersion
  }
}

// The persist decision compares formatted version strings, which ignore provenance. These pin the
// terms that catch a provenance-only change: without them a record written before a field existed
// keeps its absence forever, and the beta-grant gate reads that absence as a refusal.
describe('_resolveAndBroadcastVersions provenance-only changes', () => {
  beforeEach(() => {
    vi.mocked(resolveLocalVersion).mockReset()
    vi.mocked(installations.update).mockReset()
    vi.mocked(_broadcastToRenderer).mockReset()
  })

  it('persists a record that gains ancestorTag with nothing else changed', async () => {
    const stored: ComfyVersion = {
      commit: COMMIT,
      baseTag: 'v0.37.1',
      commitsAhead: 5,
      baseTagVerified: false
    }
    const resolved: ComfyVersion = { ...stored, ancestorTag: 'v0.37.0' }
    vi.mocked(resolveLocalVersion).mockResolvedValue(resolved)

    await _resolveAndBroadcastVersions([install(stored)])

    expect(installations.update).toHaveBeenCalledWith('inst-1', { comfyVersion: resolved })
    expect(_broadcastToRenderer).toHaveBeenCalledWith('installations-versions-updated', {
      updates: [{ id: 'inst-1', version: 'v0.37.1+5' }]
    })
  })

  it('persists a record that gains baseTagVerified with nothing else changed', async () => {
    const stored: ComfyVersion = { commit: COMMIT, baseTag: 'v0.37.0', commitsAhead: 5 }
    const resolved: ComfyVersion = { ...stored, baseTagVerified: true }
    vi.mocked(resolveLocalVersion).mockResolvedValue(resolved)

    await _resolveAndBroadcastVersions([install(stored)])

    expect(installations.update).toHaveBeenCalledWith('inst-1', { comfyVersion: resolved })
  })

  it('writes nothing when the resolved record is identical', async () => {
    // Negative control: proves the two cases above persist because of the provenance term, not
    // because this harness makes every resolve look like a change.
    const stored: ComfyVersion = {
      commit: COMMIT,
      baseTag: 'v0.37.1',
      commitsAhead: 5,
      baseTagVerified: false,
      ancestorTag: 'v0.37.0'
    }
    vi.mocked(resolveLocalVersion).mockResolvedValue({ ...stored })

    await _resolveAndBroadcastVersions([install(stored)])

    expect(resolveLocalVersion).toHaveBeenCalled()
    expect(installations.update).not.toHaveBeenCalled()
    expect(_broadcastToRenderer).not.toHaveBeenCalled()
  })
})
