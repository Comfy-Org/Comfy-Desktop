import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  open: vi.fn(),
  listed: vi.fn(),
  subject: null as string | null,
  workspaceId: null as string | null,
  listWorkspaces: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('../apps/openInComfy', () => ({ openCatalogInComfy: mocks.open }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    status: () => ({ signedIn: mocks.subject !== null, workspaceId: mocks.workspaceId }),
    currentSubject: () => mocks.subject,
    listWorkspaces: mocks.listWorkspaces
  })
}))
vi.mock('../lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('./workflows', () => ({ listedWorkflow: mocks.listed }))

import { launchCatalogWorkflow } from './launchWorkflow'

const PAGE = { isDestroyed: () => false } as WebContents
const URL = 'https://cloud.comfy.org/api/v1/catalog/media/graph/version'
const PROMPT = { '1': { class_type: 'SaveImage', inputs: {} } }
const GRAPH = { nodes: [{ id: 1, type: 'SaveImage' }], links: [] }
const LOCAL = { where: 'local', build: 'inst-local' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.subject = null
  mocks.workspaceId = null
  mocks.listWorkspaces.mockResolvedValue([])
  mocks.listed.mockImplementation((id) =>
    id === 'catalog-id'
      ? {
          card: {
            title: 'Example',
            canOpenLocal: true,
            canOpenCloud: true,
            minComfyUIVersion: '0.3.66'
          },
          editorGraphUrl: URL,
          cloudPrompt: PROMPT
        }
      : undefined
  )
  mocks.fetch.mockImplementation(async () => Response.json(GRAPH))
  mocks.open.mockResolvedValue({ opened: true })
})

describe('launching workflows from the published catalog', () => {
  it('imports the catalog’s editable graph in the selected local build', async () => {
    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')).toEqual({
      opened: true
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ credentials: 'omit', redirect: 'error' })
    )
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      { ...LOCAL, name: 'Example', graph: GRAPH },
      expect.objectContaining({ workspaceId: 'personal', minComfyUIVersion: '0.3.66' })
    )
  })

  it('does not fetch or launch for an unknown id or invalid target', async () => {
    for (const [id, target] of [
      ['https://example.org', LOCAL],
      ['catalog-id', { where: 'local', build: '../build' }],
      ['catalog-id', { where: 'cloud', build: 'inst-local' }]
    ]) {
      expect(await launchCatalogWorkflow(PAGE, id, target, 'personal')).toEqual({
        opened: false,
        error: 'workflowLaunch.unavailable'
      })
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('falls back to the validated API prompt for Cloud when the graph is unavailable', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }))
    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', { where: 'cloud' }, 'personal')).toEqual(
      {
        opened: true
      }
    )
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      { where: 'cloud', name: 'Example', prompt: PROMPT },
      expect.anything()
    )
  })

  it('honors a newly selected Cloud workspace after confirming membership', async () => {
    mocks.subject = 'account'
    mocks.workspaceId = 'other'
    mocks.listWorkspaces.mockResolvedValue([{ id: 'team' }])

    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', { where: 'cloud' }, 'team')).toEqual({
      opened: true
    })
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      expect.anything(),
      expect.objectContaining({
        workspaceId: 'team'
      })
    )
  })

  it('refuses to open Cloud in a workspace the signed-in account cannot access', async () => {
    mocks.subject = 'account'
    mocks.workspaceId = 'other'

    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', { where: 'cloud' }, 'unknown')).toEqual({
      opened: false,
      error: 'workflowLaunch.openFailed'
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('refuses invalid or oversized local graphs before starting the build', async () => {
    for (const response of [
      Response.json({ nodes: [{ notAType: 'SaveImage' }] }),
      Response.json({ ...GRAPH, padding: 'x'.repeat(1_000_001) })
    ]) {
      mocks.fetch.mockResolvedValue(response)
      expect(await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')).toEqual({
        opened: false,
        error: 'workflowLaunch.openFailed'
      })
    }
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('does not launch after the account changes during graph download', async () => {
    mocks.fetch.mockImplementation(async () => {
      mocks.subject = 'changed-subject'
      return Response.json(GRAPH)
    })
    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')).toEqual({
      opened: false,
      error: 'workflowLaunch.openFailed'
    })
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
