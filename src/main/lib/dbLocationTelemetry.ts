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
  type ComfyPaths,
  type DefaultDbLayout
} from './comfyDbLock'
import { configDir } from './paths'
import { coreSemver, coreSemverExact, coreSemverVerified, coreVerifiedSemver } from './version'

const KEY_FILE = 'telemetry-path-key'
const KEY_RE = /^[0-9a-f]{64}$/
/** The release that moved ComfyUI's default database into the effective user directory. */
const USER_DIR_DB_SINCE = '0.34.0'

/** The key load every caller shares; cleared when it yields no key, so a later launch retries. */
let keyLoad: Promise<Buffer | null> | null = null
/** The most recently queued location computation. Computations run one at a time. */
let lastComputation: Promise<unknown> = Promise.resolve()

/** @internal - exposed for tests. */
export function _resetForTest(): void {
  keyLoad = null
  lastComputation = Promise.resolve()
}

async function readKey(file: string): Promise<Buffer | null> {
  const text = (await fs.promises.readFile(file, 'utf8')).trim()
  return KEY_RE.test(text) ? Buffer.from(text, 'hex') : null
}

/**
 * The per-user key, created on first use. Null (and retried next time) when unavailable. One
 * load is shared by every caller, so two can never both repair a malformed key and leave this
 * session hashing with a key that is not the one on disk.
 */
function pathHashKey(): Promise<Buffer | null> {
  keyLoad ??= loadKey()
    .catch(() => null)
    .then((key) => {
      if (!key) keyLoad = null
      return key
    })
  return keyLoad
}

async function loadKey(): Promise<Buffer | null> {
  const file = path.join(configDir(), KEY_FILE)
  try {
    const existing = await readKey(file)
    if (existing) return existing
    // A malformed key never produced a hash, so replacing it loses nothing.
    await fs.promises.rm(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null
  }
  // Written whole to a fresh, exclusively created name beside the key, then linked into place: a
  // write that fails partway can never leave a partial key behind, and a key another process
  // linked first is never overwritten.
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(tmp, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
    await fs.promises.link(tmp, file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null
  } finally {
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
  }
  try {
    return await readKey(file)
  } catch {
    return null
  }
}

const foldsCase = (platform: NodeJS.Platform): boolean =>
  platform === 'win32' || platform === 'darwin'

/**
 * One spelling per location: absolute, symlinks resolved through the deepest part that exists
 * (the database may not exist before the first boot), `/` separators, and case-folded on
 * Windows and macOS, whose default filesystems ignore case. Resolution and separators follow
 * the host; `platform` only selects the case folding.
 *
 * Asynchronous, so a stalled network mount never blocks the main process; callers bound it
 * with a deadline. Null when a part cannot be resolved for any reason other than not existing
 * yet (a permission error, a symlink loop): the location is then unknown, not guessed.
 */
export async function canonicalPath(
  p: string,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  let head = path.resolve(p)
  const tail: string[] = []
  for (;;) {
    try {
      head = await fs.promises.realpath(head)
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null
      const parent = path.dirname(head)
      if (parent === head) break
      tail.unshift(path.basename(head))
      head = parent
    }
  }
  return spelling(path.join(head, ...tail), platform)
}

/**
 * @internal - exposed for tests. The resolved path in one spelling: `/` separators where the host
 * separator is `\\` (elsewhere `\\` is an ordinary name character), and case-folded for a
 * `platform` whose filesystems ignore case.
 */
export function spelling(
  resolved: string,
  platform: NodeJS.Platform,
  separator: string = path.sep
): string {
  const out = separator === '\\' ? resolved.replace(/\\/g, '/') : resolved
  return foldsCase(platform) ? out.toLowerCase() : out
}

async function hashCanonical(canonical: string | null): Promise<string | null> {
  if (!canonical) return null
  const key = await pathHashKey()
  if (!key) return null
  return createHmac('sha256', key).update(canonical).digest('hex').slice(0, 16)
}

/** Keyed, truncated hash of a path; null when there is no key or no path. */
export async function hashPath(p: string | null): Promise<string | null> {
  return hashCanonical(p ? await canonicalPath(p) : null)
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

/** A root, or none when it cannot be found: an unknown root only costs its label. */
export function optionalRoot(get: () => string): string | undefined {
  try {
    return get()
  } catch {
    return undefined
  }
}

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
 * `<this-install>/ComfyUI/user/comfyui.db`, or `<install-root>/<install>/...` under a folder
 * directly in the install root (normally another install). That folder is always `<install>`,
 * since Desktop names it after the user's install name, and every other segment must be a fixed
 * name, or the whole answer is {@link OUTSIDE_DEFAULT}. Null only when there is no location to
 * describe.
 */
export async function relativeLocation(
  p: string | null,
  roots: LocationRoots,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  return labelCanonical(p, roots, (q) => canonicalPath(q, platform), platform)
}

async function labelCanonical(
  p: string | null,
  roots: LocationRoots,
  canonical: (p: string) => Promise<string | null>,
  platform: NodeJS.Platform
): Promise<string | null> {
  if (!p) return null
  const target = await canonical(p)
  if (!target) return null
  const anchors = [
    ...roots.installRoots.map((root) => ({ root, label: ['<install-root>'], named: true })),
    ...roots.installDirs.map((root) => ({ root, label: ['<this-install>'], named: false })),
    ...roots.legacyRoots.map((root) => ({ root, label: ['<legacy-root>'], named: false }))
  ]
  let best: { rootLength: number; label: string[]; rest: string[]; named: boolean } | null = null
  for (const anchor of anchors) {
    if (!anchor.root) continue
    const root = await canonical(anchor.root)
    if (!root) continue
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

/** What a launch's location is worked out from: its final spawn args and Desktop's own pins. */
export interface LocationInput {
  cwd: string | undefined
  args: readonly string[] | undefined
  layout: DefaultDbLayout
  adoptedBaseDir: string | undefined
}

/**
 * The launch's paths, and where its location came from. No I/O. `adopted_legacy` is Desktop's own
 * pin for an adopted install ({@link adoptedPinArgs}), with the database either at the pinned
 * file or unset (a core without a database drops that pin). Any other location flag came from
 * the user, since Desktop sets none elsewhere. Null (an `unknown` location) without a ComfyUI
 * entry point, or when a location flag is abbreviated.
 */
function locate(input: LocationInput): { paths: ComfyPaths; source: DbUrlSource } | null {
  const args = input.args
  const paths =
    input.cwd && args && !abbreviatesLocationFlag(args)
      ? resolveComfyPaths(input.cwd, args, input.layout)
      : null
  if (!paths) return null
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
  return { paths, source }
}

/**
 * `db_url_source` alone. It needs no I/O, so it is sent even when the rest timed out. Never
 * throws: it runs on the launch path outside the deadline's error handling.
 */
export function dbUrlSource(input: LocationInput): DbUrlSource {
  try {
    return locate(input)?.source ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The `boot_started` location fields for the args a launch spawns with. */
export async function dbLocationProps(
  input: LocationInput & {
    /** Whether the core is known to take `--database-url` (ComfyUI had no database before it). */
    hasDatabase: boolean
    roots: LocationRoots
  }
): Promise<DbLocationProps> {
  const located = locate(input)
  if (!located) {
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
  const { paths, source } = located
  // SQLAlchemy reads `?…` as connection options, not part of the file name; rather than guess
  // which file such a URL opens, its database goes unreported.
  const dbPath = input.hasDatabase && !paths.dbPath?.includes('?') ? paths.dbPath : null
  // Each distinct path is resolved once, and one at a time: a stalled mount then holds a single
  // filesystem worker thread rather than all of them.
  const resolved = new Map<string, string | null>()
  const canonical = async (q: string): Promise<string | null> => {
    if (!resolved.has(q)) resolved.set(q, await canonicalPath(q))
    return resolved.get(q)!
  }
  const hash = async (q: string | null) => await hashCanonical(q ? await canonical(q) : null)
  const label = (q: string | null) => labelCanonical(q, input.roots, canonical, process.platform)
  return {
    db_path_hash: await hash(dbPath),
    user_dir_hash: await hash(paths.userDir),
    base_dir_hash: await hash(paths.baseDir),
    db_path_rel: await label(dbPath),
    user_dir_rel: await label(paths.userDir),
    base_dir_rel: await label(paths.baseDir),
    db_url_source: source
  }
}

/**
 * How long a launch waits for its location before `boot_started` goes without it. Resolving a
 * handful of local paths takes milliseconds, and a healthy network share answers in tens of
 * them; past half a second a mount is stalled, and a launch should not wait on telemetry longer
 * than that. Timeouts are reported, so a rate worth revisiting shows up in the data.
 */
export const DB_LOCATION_DEADLINE_MS = 500

export type DbLocationStatus = 'ok' | 'timeout' | 'error'

/**
 * The location fields, or only a `db_location_status` of `timeout` or `error` when they could
 * not be had in time. Never rejects.
 */
export async function boundedDbLocation(
  compute: () => Promise<DbLocationProps>,
  deadlineMs: number = DB_LOCATION_DEADLINE_MS
): Promise<Partial<DbLocationProps> & { db_location_status: DbLocationStatus }> {
  // Computations run one at a time. A timed-out one keeps running, because its filesystem call
  // cannot be cancelled and holds a worker thread; launches queued behind it time out without
  // starting any filesystem work, and are skipped once their own deadline has passed. So a
  // stalled mount holds at most one worker however many launches hit it.
  let expired = false
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<{ db_location_status: 'timeout' }>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve({ db_location_status: 'timeout' })
    }, deadlineMs)
  })
  const computed = lastComputation
    .then(() => (expired ? null : compute()))
    .then(
      (props) =>
        props
          ? { ...props, db_location_status: 'ok' as const }
          : { db_location_status: 'timeout' as const },
      (err: unknown) => {
        console.warn('[launch] database location for telemetry unavailable:', err)
        return { db_location_status: 'error' as const }
      }
    )
  lastComputation = computed
  try {
    return await Promise.race([computed, timeout])
  } finally {
    clearTimeout(timer)
  }
}
