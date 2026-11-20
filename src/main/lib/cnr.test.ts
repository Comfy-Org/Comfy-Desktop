import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  net: { fetch: vi.fn() }
}))

const cnrMocks = vi.hoisted(() => ({
  fetchJSON: vi.fn(),
  download: vi.fn(),
  extract: vi.fn()
}))
vi.mock('./fetch', () => ({ fetchJSON: cnrMocks.fetchJSON }))
vi.mock('./download', () => ({ download: cnrMocks.download }))
vi.mock('./extract', () => ({ extract: cnrMocks.extract }))
vi.mock('./telemetry', () => ({ capture: vi.fn() }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { installCnrNode, isSafePathComponent, switchCnrVersion } from './cnr'

describe('isSafePathComponent', () => {
  it('accepts simple names', () => {
    expect(isSafePathComponent('my-node')).toBe(true)
    expect(isSafePathComponent('node_v2')).toBe(true)
    expect(isSafePathComponent('ComfyUI-Manager')).toBe(true)
    expect(isSafePathComponent('a')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isSafePathComponent('')).toBe(false)
  })

  it('rejects dot and double-dot', () => {
    expect(isSafePathComponent('.')).toBe(false)
    expect(isSafePathComponent('..')).toBe(false)
  })

  it('rejects path traversal', () => {
    expect(isSafePathComponent('../escape')).toBe(false)
    if (process.platform === 'win32') {
      expect(isSafePathComponent('..\\escape')).toBe(false)
    }
  })

  it('rejects paths with separators', () => {
    expect(isSafePathComponent('foo/bar')).toBe(false)
    if (process.platform === 'win32') {
      expect(isSafePathComponent('foo\\bar')).toBe(false)
    }
  })

  it('rejects names that differ from their basename', () => {
    expect(isSafePathComponent('subdir/file')).toBe(false)
  })
})

describe('custom-node pack download URL policy', () => {
  function expectSecurePolicy(): void {
    expect(cnrMocks.download).toHaveBeenCalledTimes(1)
    const [url, , , options] = cnrMocks.download.mock.calls[0]!
    expect(url).toBe('https://cdn.comfy.org/pack.zip')
    expect(options.validateUrl('https://cdn.comfy.org/pack.zip')).toBe(true)
    expect(options.validateUrl('http://cdn.comfy.org/pack.zip')).toBe(false)
    expect(options.validateUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(options.validateUrl('file:///etc/passwd')).toBe(false)
  }

  function arrange(): string {
    vi.clearAllMocks()
    cnrMocks.fetchJSON.mockResolvedValue({
      downloadUrl: 'https://cdn.comfy.org/pack.zip',
      version: '1.0.0'
    })
    cnrMocks.download.mockRejectedValue(new Error('stop after download'))
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cnr-policy-'))
  }

  it('installs a pack under the HTTPS policy', async () => {
    const dir = arrange()
    try {
      await expect(installCnrNode('some-pack', '1.0.0', dir, () => {})).rejects.toThrow()
      expectSecurePolicy()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('switches a pack version under the HTTPS policy', async () => {
    const dir = arrange()
    try {
      await expect(switchCnrVersion('some-pack', '1.0.0', dir, () => {})).rejects.toThrow()
      expectSecurePolicy()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
