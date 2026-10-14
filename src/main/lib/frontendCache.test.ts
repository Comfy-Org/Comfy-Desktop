import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
// The pending path fetches with the real deps; a test must never reach the network.
const realDownload = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => Promise.reject(new Error('offline')))
)
vi.mock('./download', () => ({
  download: realDownload,
  downloadMetaPath: (file: string) => `${file}.dl-meta`
}))

import {
  _resetForTest,
  answeredFrontendPins,
  appliedFrontendPin,
  cachedFrontendDir,
  frontendRootArgs,
  parseFrontendPin,
  prefetchFrontend,
  syncFrontendCache
} from './frontendCache'
import type { FrontendCacheDeps, FrontendPin } from './frontendCache'
import type { CampaignAnswer, CampaignApplied } from './coreBetaCampaigns'
import type { ComfyArgsSchema } from './comfy-args'
import { isTrustedArtifactUrl } from './trustedArtifactUrls'

const WHEEL_URL =
  'https://files.pythonhosted.org/packages/60/c6/aab1/comfyui_frontend_package-1.53.6-py3-none-any.whl'
const ZIP_URL = 'https://github.com/Comfy-Org/ComfyUI_frontend/releases/download/v1.53.6/dist.zip'
const ARCHIVE = 'archive bytes'
const SHA = createHash('sha256').update(ARCHIVE).digest('hex')

const pin = (over: Partial<FrontendPin> = {}): FrontendPin => ({
  url: WHEEL_URL,
  sha256: SHA,
  ...over
})

describe('isTrustedArtifactUrl', () => {
  it.each([WHEEL_URL, ZIP_URL, 'https://GITHUB.com/Comfy-Org/x/releases/download/v1/dist.zip'])(
    'trusts %s',
    (url) => {
      expect(isTrustedArtifactUrl(url, 'comfyui-frontend-package')).toBe(true)
    }
  )

  it.each([
    ['plain http', WHEEL_URL.replace('https', 'http')],
    ['another host', 'https://example.com/dist.zip'],
    ['another GitHub owner', 'https://github.com/someone/ComfyUI_frontend/dist.zip'],
    ['an owner sharing the prefix', 'https://github.com/Comfy-Orgx/x/releases/download/v1/d.zip'],
    [
      'a repo file, which can be a fork PR commit',
      `${ZIP_URL.split('/releases')[0]}/raw/abc/d.zip`
    ],
    ['a source archive', 'https://github.com/Comfy-Org/x/archive/refs/heads/main.zip'],
    ['a path stepping out of the owner', 'https://github.com/Comfy-Org/../someone/dist.zip'],
    ['an encoded step out', 'https://github.com/Comfy-Org/%2e%2e/someone/dist.zip'],
    ['credentials', 'https://user:pw@files.pythonhosted.org/x.whl'],
    ['not a URL', 'files.pythonhosted.org/x.whl'],
    ["another PyPI project's file", WHEEL_URL.replace('comfyui_frontend_package', 'other_package')],
    ['a PyPI project sharing the prefix', WHEEL_URL.replace('package-', 'package_extra-')]
  ])('refuses %s', (_label, url) => {
    expect(isTrustedArtifactUrl(url, 'comfyui-frontend-package')).toBe(false)
  })
})

describe('parseFrontendPin', () => {
  it.each([WHEEL_URL, ZIP_URL])('accepts %s with a sha256', (url) => {
    expect(parseFrontendPin({ url, sha256: SHA })).toEqual({ url, sha256: SHA })
  })

  it('returns the normalized URL, which the downloader accepts', () => {
    expect(parseFrontendPin({ url: ZIP_URL.replace('https', 'HTTPS'), sha256: SHA })?.url).toBe(
      ZIP_URL
    )
  })

  it.each([
    ['an unknown key', { url: WHEEL_URL, sha256: SHA, version: '1.53.6' }],
    ['no sha256', { url: WHEEL_URL }],
    ['an uppercase sha256', { url: WHEEL_URL, sha256: SHA.toUpperCase() }],
    ['a short sha256', { url: WHEEL_URL, sha256: SHA.slice(1) }],
    ['an untrusted host', { url: 'https://example.com/f.whl', sha256: SHA }],
    ['an archive that is neither wheel nor zip', { url: `${ZIP_URL}.tar.gz`, sha256: SHA }],
    [
      "another PyPI project's wheel",
      { url: WHEEL_URL.replace('comfyui_frontend_package', 'evil_package'), sha256: SHA }
    ],
    [
      'a zip on PyPI',
      { url: 'https://files.pythonhosted.org/packages/a/comfyui_frontend_package.zip', sha256: SHA }
    ],
    ['a string', WHEEL_URL],
    ['an array', [WHEEL_URL, SHA]],
    ['null', null]
  ])('refuses %s', (_label, value) => {
    expect(parseFrontendPin(value)).toBeNull()
  })
})

const applied = (...payloads: unknown[]): CampaignApplied[] =>
  payloads.map((payload, i) => ({
    key: `campaign_${i}`,
    grant: { arg: `--flag-${i}`, minCoreVersion: '0.3.60' },
    epoch: 1,
    enrolledNow: false,
    payload
  }))

describe('appliedFrontendPin', () => {
  it('is null when no applied campaign pins a frontend', () => {
    expect(appliedFrontendPin(applied({ grants: [] }, undefined))).toBeNull()
  })

  it('takes the pin of an applied campaign, and agrees with a second naming the same build', () => {
    expect(appliedFrontendPin(applied({ frontend: pin() }))).toEqual(pin())
    expect(appliedFrontendPin(applied({}, { frontend: pin() }, { frontend: pin() }))).toEqual(pin())
  })

  it('cancels on campaigns naming different builds, or on an invalid pin', () => {
    const other = pin({ sha256: 'b'.repeat(64) })
    expect(appliedFrontendPin(applied({ frontend: pin() }, { frontend: other }))).toBeNull()
    expect(appliedFrontendPin(applied({ frontend: pin() }, { frontend: { url: 1 } }))).toBeNull()
  })
})

describe('answeredFrontendPins', () => {
  const answer = (grants: number, payload: unknown, enrol = false): CampaignAnswer => ({
    enrol,
    grants: Array.from({ length: grants }, () => ({
      grant: { arg: '--enable-agent', minCoreVersion: '0.3.60' },
      epoch: 1,
      epochs: [1],
      requiresArgs: []
    })),
    payload
  })
  const member = { epoch: 1, enrolledAt: 1 }

  it('names each valid pin once, from members and enrol draws whose answer grants something', () => {
    const answers = new Map([
      ['a', answer(1, { frontend: pin() })],
      ['b', answer(1, { frontend: pin({ sha256: 'f'.repeat(64) }) }, true)],
      ['killed', answer(0, { frontend: pin({ sha256: 'c'.repeat(64) }) })],
      ['invalid', answer(1, { frontend: { url: WHEEL_URL } })]
    ])
    const records = { a: { '--enable-agent': member }, killed: { '--enable-agent': member } }
    expect(answeredFrontendPins(answers, records)).toEqual([pin(), pin({ sha256: 'f'.repeat(64) })])
  })

  it('skips a campaign this machine is not in and did not draw enrol on', () => {
    const answers = new Map([['other', answer(1, { frontend: pin() })]])
    expect(answeredFrontendPins(answers, {})).toEqual([])
    expect(answeredFrontendPins(answers, { other: { '--enable-agent': member } })).toEqual([pin()])
  })
})

describe('the cache', () => {
  let root = ''
  let downloads: string[] = []

  /** `layout` is where the archive puts `index.html`: a wheel's package dir, a dist zip's root. */
  const deps = (layout: 'wheel' | 'dist' | 'none', bytes = ARCHIVE): FrontendCacheDeps => ({
    download: async (url, dest) => {
      downloads.push(url)
      await fs.promises.writeFile(dest, bytes)
    },
    sha256File: async (file) =>
      createHash('sha256')
        .update(await fs.promises.readFile(file))
        .digest('hex'),
    extract: async (_archive, dest) => {
      const dir = layout === 'wheel' ? path.join(dest, 'comfyui_frontend_package', 'static') : dest
      await fs.promises.mkdir(dir, { recursive: true })
      if (layout !== 'none') await fs.promises.writeFile(path.join(dir, 'index.html'), 'ok')
    }
  })

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-cache-'))
    downloads = []
    realDownload.mockClear()
    _resetForTest()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it.each(['wheel', 'dist'] as const)('caches a %s build under its sha256', async (layout) => {
    const dir = await prefetchFrontend(pin(), root, deps(layout))
    expect(dir).toBe(path.join(root, SHA))
    expect(cachedFrontendDir(SHA, root)).toBe(dir)
    expect(fs.readdirSync(root), 'no temp leftovers').toEqual([SHA])
  })

  it('refuses a download whose sha256 differs from the pin, leaving nothing behind', async () => {
    expect(await prefetchFrontend(pin(), root, deps('wheel', 'tampered'))).toBeNull()
    expect(cachedFrontendDir(SHA, root)).toBeNull()
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('replaces a leftover build directory that has no index.html', async () => {
    fs.mkdirSync(path.join(root, SHA, 'assets'), { recursive: true })
    expect(await prefetchFrontend(pin(), root, deps('dist'))).toBe(path.join(root, SHA))
    expect(cachedFrontendDir(SHA, root)).toBe(path.join(root, SHA))
  })

  it('refuses an archive with no index.html', async () => {
    expect(await prefetchFrontend(pin(), root, deps('none'))).toBeNull()
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('shares one download between concurrent fetches, and none once cached', async () => {
    const d = deps('wheel')
    await Promise.all([prefetchFrontend(pin(), root, d), prefetchFrontend(pin(), root, d)])
    await prefetchFrontend(pin(), root, d)
    expect(downloads).toEqual([WHEEL_URL])
  })

  const age = (entry: string, days: number): void => {
    const then = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    fs.utimesSync(path.join(root, entry), then, then)
  }

  it('app start removes week-old builds no pin names and old fetches, and fetches the rest', async () => {
    const stale = 'd'.repeat(64)
    fs.mkdirSync(path.join(root, stale), { recursive: true })
    fs.writeFileSync(path.join(root, stale, 'index.html'), 'old')
    fs.mkdirSync(path.join(root, '.tmp-interrupted'))
    age(stale, 8)
    age('.tmp-interrupted', 8)
    await syncFrontendCache([pin()], root, deps('dist'))
    expect(fs.readdirSync(root)).toEqual([SHA])
    age(SHA, 8)
    await syncFrontendCache([], root, deps('dist'))
    expect(fs.readdirSync(root)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')(
    'app start still fetches when an entry cannot be read',
    async () => {
      fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'dangling'))
      await syncFrontendCache([pin()], root, deps('dist'))
      expect(cachedFrontendDir(SHA, root)).toBe(path.join(root, SHA))
    }
  )

  it('a removal cut short leaves nothing under the sha256 for a later pin to serve', async () => {
    const stale = 'd'.repeat(64)
    fs.mkdirSync(path.join(root, stale))
    fs.writeFileSync(path.join(root, stale, 'index.html'), 'old')
    age(stale, 8)
    const rm = vi.spyOn(fs.promises, 'rm').mockRejectedValue(new Error('interrupted'))
    try {
      await syncFrontendCache([], root, deps('dist'))
    } finally {
      rm.mockRestore()
    }
    expect(cachedFrontendDir(stale, root)).toBeNull()
  })

  it('app start keeps an unnamed build used this week, and a fetch still running', async () => {
    const recent = 'e'.repeat(64)
    fs.mkdirSync(path.join(root, recent))
    fs.mkdirSync(path.join(root, '.tmp-running'))
    age(recent, 6)
    await syncFrontendCache([], root, deps('dist'))
    expect(fs.readdirSync(root).sort()).toEqual(['.tmp-running', recent])
  })

  describe('frontendRootArgs', () => {
    const schema = (...names: string[]): ComfyArgsSchema =>
      ({ args: [], knownFlags: new Set(names) }) as unknown as ComfyArgsSchema
    const cache = (): string => {
      const dir = path.join(root, SHA)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'index.html'), 'ok')
      return dir
    }

    it('passes the cached build', () => {
      const dir = cache()
      age(SHA, 8)
      const out = frontendRootArgs(applied({ frontend: pin() }), [], schema('front-end-root'), root)
      expect(out.args).toEqual(['--front-end-root', dir])
      expect(out.record).toContain('served from')
      expect(Date.now() - fs.statSync(dir).mtimeMs, 'served, so cleanup keeps it').toBeLessThan(
        60_000
      )
    })

    it('passes nothing without a pin', () => {
      cache()
      expect(frontendRootArgs(applied({}), [], schema('front-end-root'), root)).toEqual({
        args: [],
        record: null
      })
    })

    it.each([
      ['--front-end-root', 'x'],
      ['--front-end-root=x'],
      ['--front-end-version', 'Comfy-Org/ComfyUI_frontend@latest'],
      ['--front-end-version=Comfy-Org/ComfyUI_frontend@latest']
    ])('lets the user own %s win', (...userArgs) => {
      cache()
      const out = frontendRootArgs(
        applied({ frontend: pin() }),
        userArgs,
        schema('front-end-root'),
        root
      )
      expect(out.args).toEqual([])
      expect(out.record).toContain('your own frontend arg wins')
    })

    it('passes nothing to a ComfyUI without the flag', () => {
      cache()
      const out = frontendRootArgs(applied({ frontend: pin() }), [], schema(), root)
      expect(out.args).toEqual([])
      expect(out.record).toContain('not supported')
    })

    it('serves the bundled frontend while the build downloads, and starts the download', async () => {
      const out = frontendRootArgs(applied({ frontend: pin() }), [], schema('front-end-root'), root)
      expect(out.args).toEqual([])
      expect(out.record).toContain('pending')
      await vi.waitFor(() => expect(realDownload).toHaveBeenCalledOnce())
      expect(realDownload.mock.calls[0]).toContain(WHEEL_URL)
    })
  })
})
