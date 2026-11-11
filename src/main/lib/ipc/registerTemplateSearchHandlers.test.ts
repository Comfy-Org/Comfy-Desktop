import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getInstallation: vi.fn(),
  updateInstallation: vi.fn(),
  getEntryByInstallationId: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  net: { fetch: vi.fn() }
}))

vi.mock('../../installations', () => ({
  get: mocks.getInstallation,
  update: mocks.updateInstallation
}))

vi.mock('../../host/registry', () => ({
  getEntryByInstallationId: mocks.getEntryByInstallationId
}))

import { MAX_QUERY_LENGTH, registerTemplateSearchHandlers } from './registerTemplateSearchHandlers'
import type { TemplateSearchBackend } from '../../templateSearch/types'
import type { TemplateSearchResult } from '../../../types/ipc'

type IpcHandler = (event: object, ...args: unknown[]) => Promise<unknown> | unknown

function handler(channel: string): IpcHandler {
  const call = [...mocks.handle.mock.calls].reverse().find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcHandler
}

const RESULT: TemplateSearchResult = { outcome: 'agent', reply: null, run: [], download: [] }
const LOCAL = { id: 'local-1', sourceId: 'standalone' }
const REMOTE = { id: 'remote-1', sourceId: 'remote' }

function register(backend: TemplateSearchBackend): void {
  registerTemplateSearchHandlers({
    isLocalInstallation: (installation) => installation.sourceId === 'standalone',
    backend
  })
}

function backend(search = vi.fn(async () => RESULT)): TemplateSearchBackend {
  return { search }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getInstallation.mockImplementation(
    async (id: string) => [LOCAL, REMOTE].find((installation) => installation.id === id) ?? null
  )
  mocks.updateInstallation.mockResolvedValue(LOCAL)
  mocks.getEntryByInstallationId.mockReturnValue(undefined)
})

describe('template-search:search', () => {
  it('passes the trimmed request to the backend and returns its result', async () => {
    const search = vi.fn(async () => RESULT)
    register(backend(search))
    expect(await handler('template-search:search')({}, '  a poster for a bake sale  ')).toEqual({
      kind: 'result',
      result: RESULT
    })
    expect(search).toHaveBeenCalledWith('a poster for a bake sale')
  })

  it.each([
    ['an empty request', '   '],
    ['a request that is not text', 42],
    ['an overlong request', 'a'.repeat(MAX_QUERY_LENGTH + 1)]
  ])('refuses %s without asking the backend', async (_name, query) => {
    const search = vi.fn(async () => RESULT)
    register(backend(search))
    expect(await handler('template-search:search')({}, query)).toEqual({ kind: 'failed' })
    expect(search).not.toHaveBeenCalled()
  })

  it('reports a failed search instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    register(backend(vi.fn(async () => Promise.reject(new Error('timed out')))))
    expect(await handler('template-search:search')({}, 'a poster')).toEqual({ kind: 'failed' })
  })
})

describe('template-search:open', () => {
  it('queues the template for a local build that is not open, for the next launch to open', async () => {
    register(backend())
    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('launch')
    expect(mocks.updateInstallation).toHaveBeenCalledWith('local-1', {
      pendingTemplateOpen: 'poster_template'
    })
  })

  it('opens the template straight away in a build that is already open', async () => {
    const loadURL = vi.fn(async () => undefined)
    mocks.getEntryByInstallationId.mockReturnValue({
      comfyUrl: 'http://127.0.0.1:8390/',
      comfyView: { webContents: { isDestroyed: () => false, loadURL } }
    })
    register(backend())

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('opened')
    expect(loadURL).toHaveBeenCalledWith(
      'http://127.0.0.1:8390/?template=poster_template&source=default'
    )
    expect(mocks.updateInstallation).not.toHaveBeenCalled()
  })

  it.each([
    ['a build that is not local', 'remote-1', 'poster_template'],
    ['a build that does not exist', 'missing-1', 'poster_template'],
    ['a template id that could be a path', 'local-1', '../escape'],
    ['an installation id that is not text', 7, 'poster_template']
  ])('refuses %s', async (_name, installationId, templateId) => {
    register(backend())
    expect(await handler('template-search:open')({}, installationId, templateId)).toBe('refused')
    expect(mocks.updateInstallation).not.toHaveBeenCalled()
  })
})
