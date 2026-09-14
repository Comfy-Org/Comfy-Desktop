// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaceMembers, listWorkspaces } from './workspaces'

function stub(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' }
        })
    )
  )
}

describe('listWorkspaces', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps the ingest response to camelCase Workspace[]', async () => {
    stub(200, {
      workspaces: [
        {
          id: 'w-1',
          name: 'Personal',
          type: 'personal',
          role: 'owner',
          subscription_tier: 'FREE',
          joined_at: 't'
        }
      ]
    })
    const ws = await listWorkspaces('tok', { apiBase: 'https://cloud/api' })
    expect(ws).toEqual([
      {
        id: 'w-1',
        name: 'Personal',
        type: 'personal',
        role: 'owner',
        subscriptionTier: 'FREE',
        joinedAt: 't'
      }
    ])
  })

  it('returns [] when team-workspaces is off (404)', async () => {
    stub(404, {})
    expect(await listWorkspaces('tok', { apiBase: 'https://cloud/api' })).toEqual([])
  })

  it('throws on unauthorized', async () => {
    stub(401, {})
    await expect(listWorkspaces('tok', { apiBase: 'https://cloud/api' })).rejects.toThrow(
      /authorized/i
    )
  })

  it('returns [] on a null / non-object 200 body', async () => {
    stub(200, null)
    expect(await listWorkspaces('tok', { apiBase: 'https://cloud/api' })).toEqual([])
  })

  it.each(['nope', {}])('returns [] when workspaces is not an array', async (workspaces) => {
    stub(200, { workspaces })
    expect(await listWorkspaces('tok', { apiBase: 'https://cloud/api' })).toEqual([])
  })
})

describe('listWorkspaceMembers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads every page and maps member fields', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const secondPage = String(input).includes('offset=1')
      return new Response(
        JSON.stringify(
          secondPage
            ? {
                members: [{ id: 'user-2', email: 'two@example.com' }],
                pagination: { has_more: false }
              }
            : {
                members: [
                  {
                    id: 'user-1',
                    name: 'One',
                    role: 'owner',
                    joined_at: 't',
                    is_original_owner: true
                  }
                ],
                pagination: { has_more: true }
              }
        ),
        { status: 200 }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listWorkspaceMembers('tok', { apiBase: 'https://cloud/api' })).resolves.toEqual([
      { id: 'user-1', name: 'One', role: 'owner', joinedAt: 't', isOriginalOwner: true },
      { id: 'user-2', email: 'two@example.com' }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://cloud/api/workspace/members?offset=0&limit=100'
    )
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://cloud/api/workspace/members?offset=1&limit=100'
    )
    expect((fetchMock.mock.calls[0]![1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok'
    )
  })

  it('throws on unauthorized', async () => {
    stub(403, {})
    await expect(listWorkspaceMembers('tok', { apiBase: 'https://cloud/api' })).rejects.toThrow(
      /authorized/i
    )
  })
})
