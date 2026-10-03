import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallationRecord } from '../installations'

import {
  _resetForTest,
  canonicalPath,
  dbLocationProps,
  defaultDbLayout,
  boundedDbLocation,
  DB_LOCATION_DEADLINE_MS,
  dbUrlSource,
  spelling,
  hashPath,
  relativeLocation,
  type LocationRoots
} from './dbLocationTelemetry'

let tmp: string

beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'db-location-')))
  _resetForTest()
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** An expected hash, asserted real first: a dead `hashPath` must not make null === null pass. */
const hashed = async (p: string): Promise<string> => {
  const h = await hashPath(p)
  expect(h, `a hash for ${p}`).toMatch(/^[0-9a-f]{16}$/)
  return h!
}

describe('hashPath', () => {
  it('is a 16-hex digest, stable for one path and distinct across paths', async () => {
    const a = await hashPath(path.join(tmp, 'a', 'comfyui.db'))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(await hashPath(path.join(tmp, 'a', 'comfyui.db'))).toBe(a)
    expect(await hashPath(path.join(tmp, 'b', 'comfyui.db'))).not.toBe(a)
    expect(await hashPath(null)).toBeNull()
  })

  it('hashes every spelling of one location the same', async () => {
    const real = path.join(tmp, 'install', 'user')
    fs.mkdirSync(real, { recursive: true })
    fs.symlinkSync(path.join(tmp, 'install'), path.join(tmp, 'link'), 'junction')
    const h = await hashPath(real)
    expect(await hashPath(`${real}${path.sep}`)).toBe(h)
    expect(await hashPath(path.join(tmp, 'install', 'x', '..', 'user'))).toBe(h)
    expect(await hashPath(path.join(tmp, 'link', 'user')), 'through a symlink').toBe(h)
    expect(
      await hashPath(path.join(tmp, 'link', 'user', 'comfyui.db')),
      'a file that does not exist yet, below a symlink'
    ).toBe(await hashPath(path.join(real, 'comfyui.db')))
  })

  it('is the truncated SHA-256 of the canonical path, and needs no key', async () => {
    const p = path.join(tmp, 'a', 'comfyui.db')
    const canonical = spelling(p, process.platform)
    const expected = createHash('sha256').update(canonical).digest('hex').slice(0, 16)
    expect(await hashPath(p)).toBe(expected)
  })
})

describe('spelling', () => {
  it('takes separators from the host and case folding from the platform', () => {
    expect(spelling('C:\\Data\\X', 'linux', '\\'), 'a Windows host, a linux override').toBe(
      'C:/Data/X'
    )
    expect(spelling('/Data/a\\b', 'win32', '/'), 'a POSIX host, a win32 override').toBe(
      '/data/a\\b'
    )
  })

  it('turns backslashes into separators on Windows only', () => {
    expect(spelling('C:\\Users\\Ada\\ComfyUI', 'win32', '\\')).toBe('c:/users/ada/comfyui')
    expect(spelling('/data/a\\b/user', 'linux', '/'), 'a literal backslash in a POSIX name').toBe(
      '/data/a\\b/user'
    )
  })
})

describe('canonicalPath', () => {
  it('has no answer, rather than a guess, when a part cannot be resolved', async () => {
    vi.spyOn(fs.promises, 'realpath').mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'EACCES' })
    )
    expect(await canonicalPath(path.join(tmp, 'x'))).toBeNull()
    vi.restoreAllMocks()
  })

  it('folds case on Windows and macOS only', async () => {
    const p = path.join(tmp, 'Missing', 'Comfy.DB')
    expect(await canonicalPath(p, 'win32')).toBe(p.replace(/\\/g, '/').toLowerCase())
    expect(await canonicalPath(p, 'darwin')).toBe(p.replace(/\\/g, '/').toLowerCase())
    expect(await canonicalPath(p, 'linux')).toBe(p.replace(/\\/g, '/'))
  })
})

describe('defaultDbLayout', () => {
  const inst = (comfyVersion: object): InstallationRecord =>
    ({ comfyVersion }) as unknown as InstallationRecord

  it('reads the user-directory default from a release the install provably contains', async () => {
    expect(defaultDbLayout(inst({ baseTag: 'v0.34.0', baseTagVerified: true }))).toBe('user_dir')
    expect(
      defaultDbLayout(inst({ baseTag: 'v0.35.1', ancestorTag: 'v0.34.2', commitsAhead: 3 }))
    ).toBe('user_dir')
  })

  it('reads the fixed default only on an install sitting exactly on an older tag', async () => {
    expect(
      defaultDbLayout(inst({ baseTag: 'v0.33.9', commitsAhead: 0, baseTagVerified: true }))
    ).toBe('comfy_dir')
    expect(
      defaultDbLayout(inst({ baseTag: 'v0.33.9', commitsAhead: 0 })),
      'an unverified tag settles nothing'
    ).toBeNull()
    expect(
      defaultDbLayout(inst({ baseTag: 'v0.33.9', commitsAhead: 4, baseTagVerified: true })),
      'past an older tag'
    ).toBeNull()
    expect(defaultDbLayout(inst({ baseTag: 'v0.34.0', commitsAhead: 0 })), 'unverified').toBeNull()
    expect(defaultDbLayout(inst({}))).toBeNull()
  })
})

describe('dbLocationProps', () => {
  const cwd = path.join(path.resolve('/'), 'installs', 'one')
  const main = path.join('ComfyUI', 'main.py')
  const comfy = path.join(cwd, 'ComfyUI')
  const legacy = path.join(path.resolve('/'), 'legacy')
  const adoptPins = [
    '--base-directory',
    legacy,
    '--user-directory',
    path.join(legacy, 'user'),
    '--database-url',
    `sqlite:///${path.join(legacy, 'user', 'comfyui.db')}`
  ]
  const roots: LocationRoots = {
    installRoots: [path.dirname(cwd)],
    installDirs: [cwd],
    legacyRoots: [legacy]
  }
  const props = (args: string[] | undefined, adoptedBaseDir?: string) =>
    dbLocationProps({ cwd, args, layout: null, hasDatabase: true, adoptedBaseDir, roots })

  it('hashes ComfyUI defaults for a managed install', async () => {
    expect(await props(['-s', main, '--listen'])).toEqual({
      db_path_hash: await hashed(path.join(comfy, 'user', 'comfyui.db')),
      user_dir_hash: await hashed(path.join(comfy, 'user')),
      base_dir_hash: await hashed(comfy),
      db_path_rel: '<this-install>/ComfyUI/user/comfyui.db',
      user_dir_rel: '<this-install>/ComfyUI/user',
      base_dir_rel: '<this-install>/ComfyUI',
      db_url_source: 'install_local'
    })
  })

  it("recognises Desktop's own pin for an adopted install", async () => {
    expect(await props(['-s', main, ...adoptPins], legacy)).toEqual({
      db_path_hash: await hashed(path.join(legacy, 'user', 'comfyui.db')),
      user_dir_hash: await hashed(path.join(legacy, 'user')),
      base_dir_hash: await hashed(legacy),
      db_path_rel: '<legacy-root>/user/comfyui.db',
      user_dir_rel: '<legacy-root>/user',
      base_dir_rel: '<legacy-root>',
      db_url_source: 'adopted_legacy'
    })
  })

  it('keeps the adopted label when a core without a database dropped the database pin', async () => {
    const p = await dbLocationProps({
      cwd,
      args: ['-s', main, ...adoptPins.slice(0, 4)],
      layout: null,
      hasDatabase: false,
      adoptedBaseDir: legacy,
      roots
    })
    expect(p.db_path_hash, 'no database to hash').toBeNull()
    expect(p.db_path_rel).toBeNull()
    expect(p.user_dir_hash).toBe(await hashed(path.join(legacy, 'user')))
    expect(p.db_url_source).toBe('adopted_legacy')
  })

  it("lets the user's own database URL win over the adopted pin", async () => {
    const mine = path.join(path.resolve('/'), 'mine.db')
    const p = await props(['-s', main, ...adoptPins, '--database-url', `sqlite:///${mine}`], legacy)
    expect(p.db_path_hash).toBe(await hashed(mine))
    expect(p.db_path_rel).toBe('outside_default')
    expect(p.db_url_source).toBe('user_override')
  })

  it('sends no database hash unless the core is known to have a database', async () => {
    {
      const hasDatabase = false
      const p = await dbLocationProps({
        cwd,
        args: ['-s', main],
        layout: null,
        hasDatabase,
        adoptedBaseDir: undefined,
        roots
      })
      expect(p.db_path_hash).toBeNull()
      expect(p.db_path_rel).toBeNull()
      expect(p.base_dir_hash).toBe(await hashed(comfy))
    }
  })

  it("lets the user's own location args win over the adopted pin", async () => {
    const mine = path.join(path.resolve('/'), 'mine')
    const p = await props(['-s', main, ...adoptPins, `--base-directory=${mine}`], legacy)
    expect(p.base_dir_hash).toBe(await hashed(mine))
    expect(p.db_url_source).toBe('user_override')
  })

  it("lets the user's own user directory win over the adopted pin", async () => {
    const mine = path.join(path.resolve('/'), 'mine', 'user')
    const p = await props(['-s', main, ...adoptPins, '--user-directory', mine], legacy)
    expect(p.user_dir_hash).toBe(await hashed(mine))
    expect(p.db_url_source).toBe('user_override')
  })

  it('reports no database for a URL with connection options, rather than guess the file', async () => {
    const db = path.join(path.resolve('/'), 'shared', 'comfyui.db')
    const p = await props(['-s', main, '--database-url', `sqlite:///${db}?timeout=30`])
    expect(p.db_path_hash).toBeNull()
    expect(p.db_path_rel).toBeNull()
    expect(p.db_url_source).toBe('user_override')
  })

  it('marks a user database URL as an override and hashes no non-file database', async () => {
    const p = await props(['-s', main, '--database-url', 'sqlite:///:memory:'])
    expect(p.db_path_hash).toBeNull()
    expect(p.user_dir_hash).toBe(await hashed(path.join(comfy, 'user')))
    expect(p.db_url_source).toBe('user_override')
  })

  it('sends no database hash when the default depends on an unknown core version', async () => {
    const userDir = path.join(path.resolve('/'), 'data', 'user')
    const args = ['-s', main, '--user-directory', userDir]
    expect((await props(args)).db_path_hash).toBeNull()
    expect((await props(args)).user_dir_hash).toBe(await hashed(userDir))
    expect(
      await dbLocationProps({
        cwd,
        args,
        layout: 'user_dir',
        hasDatabase: true,
        adoptedBaseDir: undefined,
        roots
      })
    ).toEqual(
      expect.objectContaining({ db_path_hash: await hashed(path.join(userDir, 'comfyui.db')) })
    )
  })

  it('reports an unknown location when a location flag is abbreviated', async () => {
    const p = await props(['-s', main, '--user-dir', path.join(path.resolve('/'), 'x')])
    expect(p.db_url_source).toBe('unknown')
    expect(p.user_dir_hash).toBeNull()
    expect((await props(['-s', main, '--base=/x'])).db_url_source).toBe('unknown')
  })

  it('reports an unknown location when the launch has no ComfyUI entry point', async () => {
    expect(await props(['--listen'])).toEqual({
      db_path_hash: null,
      user_dir_hash: null,
      base_dir_hash: null,
      db_path_rel: null,
      user_dir_rel: null,
      base_dir_rel: null,
      db_url_source: 'unknown'
    })
    expect((await props(undefined)).db_url_source).toBe('unknown')
  })
})

describe('relativeLocation', () => {
  const top = path.resolve('/')
  const installRoot = path.join(top, 'Users', 'Ada Lovelace', 'ComfyUI-Installs')
  const legacyRoot = path.join(top, 'Users', 'Ada Lovelace', 'Documents', 'ComfyUI')
  const roots: LocationRoots = {
    installRoots: [installRoot],
    installDirs: [undefined],
    legacyRoots: [legacyRoot, undefined]
  }

  it('names the install folder <install> whatever the user called it', async () => {
    expect(
      await relativeLocation(
        path.join(installRoot, 'My Secret Project', 'ComfyUI', 'user', 'comfyui.db'),
        roots
      )
    ).toBe('<install-root>/<install>/ComfyUI/user/comfyui.db')
    expect(await relativeLocation(path.join(installRoot, 'Ada (2)'), roots)).toBe(
      '<install-root>/<install>'
    )
    expect(await relativeLocation(installRoot, roots)).toBe('<install-root>')
  })

  it('keeps only fixed names under the legacy Desktop folder', async () => {
    expect(await relativeLocation(path.join(legacyRoot, 'user', 'comfyui.db'), roots)).toBe(
      '<legacy-root>/user/comfyui.db'
    )
  })

  it('sends outside_default for a location under no known root', async () => {
    expect(
      await relativeLocation(path.join(top, 'Users', 'Ada Lovelace', 'comfyui.db'), roots)
    ).toBe('outside_default')
    expect(
      await relativeLocation(`${installRoot}-other`, roots),
      'a sibling sharing the prefix'
    ).toBe('outside_default')
  })

  it('sends outside_default for any segment that is not a fixed name', async () => {
    expect(
      await relativeLocation(
        path.join(installRoot, 'inst', 'ComfyUI', 'backups', 'comfyui.db'),
        roots
      )
    ).toBe('outside_default')
    expect(await relativeLocation(path.join(legacyRoot, 'user', 'mine.db'), roots)).toBe(
      'outside_default'
    )
  })

  it("names the launching install's own folder <this-install>, wherever it lives", async () => {
    const custom = path.join(top, 'D', 'Ada stuff', 'comfy')
    expect(
      await relativeLocation(path.join(custom, 'ComfyUI', 'user'), {
        ...roots,
        installDirs: [custom]
      })
    ).toBe('<this-install>/ComfyUI/user')
    const own = path.join(installRoot, 'Mine')
    const withOwn = { ...roots, installDirs: [own] }
    expect(await relativeLocation(path.join(own, 'ComfyUI', 'user'), withOwn)).toBe(
      '<this-install>/ComfyUI/user'
    )
    expect(
      await relativeLocation(path.join(installRoot, 'Theirs', 'ComfyUI', 'user'), withOwn),
      'a sibling install reads differently'
    ).toBe('<install-root>/<install>/ComfyUI/user')
  })

  it('picks the deepest matching folder whatever the order of the roots', async () => {
    const own = path.join(legacyRoot, 'inst')
    expect(
      await relativeLocation(path.join(own, 'ComfyUI'), { ...roots, installDirs: [own] }),
      'the launching install inside the legacy folder, listed before it'
    ).toBe('<this-install>/ComfyUI')
  })

  it('prefers a legacy folder nested inside the install root', async () => {
    const nested = path.join(installRoot, 'old desktop')
    expect(
      await relativeLocation(path.join(nested, 'user', 'comfyui.db'), {
        ...roots,
        legacyRoots: [nested]
      })
    ).toBe('<legacy-root>/user/comfyui.db')
  })

  it('matches fixed names case-insensitively on Windows and macOS only', async () => {
    const p = path.join(installRoot, 'Inst', 'comfyui', 'User', 'ComfyUI.db')
    expect(await relativeLocation(p, roots, 'win32')).toBe(
      '<install-root>/<install>/ComfyUI/user/comfyui.db'
    )
    expect(await relativeLocation(p, roots, 'darwin')).toBe(
      '<install-root>/<install>/ComfyUI/user/comfyui.db'
    )
    expect(await relativeLocation(p, roots, 'linux')).toBe('outside_default')
  })

  it('has nothing to say without a location', async () => {
    expect(await relativeLocation(null, roots)).toBeNull()
  })
})

describe('dbUrlSource', () => {
  const cwd = path.join(path.resolve('/'), 'installs', 'one')
  const input = { cwd, layout: null, adoptedBaseDir: undefined }

  it('classifies from the args alone', () => {
    expect(dbUrlSource({ ...input, args: ['-s', 'main.py'] })).toBe('install_local')
    expect(dbUrlSource({ ...input, args: ['-s', 'main.py', '--user-directory', cwd] })).toBe(
      'user_override'
    )
    expect(dbUrlSource({ ...input, args: ['--listen'] })).toBe('unknown')
  })

  it('never throws on a malformed record', () => {
    const adoptedBaseDir = 42 as unknown as string
    expect(dbUrlSource({ ...input, args: ['-s', 'main.py'], adoptedBaseDir })).toBe('unknown')
  })
})

describe('boundedDbLocation', () => {
  const props = {
    db_path_hash: 'a',
    user_dir_hash: 'b',
    base_dir_hash: 'c',
    db_path_rel: null,
    user_dir_rel: null,
    base_dir_rel: null,
    db_url_source: 'install_local' as const
  }

  it('waits 500ms by default, and not a moment longer', async () => {
    vi.useFakeTimers()
    try {
      expect(DB_LOCATION_DEADLINE_MS).toBe(500)
      let settled: unknown
      void boundedDbLocation(() => new Promise(() => {})).then((r) => (settled = r))
      await vi.advanceTimersByTimeAsync(499)
      expect(settled, 'still waiting at 499ms').toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toEqual({ db_location_status: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the fields through, marked ok', async () => {
    expect(await boundedDbLocation(async () => props, 60_000)).toEqual({
      ...props,
      db_location_status: 'ok'
    })
  })

  it('reports a timeout, and nothing else, when the fields are late', async () => {
    expect(await boundedDbLocation(() => new Promise(() => {}), 10)).toEqual({
      db_location_status: 'timeout'
    })
  })

  it('runs computations one at a time, so overlapping launches never pile up work', async () => {
    let running = 0
    let most = 0
    const tracked = async () => {
      most = Math.max(most, ++running)
      await new Promise((resolve) => setImmediate(resolve))
      running--
      return props
    }
    const results = await Promise.all([
      boundedDbLocation(tracked, 60_000),
      boundedDbLocation(tracked, 60_000)
    ])
    expect(results.map((r) => r.db_location_status)).toEqual(['ok', 'ok'])
    expect(most, 'never two at once').toBe(1)
  })

  it('starts nothing behind a stuck computation, and drops what timed out waiting', async () => {
    let release: () => void = () => {}
    const hung = new Promise<typeof props>((resolve) => {
      release = () => resolve(props)
    })
    expect(await boundedDbLocation(() => hung, 10)).toEqual({ db_location_status: 'timeout' })

    const queued = vi.fn(async () => props)
    expect(await boundedDbLocation(queued, 10)).toEqual({ db_location_status: 'timeout' })
    expect(queued, 'no filesystem work while one is stuck').not.toHaveBeenCalled()

    release()
    await hung
    await new Promise((resolve) => setImmediate(resolve))
    expect(queued, 'not run late after its own deadline').not.toHaveBeenCalled()
    expect((await boundedDbLocation(async () => props, 60_000)).db_location_status, 'resumes').toBe(
      'ok'
    )
  })

  it('reports an error, and never throws, when computing them fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const thrown = (): Promise<typeof props> => {
      throw new Error('no documents folder')
    }
    expect(await boundedDbLocation(thrown)).toEqual({ db_location_status: 'error' })
    expect(await boundedDbLocation(() => Promise.reject(new Error('x')))).toEqual({
      db_location_status: 'error'
    })
    vi.restoreAllMocks()
  })
})
