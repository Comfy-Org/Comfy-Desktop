import { afterEach, describe, expect, it, vi } from 'vitest'
import { R2_BASE_URL, R2_MIRROR_BASE_URL, r2MirrorUrl } from './r2Mirror'

describe('r2MirrorUrl', () => {
  it('rewrites the host while preserving the path', () => {
    expect(r2MirrorUrl(`${R2_BASE_URL}/latest.json`)).toBe(`${R2_MIRROR_BASE_URL}/latest.json`)
    expect(r2MirrorUrl(`${R2_BASE_URL}/linux-nvidia/v0.20.1-env1/foo.7z`)).toBe(
      `${R2_MIRROR_BASE_URL}/linux-nvidia/v0.20.1-env1/foo.7z`
    )
  })

  it('returns undefined for URLs outside the R2 namespace', () => {
    expect(r2MirrorUrl('https://api.github.com/repos/Comfy-Org/ComfyUI/releases')).toBeUndefined()
    expect(r2MirrorUrl('https://example.com/standalone-environments/latest.json')).toBeUndefined()
    expect(r2MirrorUrl('')).toBeUndefined()
  })

  it('does not collide R2 prefix with a longer matching subpath', () => {
    expect(r2MirrorUrl(`${R2_BASE_URL}-evil/foo`)).toBeUndefined()
  })
})

describe('COMFY_STANDALONE_BASE_URL dev override', () => {
  const proc = process as { defaultApp?: boolean }
  const originalDefaultApp = proc.defaultApp

  afterEach(() => {
    proc.defaultApp = originalDefaultApp
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function freshModule() {
    vi.resetModules()
    return await import('./r2Mirror')
  }

  it('applies the override when unpackaged (defaultApp), stripping trailing slashes', async () => {
    proc.defaultApp = true
    vi.stubEnv('COMFY_STANDALONE_BASE_URL', 'http://localhost:8000/')
    const mod = await freshModule()
    expect(mod.R2_BASE_URL).toBe('http://localhost:8000')
  })

  it('disables the production mirror fallback while the override is active', async () => {
    proc.defaultApp = true
    vi.stubEnv('COMFY_STANDALONE_BASE_URL', 'http://localhost:8000')
    const mod = await freshModule()
    expect(mod.r2MirrorUrl(`${mod.R2_BASE_URL}/latest.json`)).toBeUndefined()
  })

  it('ignores the env var when not running unpackaged (packaged builds, plain node)', async () => {
    proc.defaultApp = undefined
    vi.stubEnv('COMFY_STANDALONE_BASE_URL', 'http://localhost:8000')
    const mod = await freshModule()
    expect(mod.R2_BASE_URL).toBe('https://desktop-assets.comfy.org/standalone-environments')
    expect(mod.r2MirrorUrl(`${mod.R2_BASE_URL}/latest.json`)).toBe(
      `${mod.R2_MIRROR_BASE_URL}/latest.json`
    )
  })
})
