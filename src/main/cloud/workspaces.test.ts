// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaces } from './workspaces'

function stub(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })))
}

describe('listWorkspaces', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps the ingest response to camelCase Workspace[]', async () => {
    stub(200, { workspaces: [{ id: 'w-1', name: 'Personal', type: 'personal', role: 'owner', subscription_tier: 'FREE', joined_at: 't' }] })
    const ws = await listWorkspaces('tok', { apiBase: 'https://cloud/api' })
    expect(ws).toEqual([{ id: 'w-1', name: 'Personal', type: 'personal', role: 'owner', subscriptionTier: 'FREE', joinedAt: 't' }])
  })

  it('returns [] when team-workspaces is off (404)', async () => {
    stub(404, {})
    expect(await listWorkspaces('tok', { apiBase: 'https://cloud/api' })).toEqual([])
  })

  it('throws on unauthorized', async () => {
    stub(401, {})
    await expect(listWorkspaces('tok', { apiBase: 'https://cloud/api' })).rejects.toThrow(/authorized/i)
  })

  it('returns [] on a null / non-object 200 body', async () => {
    stub(200, null)
    expect(await listWorkspaces('tok', { apiBase: 'https://cloud/api' })).toEqual([])
  })
})
