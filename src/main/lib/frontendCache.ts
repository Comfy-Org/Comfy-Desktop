/**
 * Machine-wide cache of frontend builds a Core beta payload can pin (`coreBetaGrants.ts`).
 *
 * The build comes from PyPI's `comfyui-frontend-package` wheel, not Core's own
 * `--front-end-version` fetch. Core's fetch pages through the whole GitHub releases list with
 * unauthenticated API calls (~26 per cold resolve, against a 60/hour per-IP limit), caches
 * nothing on failure, and serves the release's `dist.zip`, which is not always the build PyPI
 * ships (v1.53.6's GitHub zip is an unminified dev-Firebase build). The wheel is the build Core
 * itself pins, is served from a CDN with no hourly quota, and PyPI publishes its sha256.
 *
 * Core is pointed at the extracted `static/` with `--front-end-root`, which it serves with no
 * network at all. It also refuses to START when that directory is missing, so a launch passes the
 * arg only for a version `cachedFrontendDir` has confirmed, and `pruneFrontendCache` never removes
 * the version the current payload grants.
 */
import fs from 'fs'
import path from 'path'
import { cacheDir } from './paths'
import { fetchJSON } from './fetch'
import { download, downloadMetaPath } from './download'
import { extract } from './extract'
import { sha256File } from './modelDownloadStaging'

export const FRONTEND_PACKAGE = 'comfyui-frontend-package'

const WHEEL_HOST = 'https://files.pythonhosted.org/'

/** Temp entries are dot-prefixed so no version lookup can ever match a half-built one. */
const TEMP_PREFIX = '.tmp-'

export function frontendCacheRoot(): string {
  return path.join(cacheDir(), 'frontend-cache')
}

/** The served directory for `version`, or `null` until a complete build is in place. Checked for
 *  `index.html`, not just existence: Core serves whatever directory it is given. */
export function cachedFrontendDir(version: string, root = frontendCacheRoot()): string | null {
  const dir = path.join(root, version)
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null
}

export type WheelInfo = { readonly url: string; readonly sha256: string; readonly size: number }

/**
 * The pure wheel for `version` from PyPI's `/pypi/<package>/<version>/json`, or `null`.
 *
 * Refuses rather than guesses: the release must be the one asked for, not yanked, and carry
 * exactly the expected `py3-none-any` wheel with a sha256, hosted on PyPI's file CDN.
 */
export function pickWheel(json: unknown, version: string): WheelInfo | null {
  if (!json || typeof json !== 'object') return null
  const { info, urls } = json as { info?: unknown; urls?: unknown }
  if (!info || typeof info !== 'object' || (info as { version?: unknown }).version !== version) {
    return null
  }
  if (!Array.isArray(urls)) return null
  const filename = `${FRONTEND_PACKAGE.replaceAll('-', '_')}-${version}-py3-none-any.whl`
  for (const entry of urls) {
    if (!entry || typeof entry !== 'object') continue
    const file = entry as Record<string, unknown>
    if (file.filename !== filename || file.packagetype !== 'bdist_wheel') continue
    if (file.yanked === true) return null
    const sha256 = (file.digests as { sha256?: unknown } | undefined)?.sha256
    if (typeof file.url !== 'string' || !file.url.startsWith(WHEEL_HOST)) return null
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
    return { url: file.url, sha256, size: typeof file.size === 'number' ? file.size : 0 }
  }
  return null
}

export type FrontendCacheDeps = {
  readonly fetchJSON: (url: string) => Promise<unknown>
  readonly download: (url: string, dest: string, size: number) => Promise<unknown>
  readonly sha256File: (file: string) => Promise<string>
  readonly extract: (archive: string, dest: string) => Promise<void>
}

const defaultDeps: FrontendCacheDeps = {
  fetchJSON: (url) => fetchJSON(url),
  download: (url, dest, size) =>
    download(url, dest, null, {
      ...(size > 0 ? { expectedSize: size } : {}),
      validateUrl: (u) => u.startsWith(WHEEL_HOST)
    }),
  sha256File,
  extract: (archive, dest) => extract(archive, dest)
}

async function fetchIntoCache(
  version: string,
  root: string,
  deps: FrontendCacheDeps
): Promise<string> {
  const json = await deps.fetchJSON(`https://pypi.org/pypi/${FRONTEND_PACKAGE}/${version}/json`)
  const wheel = pickWheel(json, version)
  if (wheel === null) throw new Error(`no usable ${FRONTEND_PACKAGE} ${version} wheel on PyPI`)

  const stamp = `${TEMP_PREFIX}${version}-${process.pid}-${Date.now()}`
  const wheelPath = path.join(root, `${stamp}.whl`)
  const extractDir = path.join(root, stamp)
  try {
    await fs.promises.mkdir(root, { recursive: true })
    await deps.download(wheel.url, wheelPath, wheel.size)
    const actual = await deps.sha256File(wheelPath)
    if (actual !== wheel.sha256) {
      throw new Error(`${FRONTEND_PACKAGE} ${version} sha256 mismatch: got ${actual}`)
    }
    await deps.extract(wheelPath, extractDir)
    const staticDir = path.join(extractDir, 'comfyui_frontend_package', 'static')
    if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
      throw new Error(`${FRONTEND_PACKAGE} ${version} wheel has no static/index.html`)
    }
    // Same volume as the target, so the build appears whole or not at all.
    const target = path.join(root, version)
    try {
      await fs.promises.rename(staticDir, target)
    } catch (err) {
      // Another fetch of the same version won the rename; its copy is as good as ours.
      if (cachedFrontendDir(version, root) === null) throw err
    }
    return target
  } finally {
    await fs.promises.rm(wheelPath, { force: true }).catch(() => {})
    await fs.promises.rm(downloadMetaPath(wheelPath), { force: true }).catch(() => {})
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {})
  }
}

const inFlight = new Map<string, Promise<string | null>>()

/**
 * Put `version` in the cache if it is not there yet; resolves to its directory, or `null` on any
 * failure (logged, never thrown, so a background caller cannot surface an unhandled rejection).
 * Concurrent calls for one version share one download.
 */
export function prefetchFrontend(
  version: string,
  root = frontendCacheRoot(),
  deps: FrontendCacheDeps = defaultDeps
): Promise<string | null> {
  const cached = cachedFrontendDir(version, root)
  if (cached !== null) return Promise.resolve(cached)
  const key = path.join(root, version)
  const pending = inFlight.get(key)
  if (pending) return pending
  const run = fetchIntoCache(version, root, deps)
    .then((dir) => {
      console.log(`[core-beta] frontend ${version} cached from PyPI`)
      return dir
    })
    .catch((err: unknown) => {
      console.log(`[core-beta] frontend ${version} prefetch failed: ${(err as Error).message}`)
      return null
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, run)
  return run
}

/**
 * Remove every cached build except `keep`, plus leftovers of interrupted fetches.
 *
 * Run from the same background task that prefetches `keep`, and launches only ever serve the
 * version the current payload grants, so the directory a launch is about to pass is never the
 * one being removed. A version from an earlier payload that an already-running Core still serves
 * would be, which is why this runs at app start rather than on a payload change mid-session.
 */
export async function pruneFrontendCache(
  keep: string | null,
  root = frontendCacheRoot()
): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.promises.readdir(root)
  } catch {
    return
  }
  const stale = entries.filter(
    (name) => name !== keep && !(name.startsWith(TEMP_PREFIX) && inFlightUnder(root))
  )
  await Promise.all(
    stale.map((name) =>
      fs.promises.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {})
    )
  )
}

function inFlightUnder(root: string): boolean {
  for (const key of inFlight.keys()) if (path.dirname(key) === root) return true
  return false
}

/**
 * App-start upkeep: drop every build but `version`, then fetch `version` if it is missing.
 * `version` is `null` when no grant applies to this user (none served, or beta switched off),
 * which prunes everything. Never throws.
 */
export async function syncFrontendCache(version: string | null): Promise<void> {
  try {
    await pruneFrontendCache(version)
    if (version !== null) await prefetchFrontend(version)
  } catch (err) {
    console.log(`[core-beta] frontend cache upkeep failed: ${(err as Error).message}`)
  }
}

export function _resetForTest(): void {
  inFlight.clear()
}
