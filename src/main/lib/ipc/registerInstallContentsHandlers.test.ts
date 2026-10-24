import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  enabled: true,
  installs: new Map<string, Record<string, unknown>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn)
  },
  app: { getPath: () => '/tmp', isPackaged: false }
}))
vi.mock('../../settings', () => ({
  isRolloutEnabled: () => h.enabled,
  get: () => undefined,
  defaults: { modelsDirs: [], inputDir: '/shared/input', outputDir: '/shared/output' }
}))
vi.mock('../../installations', () => ({ get: async (id: string) => h.installs.get(id) ?? null }))
vi.mock('./shared', () => ({
  sourceMap: {
    standalone: { category: 'local', getLaunchCommand: () => null },
    cloud: { category: 'cloud', getLaunchCommand: () => null },
    remote: { category: 'remote', getLaunchCommand: () => null }
  }
}))
vi.mock('../installContents/workflows', () => ({
  listLocalWorkflows: vi.fn(async (dir: string) => ({
    ok: true,
    items: [dir],
    nextCursor: null,
    total: 1,
    truncated: false
  })),
  listCloudWorkflows: vi.fn(async () => ({
    ok: true,
    items: ['cloud'],
    nextCursor: null,
    total: 1,
    truncated: false
  }))
}))

import { listCloudWorkflows } from '../installContents/workflows'
import { registerInstallContentsHandlers } from './registerInstallContentsHandlers'

registerInstallContentsHandlers()
const listWorkflows = (id: unknown, request?: unknown) =>
  h.handlers.get('install-contents:list-workflows')!({}, id, request)

beforeEach(() => {
  h.enabled = true
  h.installs.clear()
  h.installs.set('local', { id: 'local', sourceId: 'standalone', installPath: '/installs/a' })
  h.installs.set('cloud', { id: 'cloud', sourceId: 'cloud', installPath: '' })
  h.installs.set('remote', { id: 'remote', sourceId: 'remote', installPath: '' })
})

describe('install-contents handlers', () => {
  it('refuse every request while the Builds dashboard is off', async () => {
    h.enabled = false
    expect(await listWorkflows('local')).toMatchObject({ ok: false })
  })

  it('refuse malformed input and unknown builds', async () => {
    expect(await listWorkflows(42)).toMatchObject({ ok: false })
    expect(await listWorkflows('local', { sort: 'size' })).toMatchObject({ ok: false })
    expect(await listWorkflows('gone')).toMatchObject({ ok: false })
  })

  it('read a local build from its resolved folders and Comfy Cloud from its API', async () => {
    const local = (await listWorkflows('local')) as { items: string[] }
    expect(local.items[0]).toMatch(/user[\\/]default[\\/]workflows$/)
    expect(await listWorkflows('cloud')).toMatchObject({ items: ['cloud'] })
  })

  it('report a listing that throws as unreadable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(listCloudWorkflows).mockRejectedValueOnce(new Error('EACCES'))
    expect(await listWorkflows('cloud')).toMatchObject({
      ok: false,
      message: 'installContents.readError'
    })
  })

  it('list nothing for a remote build', async () => {
    expect(await listWorkflows('remote')).toMatchObject({ ok: true, items: [], total: 0 })
  })
})
