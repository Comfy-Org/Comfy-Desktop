import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { app, mkdirSync } = vi.hoisted(() => ({
  app: { isPackaged: false, setPath: vi.fn() },
  mkdirSync: vi.fn()
}))
vi.mock('electron', () => ({ app }))
vi.mock('node:fs', () => ({ mkdirSync, default: { mkdirSync } }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  app.isPackaged = false
})
afterEach(() => vi.unstubAllEnvs())

describe('Electron test profile isolation', () => {
  it('redirects both app files and browser sessions into the requested test directory', async () => {
    const profile = path.join(os.tmpdir(), 'desktop-profile-test')
    vi.stubEnv('E2E', '1')
    vi.stubEnv('E2E_USER_DATA_DIR', profile)
    await import('./e2eProfile')
    expect(mkdirSync).toHaveBeenCalledWith(profile, { recursive: true })
    expect(app.setPath.mock.calls).toEqual([
      ['userData', profile],
      ['sessionData', profile]
    ])
  })

  it.each(['', '0'])('does not change normal app storage when E2E is %j', async (enabled) => {
    vi.stubEnv('E2E', enabled)
    vi.stubEnv('E2E_USER_DATA_DIR', path.join(os.tmpdir(), 'ignored'))
    await import('./e2eProfile')
    expect(app.setPath).not.toHaveBeenCalled()
    expect(mkdirSync).not.toHaveBeenCalled()
  })

  it('does not redirect packaged application storage', async () => {
    app.isPackaged = true
    vi.stubEnv('E2E', '1')
    vi.stubEnv('E2E_USER_DATA_DIR', path.join(os.tmpdir(), 'ignored'))
    await import('./e2eProfile')
    expect(app.setPath).not.toHaveBeenCalled()
    expect(mkdirSync).not.toHaveBeenCalled()
  })

  it('rejects relative paths before changing app storage', async () => {
    vi.stubEnv('E2E', '1')
    vi.stubEnv('E2E_USER_DATA_DIR', 'relative-profile')
    await expect(import('./e2eProfile')).rejects.toThrow('must be an absolute path')
    expect(app.setPath).not.toHaveBeenCalled()
    expect(mkdirSync).not.toHaveBeenCalled()
  })
})
