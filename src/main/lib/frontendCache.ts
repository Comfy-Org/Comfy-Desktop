/**
 * A campaign can pin the frontend ComfyUI serves: beside its grants, its payload may carry
 * `frontend: { url, sha256 }`, a `.whl` (the `comfyui-frontend-package` wheel, as on PyPI) or
 * `.zip` (a built `dist`) on a trusted host (`trustedArtifactUrls.ts`), which Desktop downloads,
 * checks and extracts into a machine-wide cache.
 * A launch a campaign applied passes `--front-end-root <cached build>`, which ComfyUI serves with
 * no network. ComfyUI refuses to START when that directory is missing, so the arg is passed only
 * for a build already on disk; a launch that beats the download serves the bundled frontend.
 *
 * Builds are keyed by their sha256, so a cached directory can only ever hold the bytes the payload
 * named, and a new build behind the same URL is a new entry.
 */
import fs from 'fs'
import path from 'path'
import { cacheDir } from './paths'
import { download, downloadMetaPath } from './download'
import { extract } from './extract'
import { sha256File } from './modelDownloadStaging'
import { isTrustedArtifactUrl } from './trustedArtifactUrls'
import type { ComfyArgsSchema } from './comfy-args'
import type { CampaignAnswer, CampaignApplied, CampaignRecords } from './coreBetaCampaigns'

const FRONTEND_PAYLOAD_FIELD = 'frontend'

export interface FrontendPin {
  readonly url: string
  readonly sha256: string
}

/** Temp entries are dot-prefixed so no sha256 lookup can ever match a half-built one. */
const TEMP_PREFIX = '.tmp-'

/** Where `index.html` sits in a wheel; a `dist` zip has it at the root. Both are accepted because
 *  they are not always the same build (v1.53.6's GitHub zip was a dev-Firebase build). */
const WHEEL_STATIC = path.join('comfyui_frontend_package', 'static')

/** PyPI hosts every project's files on one host, but only accepts a file named for its project,
 *  so on that host only the frontend package's own wheel is accepted. */
const PYPI_HOST = 'https://files.pythonhosted.org/'
const PYPI_WHEEL = /\/comfyui_frontend_package-[^/]+-py3-none-any\.whl$/

export function frontendCacheRoot(): string {
  return path.join(cacheDir(), 'frontend-cache')
}

/** Refuses the whole pin on any unknown key, so a payload can't think it set something it didn't. */
export function parseFrontendPin(value: unknown): FrontendPin | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { url, sha256, ...rest } = value as Record<string, unknown>
  if (Object.keys(rest).length > 0) return null
  if (typeof url !== 'string' || typeof sha256 !== 'string') return null
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null
  if (!isTrustedArtifactUrl(url)) return null
  const { href, pathname } = new URL(url)
  if (!/\.(whl|zip)$/.test(pathname)) return null
  if (href.startsWith(PYPI_HOST) && !PYPI_WHEEL.test(pathname)) return null
  return { url: href, sha256 }
}

function payloadPin(payload: unknown): unknown {
  return payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)[FRONTEND_PAYLOAD_FIELD]
    : undefined
}

/**
 * The pin carried by the campaigns that applied a grant on this launch. Campaigns naming
 * different builds, or one naming an invalid build, cancel the pin: a frontend is not picked by
 * whichever campaign happens to come first.
 */
export function appliedFrontendPin(applied: readonly CampaignApplied[]): FrontendPin | null {
  let pin: FrontendPin | null = null
  for (const { payload } of applied) {
    const value = payloadPin(payload)
    if (value === undefined) continue
    const parsed = parseFrontendPin(value)
    if (parsed === null || (pin !== null && pin.sha256 !== parsed.sha256)) return null
    pin = parsed
  }
  return pin
}

/**
 * Every valid pin a saved answer names, from campaigns this machine is in or drew `enrol` on: what
 * app start keeps and fetches. Every beta user holds the other campaigns' answers, and a pin that
 * can't apply here is not worth a download.
 */
export function answeredFrontendPins(
  answers: ReadonlyMap<string, CampaignAnswer>,
  records: CampaignRecords
): FrontendPin[] {
  const pins = new Map<string, FrontendPin>()
  for (const [key, answer] of answers) {
    if (answer.grants.length === 0 || !(answer.enrol || key in records)) continue
    const pin = parseFrontendPin(payloadPin(answer.payload))
    if (pin !== null) pins.set(pin.sha256, pin)
  }
  return [...pins.values()]
}

/** The served directory for `sha256`, or `null` until a complete build is in place. */
export function cachedFrontendDir(sha256: string, root = frontendCacheRoot()): string | null {
  const dir = path.join(root, sha256)
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null
}

export interface FrontendCacheDeps {
  readonly download: (url: string, dest: string) => Promise<unknown>
  readonly sha256File: (file: string) => Promise<string>
  readonly extract: (archive: string, dest: string) => Promise<void>
}

const defaultDeps: FrontendCacheDeps = {
  download: (url, dest) =>
    download(url, dest, null, { validateUrl: (u) => u.startsWith('https://') }),
  sha256File,
  extract: (archive, dest) => extract(archive, dest)
}

async function fetchIntoCache(
  pin: FrontendPin,
  root: string,
  deps: FrontendCacheDeps
): Promise<string> {
  const stamp = `${TEMP_PREFIX}${pin.sha256}-${process.pid}-${Date.now()}`
  const archive = path.join(root, `${stamp}${path.extname(new URL(pin.url).pathname)}`)
  const extractDir = path.join(root, stamp)
  try {
    await fs.promises.mkdir(root, { recursive: true })
    await deps.download(pin.url, archive)
    const actual = await deps.sha256File(archive)
    if (actual !== pin.sha256) throw new Error(`sha256 mismatch: got ${actual}`)
    await deps.extract(archive, extractDir)
    const served = [path.join(extractDir, WHEEL_STATIC), extractDir].find((dir) =>
      fs.existsSync(path.join(dir, 'index.html'))
    )
    if (served === undefined) throw new Error('no index.html at the root or in the wheel')
    // Same volume as the target, so the build appears whole or not at all.
    const target = path.join(root, pin.sha256)
    // A leftover without index.html (an interrupted removal) would block the rename on every boot.
    if (cachedFrontendDir(pin.sha256, root) === null) {
      await fs.promises.rm(target, { recursive: true, force: true })
    }
    try {
      await fs.promises.rename(served, target)
    } catch (err) {
      // Another fetch of the same build won the rename; its copy is as good as ours.
      if (cachedFrontendDir(pin.sha256, root) === null) throw err
    }
    return target
  } finally {
    await fs.promises.rm(archive, { force: true }).catch(() => {})
    await fs.promises.rm(downloadMetaPath(archive), { force: true }).catch(() => {})
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {})
  }
}

const inFlight = new Map<string, Promise<string | null>>()

/**
 * Put `pin` in the cache if it is not there yet; resolves to its directory, or `null` on any
 * failure (logged, never thrown). Concurrent calls for one build share one download.
 */
export function prefetchFrontend(
  pin: FrontendPin,
  root = frontendCacheRoot(),
  deps: FrontendCacheDeps = defaultDeps
): Promise<string | null> {
  const cached = cachedFrontendDir(pin.sha256, root)
  if (cached !== null) return Promise.resolve(cached)
  const key = path.join(root, pin.sha256)
  const pending = inFlight.get(key)
  if (pending) return pending
  const run = fetchIntoCache(pin, root, deps)
    .then((dir) => {
      console.log(`[core-campaign] frontend ${pin.url} cached`)
      return dir
    })
    .catch((err: unknown) => {
      console.log(`[core-campaign] frontend ${pin.url} fetch failed: ${String(err)}`)
      return null
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, run)
  return run
}

/** A launch touches the build it serves, so cleanup never removes one in recent use. */
const UNUSED_FOR_MS = 7 * 24 * 60 * 60 * 1000

/**
 * App-start upkeep: remove cached builds no pin names that no launch has served for a week (and
 * leftovers of fetches that old), then fetch the missing ones. The age guard covers a launch that
 * picked a build from an answer this boot's refresh has since replaced, and a ComfyUI a crashed
 * Desktop left serving one. Never throws.
 */
export async function syncFrontendCache(
  pins: readonly FrontendPin[],
  root = frontendCacheRoot(),
  deps: FrontendCacheDeps = defaultDeps
): Promise<void> {
  try {
    const keep = new Set(pins.map((pin) => pin.sha256))
    const entries = await fs.promises.readdir(root).catch(() => [] as string[])
    const cutoff = Date.now() - UNUSED_FOR_MS
    await Promise.all(
      entries
        .filter((name) => !keep.has(name))
        .map(async (name) => {
          const entry = path.join(root, name)
          // Per entry, so one that vanished or can't be removed never costs this boot's fetches.
          const stat = await fs.promises.stat(entry).catch(() => null)
          if (stat === null || stat.mtimeMs > cutoff) return
          await fs.promises.rm(entry, { recursive: true, force: true }).catch(() => {})
        })
    )
    await Promise.all(pins.map((pin) => prefetchFrontend(pin, root, deps)))
  } catch (err) {
    console.log(`[core-campaign] frontend cache upkeep failed: ${String(err)}`)
  }
}

/**
 * The `--front-end-root` args for this launch and the launch-log line saying why. The user's own
 * frontend choice wins; a ComfyUI without the flag gets nothing; a build not yet on disk starts
 * its fetch for a later launch and this one serves the bundled frontend.
 */
export function frontendRootArgs(
  applied: readonly CampaignApplied[],
  userArgs: readonly string[],
  schema: ComfyArgsSchema,
  root = frontendCacheRoot()
): { args: string[]; record: string | null } {
  const pin = appliedFrontendPin(applied)
  if (pin === null) return { args: [], record: null }
  const label = `[core-campaign] frontend ${pin.url}`
  const own = userArgs.some((arg) => /^--front-end-(root|version)(=|$)/.test(arg))
  if (own) return { args: [], record: `${label} withheld: your own frontend arg wins` }
  if (!schema.knownFlags.has('front-end-root')) {
    return { args: [], record: `${label} withheld: not supported by this core` }
  }
  const dir = cachedFrontendDir(pin.sha256, root)
  if (dir === null) {
    void prefetchFrontend(pin, root)
    return { args: [], record: `${label} pending: not downloaded yet, serving the bundled one` }
  }
  try {
    const now = new Date()
    fs.utimesSync(dir, now, now)
  } catch {
    // Only the cleanup's age guard reads it; serving the build matters more.
  }
  return { args: ['--front-end-root', dir], record: `${label} served from ${dir}` }
}

export function _resetForTest(): void {
  inFlight.clear()
}
