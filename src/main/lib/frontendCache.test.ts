import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  net: { fetch: vi.fn() }
}))

import {
  _resetForTest,
  cachedFrontendDir,
  pickWheel,
  prefetchFrontend,
  pruneFrontendCache
} from './frontendCache'
import type { FrontendCacheDeps } from './frontendCache'
import { sha256File } from './modelDownloadStaging'

const WHEEL_URL =
  'https://files.pythonhosted.org/packages/60/c6/aab12cefc5c3247d7d1bf3fdb9fb10f8478c21200b1e0b9c02bb89bca655/comfyui_frontend_package-1.53.6-py3-none-any.whl'

/** The fields this code reads, copied from PyPI's real `/pypi/comfyui-frontend-package/1.53.6/json`. */
function pypiJson(over: Record<string, unknown> = {}, version = '1.53.6'): unknown {
  return {
    info: { version },
    urls: [
      {
        filename: `comfyui_frontend_package-${version}-py3-none-any.whl`,
        packagetype: 'bdist_wheel',
        size: 25152605,
        url: WHEEL_URL,
        yanked: false,
        digests: { sha256: '8b9616452c8bc693a4a77f63d05c8c690e9ef2b279f330d8d957541d69c6c452' },
        ...over
      },
      {
        filename: `comfyui_frontend_package-${version}.tar.gz`,
        packagetype: 'sdist',
        size: 24512179,
        url: 'https://files.pythonhosted.org/packages/b0/fb/x/comfyui_frontend_package-1.53.6.tar.gz',
        yanked: false,
        digests: { sha256: 'edd2c7214360646cd3d2e453012455f4057276d4ce5094d7829383e4fbe93a1a' }
      }
    ]
  }
}

describe('pickWheel', () => {
  it('picks the pure wheel, its digest and size', () => {
    expect(pickWheel(pypiJson(), '1.53.6')).toEqual({
      url: WHEEL_URL,
      sha256: '8b9616452c8bc693a4a77f63d05c8c690e9ef2b279f330d8d957541d69c6c452',
      size: 25152605
    })
  })

  it.each([
    ['a yanked wheel', { yanked: true }],
    ['a wheel hosted off the PyPI file CDN', { url: 'https://example.com/x.whl' }],
    ['a missing digest', { digests: {} }],
    ['a malformed digest', { digests: { sha256: 'abc' } }],
    ['a platform-specific wheel', { filename: 'comfyui_frontend_package-1.53.6-cp312-win.whl' }]
  ])('refuses %s', (_label, over) => {
    expect(pickWheel(pypiJson(over), '1.53.6')).toBeNull()
  })

  it('refuses a response for a different release than the one asked for', () => {
    expect(pickWheel(pypiJson({}, '1.53.5'), '1.53.6')).toBeNull()
  })

  it.each([[null], ['nope'], [{}], [{ info: { version: '1.53.6' } }]])(
    'refuses a malformed response %j',
    (json) => {
      expect(pickWheel(json, '1.53.6')).toBeNull()
    }
  )
})

describe('frontend cache', () => {
  let root: string
  const WHEEL_BYTES = 'not really a wheel'
  const digest = createHash('sha256').update(WHEEL_BYTES).digest('hex')

  /** A fetch that "downloads" WHEEL_BYTES and "extracts" a static/ with the given files. */
  function fakeDeps(staticFiles: string[] = ['index.html'], sha = digest): FrontendCacheDeps {
    return {
      fetchJSON: vi.fn(async () => pypiJson({ digests: { sha256: sha } })),
      download: vi.fn(async (_url: string, dest: string) => {
        fs.writeFileSync(dest, WHEEL_BYTES)
      }),
      sha256File,
      extract: vi.fn(async (_archive: string, dest: string) => {
        const staticDir = path.join(dest, 'comfyui_frontend_package', 'static')
        fs.mkdirSync(staticDir, { recursive: true })
        for (const file of staticFiles) fs.writeFileSync(path.join(staticDir, file), file)
      })
    }
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-cache-'))
    _resetForTest()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('places the verified build under its version and leaves nothing else behind', async () => {
    const deps = fakeDeps(['index.html', 'main.js'])

    const dir = await prefetchFrontend('1.53.6', root, deps)

    expect(dir).toBe(path.join(root, '1.53.6'))
    expect(cachedFrontendDir('1.53.6', root)).toBe(dir)
    expect(fs.readdirSync(dir!).sort()).toEqual(['index.html', 'main.js'])
    expect(fs.readdirSync(root)).toEqual(['1.53.6'])
    expect(deps.fetchJSON).toHaveBeenCalledWith(
      'https://pypi.org/pypi/comfyui-frontend-package/1.53.6/json'
    )
  })

  it('refuses a wheel whose sha256 does not match what PyPI published', async () => {
    const deps = fakeDeps(['index.html'], 'f'.repeat(64))

    expect(await prefetchFrontend('1.53.6', root, deps)).toBeNull()
    expect(deps.extract).not.toHaveBeenCalled()
    expect(cachedFrontendDir('1.53.6', root)).toBeNull()
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('refuses a wheel without static/index.html, since Core would serve it anyway', async () => {
    expect(await prefetchFrontend('1.53.6', root, fakeDeps(['main.js']))).toBeNull()
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('resolves null rather than throwing when PyPI is unreachable', async () => {
    const deps = fakeDeps()
    vi.mocked(deps.fetchJSON).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND pypi.org'))

    expect(await prefetchFrontend('1.53.6', root, deps)).toBeNull()
    expect(deps.download).not.toHaveBeenCalled()
  })

  it('does no network work for a version already cached', async () => {
    fs.mkdirSync(path.join(root, '1.53.6'))
    fs.writeFileSync(path.join(root, '1.53.6', 'index.html'), '')
    const deps = fakeDeps()

    expect(await prefetchFrontend('1.53.6', root, deps)).toBe(path.join(root, '1.53.6'))
    expect(deps.fetchJSON).not.toHaveBeenCalled()
  })

  it('shares one download between concurrent requests for a version', async () => {
    const deps = fakeDeps()

    const [a, b] = await Promise.all([
      prefetchFrontend('1.53.6', root, deps),
      prefetchFrontend('1.53.6', root, deps)
    ])

    expect(a).toBe(b)
    expect(deps.download).toHaveBeenCalledTimes(1)
  })

  it('does not count a directory without index.html as cached', () => {
    fs.mkdirSync(path.join(root, '1.53.6'))

    expect(cachedFrontendDir('1.53.6', root)).toBeNull()
  })

  it('prunes every other version and interrupted fetches, keeping the granted one', async () => {
    for (const name of ['1.52.7', '1.53.6', '.tmp-1.53.6-1-2']) fs.mkdirSync(path.join(root, name))
    fs.writeFileSync(path.join(root, '.tmp-1.53.6-1-2.whl'), '')

    await pruneFrontendCache('1.53.6', root)

    expect(fs.readdirSync(root)).toEqual(['1.53.6'])
  })

  it('prunes everything when no grant applies', async () => {
    fs.mkdirSync(path.join(root, '1.53.6'))

    await pruneFrontendCache(null, root)

    expect(fs.readdirSync(root)).toEqual([])
  })

  it('treats a cache that does not exist yet as nothing to prune', async () => {
    await expect(pruneFrontendCache(null, path.join(root, 'absent'))).resolves.toBeUndefined()
  })
})
