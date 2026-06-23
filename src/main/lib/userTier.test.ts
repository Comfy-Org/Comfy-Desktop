import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

const userTierDataDir = path.join(os.tmpdir(), 'launcher-test-usertier')

vi.mock('electron', () => ({
  app: { getPath: () => userTierDataDir }
}))

const telemetry = await import('./telemetry')
const { refreshCloudUserTier, getUserTier, _resetForTest } = await import('./userTier')

/** Stub WebContents whose executeJavaScript resolves to a fixed tier result. */
function stubContents(result: unknown): { wc: Electron.WebContents } {
  return {
    wc: {
      executeJavaScript: () => Promise.resolve(result)
    } as unknown as Electron.WebContents
  }
}

describe('userTier tier_changed telemetry', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  beforeEach(async () => {
    await fs.rm(userTierDataDir, { recursive: true, force: true })
    await fs.mkdir(userTierDataDir, { recursive: true })
    _resetForTest()
    captured = []
    vi.spyOn(telemetry, 'capture').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: (ctx ?? {}) as Record<string, unknown> })
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(userTierDataDir, { recursive: true, force: true })
  })

  const tierChanges = (): Array<{ event: string; ctx: Record<string, unknown> }> =>
    captured.filter((c) => c.event === 'comfy.desktop.billing.tier_changed')

  it('does not emit on the first resolution out of unknown (hydration, not a change)', async () => {
    expect(getUserTier()).toBe('unknown')
    await refreshCloudUserTier(stubContents({ tier: 'FREE' }).wc)
    expect(getUserTier()).toBe('free')
    expect(tierChanges()).toHaveLength(0)
  })

  it('emits from_tier/to_tier on a real free → paid transition', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'FREE' }).wc)
    await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)
    expect(getUserTier()).toBe('paid')
    expect(tierChanges()).toHaveLength(1)
    expect(tierChanges()[0]!.ctx).toMatchObject({ from_tier: 'free', to_tier: 'paid' })
  })

  it('emits on a paid → free downgrade too', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'CREATOR' }).wc)
    await refreshCloudUserTier(stubContents({ tier: 'FREE' }).wc)
    expect(tierChanges()).toHaveLength(1)
    expect(tierChanges()[0]!.ctx).toMatchObject({ from_tier: 'paid', to_tier: 'free' })
  })

  it('does not emit when the tier is unchanged', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)
    await refreshCloudUserTier(stubContents({ tier: 'STANDARD' }).wc)
    expect(getUserTier()).toBe('paid')
    expect(tierChanges()).toHaveLength(0)
  })

  it('leaves the cache (and emits nothing) when no signed-in user is present', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)
    captured = []
    await refreshCloudUserTier(stubContents(null).wc)
    expect(getUserTier()).toBe('paid')
    expect(tierChanges()).toHaveLength(0)
  })
})
