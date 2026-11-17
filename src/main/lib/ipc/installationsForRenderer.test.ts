import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import os from 'os'
import type { InstallationRecord } from '../../installations'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  session: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../i18n', () => ({
  t: (key: string) => key,
  init: vi.fn(),
  getMessages: () => ({}),
  getLocale: () => 'en',
  getAvailableLocales: () => []
}))

vi.mock('../../settings', () => ({
  get: vi.fn(() => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: { modelsDirs: ['/unused'], inputDir: '/unused', outputDir: '/unused' }
}))

vi.mock('../../installations', () => ({
  installationEvents: new EventEmitter(),
  CLOUD_SOURCE_ID: 'cloud',
  list: vi.fn(async () => []),
  get: vi.fn(async () => null),
  update: vi.fn(async () => null),
  remove: vi.fn(async () => {})
}))

import { enrichInstallationsForRenderer } from './registerInstallationHandlers'

function installation(id: string, sourceId: string): InstallationRecord {
  return {
    id,
    name: id,
    sourceId,
    installPath: `/installs/${id}`,
    status: 'installed',
    createdAt: '2026-11-01T00:00:00Z'
  }
}

describe('enrichInstallationsForRenderer', () => {
  it('tells the page which builds save to an output folder Desktop can list', () => {
    const { enriched } = enrichInstallationsForRenderer([
      installation('standalone', 'standalone'),
      installation('from-a-build', 'comfybuilder'),
      installation('old-desktop', 'desktop'),
      installation('cloud', 'cloud'),
      installation('server', 'remote')
    ])

    expect(Object.fromEntries(enriched.map((inst) => [inst.id, inst.hasOutputFolder]))).toEqual({
      standalone: true,
      'from-a-build': true,
      'old-desktop': false,
      cloud: false,
      server: false
    })
  })
})
