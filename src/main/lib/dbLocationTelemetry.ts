/**
 * Where a launched ComfyUI keeps its database, user directory and base directory, as telemetry
 * may carry it: keyed hashes, and a path relative to a folder Desktop knows that keeps only fixed
 * folder names. Never a path a user named.
 *
 * Two installs that share one asset database interfere (one install's startup prune marks the
 * other's rows missing), and nothing else in telemetry can tell that two launches opened the
 * same file. Equal hashes can.
 *
 * The hash is an HMAC keyed by a random secret kept in this OS user's config directory and never
 * sent. Every install that this user's Desktop launches shares the key, so equal paths compare
 * equal across their installs. Without the key a hash can't be checked against a guessed path
 * (paths carry usernames), and hashes from two users can't be compared. A fixed salt in the
 * binary would allow both. If the key can't be read or created, no hash is sent; a malformed key
 * is replaced.
 */
import { createHmac, randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import semver from 'semver'
import type { InstallationRecord } from '../installations'
import {
  abbreviatesLocationFlag,
  adoptedPinArgs,
  hasFlag,
  hasLocationFlag,
  resolveComfyPaths,
  type DefaultDbLayout
} from './comfyDbLock'
import { configDir } from './paths'
import { coreSemver, coreSemverExact, coreSemverVerified, coreVerifiedSemver } from './version'

const KEY_FILE = 'telemetry-path-key'
const KEY_RE = /^[0-9a-f]{64}$/
/** The release that moved ComfyUI's default database into the effective user directory. */
const USER_DIR_DB_SINCE = '0.34.0'

let cachedKey: Buffer | null = null

/** @internal - exposed for tests. */
export function _resetKeyForTest(): void {
  cachedKey = null
}

function readKey(file: string): Buffer | null {
  const text = fs.readFileSync(file, 'utf8').trim()
  return KEY_RE.test(text) ? Buffer.from(text, 'hex') : null
}

/** The per-user key, created on first use. Null (and retried next time) when unavailable. */
function pathHashKey(): Buffer | null {
  if (cachedKey) return cachedKey
  const file = path.join(configDir(), KEY_FILE)
  try {
    cachedKey = readKey(file)
    if (cachedKey) return cachedKey
    // A malformed key never produced a hash, so replacing it loses nothing.
    fs.rmSync(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null
  }
  // Written whole to a fresh, exclusively created name beside the key, then linked into place: a
  // write that fails partway can never leave a partial key behind, and a key another process
  // linked first is never overwritten.
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
    fs.linkSync(tmp, file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null
  } finally {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {}
  }
  try {
    cachedKey = readKey(file)
  } catch {}
  return cachedKey
}

const foldsCase = (platform: NodeJS.Platform): boolean =>
  platform === 'win32' || platform === 'darwin'

/**
 * One spelling per location: absolute, symlinks resolved through the deepest part that exists
 * (the database may not exist before the first boot), `/` separators, and case-folded on
 * Windows and macOS, whose default filesystems ignore case. `platform` only selects the case
 * folding; resolution always follows the host.
 */
export function canonicalPath(p: string, platform: NodeJS.Platform = process.platform): string {
  let head = path.resolve(p)
  const tail: string[] = []
  for (;;) {
    try {
      head = fs.realpathSync.native(head)
      break
    } catch {
      const parent = path.dirname(head)
      if (parent === head) break
      tail.unshift(path.basename(head))
      head = parent
    }
  }
  const out = path.join(head, ...tail).replace(/\\/g, '/')
  return foldsCase(platform) ? out.toLowerCase() : out
}

/** Keyed, truncated hash of a path; null when there is no key or no path. */
export function hashPath(p: string | null): string | null {
  if (!p) return null
  const key = pathHashKey()
  if (!key) return null
  return createHmac('sha256', key).update(canonicalPath(p)).digest('hex').slice(0, 16)
}

/**
 * Which side of v0.34.0's database move the install's core is on. A tag the install provably
 * contains at or past it settles `user_dir`; only an install sitting exactly on a verified older
 * tag settles `comfy_dir`, because code past an older tag may already include the move.
 */
export function defaultDbLayout(inst: InstallationRecord): DefaultDbLayout {
  const floor = coreVerifiedSemver(inst)
  if (floor && semver.gte(floor, USER_DIR_DB_SINCE)) return 'user_dir'
  const label = coreSemver(inst)
  if (
    label &&
    coreSemverExact(inst) &&
    coreSemverVerified(inst) &&
    semver.lt(label, USER_DIR_DB_SINCE)
  ) {
    return 'comfy_dir'
  }
  return null
}

/** The answer for a location under no known root, or with any segment that is not fixed. */
const OUTSIDE_DEFAULT = 'outside_default'

/** Folder names ComfyUI and Desktop choose, never the user; nothing else is ever sent. */
const FIXED_SEGMENTS = ['ComfyUI', 'user', 'comfyui.db']

/** Folders Desktop knows, against which a location can be named without naming the user. */
export interface LocationRoots {
  /** Parents of installs, whose child folder is named after the user's install name. */
  installRoots: readonly (string | undefined)[]
  /** The launching install's own folder, named `<this-install>`. */
  installDirs: readonly (string | undefined)[]
  /** Legacy Desktop base folders: its default, and an adopted install's own. */
  legacyRoots: readonly (string | undefined)[]
}

/**
 * A location as a readable path relative to the deepest known root, e.g.
 * `<this-install>/ComfyUI/user/comfyui.db`, or `<install-root>/<install>/...` for another
 * install. That install folder is always `<install>` (it is the user's install name), and every
 * other segment must be a fixed name, or the whole answer is {@link OUTSIDE_DEFAULT}. Null only
 * when there is no location to describe.
 */
export function relativeLocation(
  p: string | null,
  roots: LocationRoots,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!p) return null
  const target = canonicalPath(p, platform)
  const anchors = [
    ...roots.installRoots.map((root) => ({ root, label: ['<install-root>'], named: true })),
    ...roots.installDirs.map((root) => ({ root, label: ['<this-install>'], named: false })),
    ...roots.legacyRoots.map((root) => ({ root, label: ['<legacy-root>'], named: false }))
  ]
  let best: { rootLength: number; label: string[]; rest: string[]; named: boolean } | null = null
  for (const anchor of anchors) {
    if (!anchor.root) continue
    const root = canonicalPath(anchor.root, platform)
    const prefix = root.endsWith('/') ? root : `${root}/`
    if (target !== root && !target.startsWith(prefix)) continue
    if (best && best.rootLength >= root.length) continue
    const rest = target === root ? [] : target.slice(prefix.length).split('/')
    best = { rootLength: root.length, label: anchor.label, rest, named: anchor.named }
  }
  if (!best) return OUTSIDE_DEFAULT
  const out = [...best.label]
  const rest = [...best.rest]
  if (best.named && rest.length > 0) {
    rest.shift()
    out.push('<install>')
  }
  for (const segment of rest) {
    const fixed = FIXED_SEGMENTS.find(
      (f) => (foldsCase(platform) ? f.toLowerCase() : f) === segment
    )
    if (!fixed) return OUTSIDE_DEFAULT
    out.push(fixed)
  }
  return out.join('/')
}

export type DbUrlSource = 'install_local' | 'adopted_legacy' | 'user_override' | 'unknown'

export interface DbLocationProps {
  db_path_hash: string | null
  user_dir_hash: string | null
  base_dir_hash: string | null
  db_path_rel: string | null
  user_dir_rel: string | null
  base_dir_rel: string | null
  db_url_source: DbUrlSource
}

/**
 * The `boot_started` location fields for the args a launch spawns with. `adopted_legacy` is
 * Desktop's own pin for an adopted install ({@link adoptedPinArgs}), with the database either at
 * the pinned file or unset (a core without a database drops that pin). Any other location flag
 * came from the user, since Desktop sets none elsewhere. An abbreviated location flag makes the
 * whole location `unknown`.
 */
export function dbLocationProps(input: {
  cwd: string | undefined
  args: readonly string[] | undefined
  layout: DefaultDbLayout
  /** Whether the core is known to take `--database-url` (ComfyUI had no database before it). */
  hasDatabase: boolean
  adoptedBaseDir: string | undefined
  roots: LocationRoots
}): DbLocationProps {
  const args = input.args
  const paths =
    input.cwd && args && !abbreviatesLocationFlag(args)
      ? resolveComfyPaths(input.cwd, args, input.layout)
      : null
  if (!paths) {
    return {
      db_path_hash: null,
      user_dir_hash: null,
      base_dir_hash: null,
      db_path_rel: null,
      user_dir_rel: null,
      base_dir_rel: null,
      db_url_source: 'unknown'
    }
  }
  const pin =
    input.adoptedBaseDir &&
    resolveComfyPaths(
      input.cwd!,
      ['-s', 'main.py', ...adoptedPinArgs(input.adoptedBaseDir, true)],
      null
    )
  const source: DbUrlSource =
    pin &&
    paths.baseDir === pin.baseDir &&
    paths.userDir === pin.userDir &&
    (!hasFlag(args!, '--database-url') || paths.dbPath === pin.dbPath)
      ? 'adopted_legacy'
      : hasLocationFlag(args!)
        ? 'user_override'
        : 'install_local'
  const dbPath = input.hasDatabase ? paths.dbPath : null
  return {
    db_path_hash: hashPath(dbPath),
    user_dir_hash: hashPath(paths.userDir),
    base_dir_hash: hashPath(paths.baseDir),
    db_path_rel: relativeLocation(dbPath, input.roots),
    user_dir_rel: relativeLocation(paths.userDir, input.roots),
    base_dir_rel: relativeLocation(paths.baseDir, input.roots),
    db_url_source: source
  }
}
