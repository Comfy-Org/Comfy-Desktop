import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { TemplateSearchAvailability } from '../../types/ipc'
import { asRecord, readJson } from './json'
import type { BundleSource, LocalBundle } from './service'

const BUNDLES_DIR = 'bundles'
const FILES_DIR = 'files'
const MANIFEST = 'manifest.json'
const PROGRESS_EVERY_MS = 250
const UPDATE_CHECK_MS = 24 * 60 * 60_000
const SHA256 = /^[0-9a-f]{64}$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export interface Supported {
  sidecar: string
  major: number
  minMinor: number
}

export interface BundleFile {
  path: string
  size: number
  sha256: string
}

export interface IndexEntry {
  version: string
  manifest: string
  manifestSha256: string
  minSidecar: string | null
}

export type TransferResult = { ok: true } | { ok: false; error: string }

export interface BundleStoreDeps {
  root: string
  base: () => string | null
  getSmall: (url: string) => Promise<Buffer>
  transfer: (file: {
    url: string
    finalPath: string
    size: number
    sha256: string
    onProgress: (received: number) => void
  }) => Promise<TransferResult>
  supports: () => Promise<Supported | null>
  check: (bundleDir: string) => Promise<boolean>
  onAvailability: (availability: TemplateSearchAvailability) => void
  onDownloaded?: (download: BundleDownload) => void
  now?: () => number
}

export interface BundleDownload {
  result: 'completed' | 'up_to_date' | 'failed'
  bytes: number
  durationMs: number
  background: boolean
  version: string | null
}

type Semver = [number, number, number]

export function parseSemver(text: unknown): Semver | null {
  const match = typeof text === 'string' ? SEMVER.exec(text) : null
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareSemver(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export function isBundlePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.isAbsolute(value))
    return false
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function readsVersion(
  supported: Supported,
  version: string,
  minSidecar: string | null
): boolean {
  const v = parseSemver(version)
  if (!v || v[0] !== supported.major || v[1] < supported.minMinor) return false
  if (minSidecar === null) return true
  const needed = parseSemver(minSidecar)
  const own = parseSemver(supported.sidecar)
  return needed !== null && own !== null && compareSemver(needed, own) <= 0
}

export function parseIndex(raw: unknown): IndexEntry[] {
  const bundles = asRecord(raw)?.bundles
  const entries: IndexEntry[] = []
  for (const item of Array.isArray(bundles) ? bundles : []) {
    const entry = asRecord(item)
    if (!entry || entry.yanked === true) continue
    const { version, manifest, manifest_sha256: manifestSha256, min_sidecar: minSidecar } = entry
    if (!parseSemver(version) || !isBundlePath(manifest)) continue
    if (typeof manifestSha256 !== 'string' || !SHA256.test(manifestSha256)) continue
    if (minSidecar != null && typeof minSidecar !== 'string') continue
    entries.push({
      version: version as string,
      manifest,
      manifestSha256,
      minSidecar: (minSidecar as string | null | undefined) ?? null
    })
  }
  return entries
}

export function chooseEntry(entries: IndexEntry[], supported: Supported): IndexEntry | null {
  const readable = entries.filter((e) => readsVersion(supported, e.version, e.minSidecar))
  readable.sort((a, b) => compareSemver(parseSemver(b.version)!, parseSemver(a.version)!))
  return readable[0] ?? null
}

export interface ParsedManifest {
  version: string
  minSidecar: string | null
  files: BundleFile[]
}

export function parseManifest(raw: unknown): ParsedManifest | null {
  const manifest = asRecord(raw)
  if (!manifest || !parseSemver(manifest.version) || !Array.isArray(manifest.files)) return null
  const minSidecar = manifest.min_sidecar ?? null
  if (minSidecar !== null && !parseSemver(minSidecar)) return null
  const files: BundleFile[] = []
  for (const item of manifest.files) {
    const file = asRecord(item)
    const size = file?.size
    if (!file || !isBundlePath(file.path) || file.path === MANIFEST) return null
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return null
    if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) return null
    files.push({ path: file.path, size, sha256: file.sha256 })
  }
  return { version: manifest.version as string, minSidecar: minSidecar as string | null, files }
}

function sha256Of(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

async function fileSha256(file: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function place(source: string, target: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  try {
    await fs.promises.link(source, target)
  } catch {
    await fs.promises.copyFile(source, target)
  }
}

export function createBundleStore(deps: BundleStoreDeps): BundleSource & {
  download(options?: { quietly?: boolean }): Promise<void>
} {
  const now = deps.now ?? Date.now
  const bundlesDir = path.join(deps.root, BUNDLES_DIR)
  const filesDir = path.join(deps.root, FILES_DIR)
  let downloading: Promise<void> | null = null
  let progress = { received: 0, total: 0 }
  let lastProgressAt = 0
  let lastUpdateCheck = 0
  let quiet = false

  async function localVersions(): Promise<(LocalBundle & { minSidecar: string | null })[]> {
    const names = await fs.promises.readdir(bundlesDir).catch(() => [] as string[])
    const found: (LocalBundle & { minSidecar: string | null })[] = []
    for (const name of names) {
      if (name.startsWith('.') || !parseSemver(name)) continue
      const manifest = parseManifest(await readJson(path.join(bundlesDir, name, MANIFEST)))
      if (manifest?.version === name)
        found.push({
          dir: path.join(bundlesDir, name),
          version: name,
          minSidecar: manifest.minSidecar
        })
    }
    return found.sort((a, b) => compareSemver(parseSemver(b.version)!, parseSemver(a.version)!))
  }

  async function newest(): Promise<LocalBundle | null> {
    const supported = await deps.supports()
    if (!supported) return null
    const found = (await localVersions()).find((b) =>
      readsVersion(supported, b.version, b.minSidecar)
    )
    return found ? { dir: found.dir, version: found.version } : null
  }

  async function discard(version: string): Promise<void> {
    await fs.promises.rm(path.join(bundlesDir, version), { recursive: true, force: true })
  }

  function report(availability: TemplateSearchAvailability): void {
    if (!quiet) deps.onAvailability(availability)
  }

  function reportProgress(force = false): void {
    const at = now()
    if (!force && at - lastProgressAt < PROGRESS_EVERY_MS) return
    lastProgressAt = at
    report({ kind: 'downloading', ...progress })
  }

  function baseUrl(): string | null {
    const base = deps.base()?.trim()
    if (!base) return null
    try {
      const url = new URL(base.endsWith('/') ? base : `${base}/`)
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
    } catch {
      return null
    }
  }

  async function wanted(base: string): Promise<{ entry: IndexEntry; raw: Buffer } | null> {
    const supported = await deps.supports()
    if (!supported) return null
    const index = parseIndex(
      JSON.parse((await deps.getSmall(new URL('index.json', base).toString())).toString('utf8'))
    )
    const entry = chooseEntry(index, supported)
    if (!entry) return null
    const raw = await deps.getSmall(new URL(entry.manifest, base).toString())
    if (sha256Of(raw) !== entry.manifestSha256)
      throw new Error('the manifest is not the one the index lists')
    return { entry, raw }
  }

  async function storedSound(file: BundleFile): Promise<boolean> {
    const blob = path.join(filesDir, file.sha256)
    const stat = await fs.promises.stat(blob).catch(() => null)
    return (
      stat?.isFile() === true && stat.size === file.size && (await fileSha256(blob)) === file.sha256
    )
  }

  async function fetchFiles(base: string, files: BundleFile[]): Promise<number> {
    const missing: BundleFile[] = []
    for (const file of files) {
      if (await storedSound(file)) continue
      await fs.promises.rm(path.join(filesDir, file.sha256), { force: true })
      missing.push(file)
    }
    progress = { received: 0, total: missing.reduce((sum, f) => sum + f.size, 0) }
    reportProgress(true)
    let done = 0
    for (const file of missing) {
      const result = await deps.transfer({
        url: new URL(`${FILES_DIR}/${file.sha256}`, base).toString(),
        finalPath: path.join(filesDir, file.sha256),
        size: file.size,
        sha256: file.sha256,
        onProgress: (received) => {
          progress = { ...progress, received: done + received }
          reportProgress()
        }
      })
      if (!result.ok) throw new Error(result.error)
      done += file.size
    }
    return done
  }

  async function assemble(version: string, raw: Buffer, files: BundleFile[]): Promise<void> {
    const partial = path.join(bundlesDir, `.${version}.partial`)
    const target = path.join(bundlesDir, version)
    await fs.promises.rm(partial, { recursive: true, force: true })
    try {
      await fs.promises.mkdir(partial, { recursive: true })
      for (const file of files)
        await place(path.join(filesDir, file.sha256), path.join(partial, file.path))
      await fs.promises.writeFile(path.join(partial, MANIFEST), raw)
      if (!(await deps.check(partial))) throw new Error(`bundle ${version} does not check`)
      await fs.promises.rm(target, { recursive: true, force: true })
      await fs.promises.rename(partial, target)
    } catch (err) {
      await fs.promises.rm(partial, { recursive: true, force: true })
      throw err
    }
  }

  async function removeOlderVersions(): Promise<void> {
    const kept = await newest()
    for (const old of (await localVersions()).filter((b) => b.dir !== kept?.dir)) {
      await fs.promises.rm(old.dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function removeUnlistedFiles(): Promise<void> {
    const kept = await newest()
    const listed = new Set<string>()
    if (kept) {
      const manifest = parseManifest(await readJson(path.join(kept.dir, MANIFEST)))
      for (const file of manifest?.files ?? []) listed.add(file.sha256)
    }
    for (const name of await fs.promises.readdir(filesDir).catch(() => [] as string[])) {
      if (!listed.has(name))
        await fs.promises.rm(path.join(filesDir, name), { force: true }).catch(() => {})
    }
  }

  async function clearPartials(): Promise<void> {
    for (const name of await fs.promises.readdir(bundlesDir).catch(() => [] as string[])) {
      if (name.startsWith('.') && name.endsWith('.partial')) {
        await fs.promises.rm(path.join(bundlesDir, name), { recursive: true, force: true })
      }
    }
  }

  async function fetchNewest(base: string): Promise<{ version: string; bytes: number } | null> {
    progress = { received: 0, total: 0 }
    await clearPartials()
    const found = await wanted(base)
    if (!found) return null
    const local = await localVersions()
    const current = local.find((b) => b.version === found.entry.version)
    if (current) {
      const onDisk = await fs.promises.readFile(path.join(current.dir, MANIFEST)).catch(() => null)
      if (onDisk && sha256Of(onDisk) === found.entry.manifestSha256) return null
    }
    const manifest = parseManifest(JSON.parse(found.raw.toString('utf8')))
    if (!manifest || manifest.version !== found.entry.version) {
      throw new Error('the manifest does not match the index')
    }
    const bytes = await fetchFiles(base, manifest.files)
    await assemble(manifest.version, found.raw, manifest.files)
    await removeUnlistedFiles()
    return { version: manifest.version, bytes }
  }

  function download({ quietly = false } = {}): Promise<void> {
    const base = baseUrl()
    if (!base) return Promise.resolve()
    if (downloading) {
      if (!quietly && quiet) {
        quiet = false
        reportProgress(true)
      }
      return downloading
    }
    quiet = quietly
    const startedAt = now()
    const reportDownload = (download: Pick<BundleDownload, 'result' | 'bytes' | 'version'>): void =>
      deps.onDownloaded?.({ ...download, durationMs: now() - startedAt, background: quietly })
    downloading = fetchNewest(base)
      .then((fetched) => {
        reportDownload(
          fetched
            ? { result: 'completed', ...fetched }
            : { result: 'up_to_date', bytes: 0, version: null }
        )
        report({ kind: 'idle' })
      })
      .catch(() => {
        reportDownload({ result: 'failed', bytes: progress.received, version: null })
        report({ kind: 'unavailable', reason: 'download_failed' })
      })
      .finally(() => {
        downloading = null
        quiet = false
      })
    return downloading
  }

  async function prepare(): Promise<TemplateSearchAvailability> {
    const local = await newest()
    const base = baseUrl()
    if (local) {
      if (!downloading) await removeOlderVersions()
      if (base && now() - lastUpdateCheck > UPDATE_CHECK_MS) {
        lastUpdateCheck = now()
        void download({ quietly: true })
      }
      return { kind: 'ready' }
    }
    if (!base) return { kind: 'off' }
    if (downloading) {
      quiet = false
      return { kind: 'downloading', ...progress }
    }
    try {
      const found = await wanted(base)
      if (!found) return { kind: 'unavailable', reason: 'update_desktop' }
      const manifest = parseManifest(JSON.parse(found.raw.toString('utf8')))
      const bytes = manifest?.files.reduce((sum, f) => sum + f.size, 0) ?? 0
      return { kind: 'needs_download', bytes }
    } catch {
      return { kind: 'unavailable', reason: 'offline' }
    }
  }

  return { newest, discard, prepare, download }
}
