import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallationRecord } from '../installations'

const dirs = vi.hoisted(() => ({ config: '' }))
vi.mock('./paths', () => ({ configDir: () => dirs.config }))

import {
  _resetKeyForTest,
  canonicalPath,
  dbLocationProps,
  defaultDbLayout,
  hashPath,
  relativeLocation,
  type LocationRoots
} from './dbLocationTelemetry'

let tmp: string

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'db-location-')))
  dirs.config = path.join(tmp, 'config')
  _resetKeyForTest()
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const keyFile = (): string => path.join(dirs.config, 'telemetry-path-key')

describe('hashPath', () => {
  it('is a 16-hex keyed digest, stable for one path and distinct across paths', () => {
    const a = hashPath(path.join(tmp, 'a', 'comfyui.db'))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(hashPath(path.join(tmp, 'a', 'comfyui.db'))).toBe(a)
    expect(hashPath(path.join(tmp, 'b', 'comfyui.db'))).not.toBe(a)
    expect(hashPath(null)).toBeNull()
  })

  it('hashes every spelling of one location the same', () => {
    const real = path.join(tmp, 'install', 'user')
    fs.mkdirSync(real, { recursive: true })
    fs.symlinkSync(path.join(tmp, 'install'), path.join(tmp, 'link'), 'junction')
    const h = hashPath(real)
    expect(hashPath(`${real}${path.sep}`)).toBe(h)
    expect(hashPath(path.join(tmp, 'install', 'x', '..', 'user'))).toBe(h)
    expect(hashPath(path.join(tmp, 'link', 'user')), 'through a symlink').toBe(h)
    expect(
      hashPath(path.join(tmp, 'link', 'user', 'comfyui.db')),
      'a file that does not exist yet, below a symlink'
    ).toBe(hashPath(path.join(real, 'comfyui.db')))
  })

  it('creates the key once, private to the user, and reuses it after a restart', () => {
    const h = hashPath(tmp)
    const key = fs.readFileSync(keyFile(), 'utf8')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    if (process.platform !== 'win32') expect(fs.statSync(keyFile()).mode & 0o777).toBe(0o600)
    _resetKeyForTest()
    expect(hashPath(tmp)).toBe(h)
    expect(fs.readFileSync(keyFile(), 'utf8')).toBe(key)
  })

  it('changes with the key, so hashes cannot be compared across users', () => {
    const h = hashPath(tmp)
    fs.rmSync(keyFile())
    _resetKeyForTest()
    expect(hashPath(tmp)).not.toBe(h)
  })

  it('sends nothing when the key is unusable', () => {
    fs.mkdirSync(dirs.config, { recursive: true })
    fs.writeFileSync(keyFile(), 'not-a-key')
    expect(hashPath(tmp), 'a corrupt key is not replaced').toBeNull()
    expect(fs.readFileSync(keyFile(), 'utf8')).toBe('not-a-key')

    _resetKeyForTest()
    fs.rmSync(keyFile())
    const link = vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' })
    })
    expect(hashPath(tmp), 'the key could not be stored').toBeNull()
    expect(fs.readdirSync(dirs.config), 'a failed write leaves nothing behind').toEqual([])
    link.mockRestore()
    expect(hashPath(tmp), 'and the next launch creates the key').toMatch(/^[0-9a-f]{16}$/)

    _resetKeyForTest()
    dirs.config = path.join(tmp, 'a-file')
    fs.writeFileSync(dirs.config, '')
    expect(hashPath(tmp), 'the key cannot be created').toBeNull()
  })
})

describe('canonicalPath', () => {
  it('folds case on Windows only', () => {
    const p = path.join(tmp, 'Missing', 'Comfy.DB')
    expect(canonicalPath(p, 'win32')).toBe(p.replace(/\\/g, '/').toLowerCase())
    expect(canonicalPath(p, 'linux')).toBe(p.replace(/\\/g, '/'))
  })
})

describe('defaultDbLayout', () => {
  const inst = (comfyVersion: object): InstallationRecord =>
    ({ comfyVersion }) as unknown as InstallationRecord

  it('reads the user-directory default from a release the install provably contains', () => {
    expect(defaultDbLayout(inst({ baseTag: 'v0.34.0', baseTagVerified: true }))).toBe('user_dir')
    expect(
      defaultDbLayout(inst({ baseTag: 'v0.35.1', ancestorTag: 'v0.34.2', commitsAhead: 3 }))
    ).toBe('user_dir')
  })

  it('reads the fixed default only on an install sitting exactly on an older tag', () => {
    expect(defaultDbLayout(inst({ baseTag: 'v0.33.9', commitsAhead: 0 }))).toBe('comfy_dir')
    expect(defaultDbLayout(inst({ baseTag: 'v0.33.9', commitsAhead: 4 }))).toBeNull()
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

  it('hashes ComfyUI defaults for a managed install', () => {
    expect(props(['-s', main, '--listen'])).toEqual({
      db_path_hash: hashPath(path.join(comfy, 'user', 'comfyui.db')),
      user_dir_hash: hashPath(path.join(comfy, 'user')),
      base_dir_hash: hashPath(comfy),
      db_path_rel: '<install-root>/<install>/ComfyUI/user/comfyui.db',
      user_dir_rel: '<install-root>/<install>/ComfyUI/user',
      base_dir_rel: '<install-root>/<install>/ComfyUI',
      db_url_source: 'install_local'
    })
  })

  it("recognises Desktop's own pin for an adopted install", () => {
    expect(props(['-s', main, ...adoptPins], legacy)).toEqual({
      db_path_hash: hashPath(path.join(legacy, 'user', 'comfyui.db')),
      user_dir_hash: hashPath(path.join(legacy, 'user')),
      base_dir_hash: hashPath(legacy),
      db_path_rel: '<legacy-root>/user/comfyui.db',
      user_dir_rel: '<legacy-root>/user',
      base_dir_rel: '<legacy-root>',
      db_url_source: 'adopted_legacy'
    })
  })

  it('keeps the adopted label when a core without a database dropped the database pin', () => {
    const p = dbLocationProps({
      cwd,
      args: ['-s', main, ...adoptPins.slice(0, 4)],
      layout: null,
      hasDatabase: false,
      adoptedBaseDir: legacy,
      roots
    })
    expect(p.db_path_hash, 'no database to hash').toBeNull()
    expect(p.db_path_rel).toBeNull()
    expect(p.user_dir_hash).toBe(hashPath(path.join(legacy, 'user')))
    expect(p.db_url_source).toBe('adopted_legacy')
  })

  it("lets the user's own database URL win over the adopted pin", () => {
    const mine = path.join(path.resolve('/'), 'mine.db')
    const p = props(['-s', main, ...adoptPins, '--database-url', `sqlite:///${mine}`], legacy)
    expect(p.db_path_hash).toBe(hashPath(mine))
    expect(p.db_path_rel).toBe('outside_default')
    expect(p.db_url_source).toBe('user_override')
  })

  it('sends no database hash unless the core is known to have a database', () => {
    for (const hasDatabase of [false, null]) {
      const p = dbLocationProps({
        cwd,
        args: ['-s', main],
        layout: null,
        hasDatabase,
        adoptedBaseDir: undefined,
        roots
      })
      expect(p.db_path_hash).toBeNull()
      expect(p.db_path_rel).toBeNull()
      expect(p.base_dir_hash).toBe(hashPath(comfy))
    }
  })

  it("lets the user's own location args win over the adopted pin", () => {
    const mine = path.join(path.resolve('/'), 'mine')
    const p = props(['-s', main, ...adoptPins, `--base-directory=${mine}`], legacy)
    expect(p.base_dir_hash).toBe(hashPath(mine))
    expect(p.db_url_source).toBe('user_override')
  })

  it("lets the user's own user directory win over the adopted pin", () => {
    const mine = path.join(path.resolve('/'), 'mine', 'user')
    const p = props(['-s', main, ...adoptPins, '--user-directory', mine], legacy)
    expect(p.user_dir_hash).toBe(hashPath(mine))
    expect(p.db_url_source).toBe('user_override')
  })

  it('marks a user database URL as an override and hashes no non-file database', () => {
    const p = props(['-s', main, '--database-url', 'sqlite:///:memory:'])
    expect(p.db_path_hash).toBeNull()
    expect(p.user_dir_hash).toBe(hashPath(path.join(comfy, 'user')))
    expect(p.db_url_source).toBe('user_override')
  })

  it('sends no database hash when the default depends on an unknown core version', () => {
    const userDir = path.join(path.resolve('/'), 'data', 'user')
    const args = ['-s', main, '--user-directory', userDir]
    expect(props(args).db_path_hash).toBeNull()
    expect(props(args).user_dir_hash).toBe(hashPath(userDir))
    expect(
      dbLocationProps({
        cwd,
        args,
        layout: 'user_dir',
        hasDatabase: true,
        adoptedBaseDir: undefined,
        roots
      })
    ).toEqual(expect.objectContaining({ db_path_hash: hashPath(path.join(userDir, 'comfyui.db')) }))
  })

  it('reports an unknown location when the launch has no ComfyUI entry point', () => {
    expect(props(['--listen'])).toEqual({
      db_path_hash: null,
      user_dir_hash: null,
      base_dir_hash: null,
      db_path_rel: null,
      user_dir_rel: null,
      base_dir_rel: null,
      db_url_source: 'unknown'
    })
    expect(props(undefined).db_url_source).toBe('unknown')
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

  it('names the install folder <install> whatever the user called it', () => {
    expect(
      relativeLocation(
        path.join(installRoot, 'My Secret Project', 'ComfyUI', 'user', 'comfyui.db'),
        roots
      )
    ).toBe('<install-root>/<install>/ComfyUI/user/comfyui.db')
    expect(relativeLocation(path.join(installRoot, 'Ada (2)'), roots)).toBe(
      '<install-root>/<install>'
    )
    expect(relativeLocation(installRoot, roots)).toBe('<install-root>')
  })

  it('keeps only fixed names under the legacy Desktop folder', () => {
    expect(relativeLocation(path.join(legacyRoot, 'user', 'comfyui.db'), roots)).toBe(
      '<legacy-root>/user/comfyui.db'
    )
  })

  it('sends outside_default for a location under no known root', () => {
    expect(relativeLocation(path.join(top, 'Users', 'Ada Lovelace', 'comfyui.db'), roots)).toBe(
      'outside_default'
    )
    expect(relativeLocation(`${installRoot}-other`, roots), 'a sibling sharing the prefix').toBe(
      'outside_default'
    )
  })

  it('sends outside_default for any segment that is not a fixed name', () => {
    expect(
      relativeLocation(path.join(installRoot, 'inst', 'ComfyUI', 'backups', 'comfyui.db'), roots)
    ).toBe('outside_default')
    expect(relativeLocation(path.join(legacyRoot, 'user', 'mine.db'), roots)).toBe(
      'outside_default'
    )
  })

  it("anchors on the deepest root, so the launching install's folder is <install> too", () => {
    const custom = path.join(top, 'D', 'Ada stuff', 'comfy')
    expect(
      relativeLocation(path.join(custom, 'ComfyUI', 'user'), { ...roots, installDirs: [custom] })
    ).toBe('<install-root>/<install>/ComfyUI/user')
  })

  it('prefers a legacy folder nested inside the install root', () => {
    const nested = path.join(installRoot, 'old desktop')
    expect(
      relativeLocation(path.join(nested, 'user', 'comfyui.db'), { ...roots, legacyRoots: [nested] })
    ).toBe('<legacy-root>/user/comfyui.db')
  })

  it('matches fixed names case-insensitively on Windows only', () => {
    const p = path.join(installRoot, 'Inst', 'comfyui', 'User', 'ComfyUI.db')
    expect(relativeLocation(p, roots, 'win32')).toBe(
      '<install-root>/<install>/ComfyUI/user/comfyui.db'
    )
    expect(relativeLocation(p, roots, 'linux')).toBe('outside_default')
  })

  it('has nothing to say without a location', () => {
    expect(relativeLocation(null, roots)).toBeNull()
  })
})
