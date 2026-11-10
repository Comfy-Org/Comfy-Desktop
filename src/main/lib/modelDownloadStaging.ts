import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { ALLOWED_EXTENSIONS } from './downloadFilename'

export const STAGING_SUFFIX = '.part'
export const STAGING_META_SUFFIX = '.part.dl-meta'
export const STAGING_META_TMP_SUFFIX = '.tmp'
export const LEGACY_META_SUFFIX = '.dl-meta'

export interface StagedDownloadMeta {
  version: 2
  jobId?: string
  url: string
  expectedSize: number
  etag?: string
  lastModified?: string
  directory: string
  filename: string
  installationId?: string | null
  sha256?: string
}

export function stagingPathFor(finalPath: string): string {
  return finalPath + STAGING_SUFFIX
}

export function stagingMetaPathFor(finalPath: string): string {
  return finalPath + STAGING_META_SUFFIX
}

function parseStagedMeta(raw: Partial<StagedDownloadMeta> | null): StagedDownloadMeta | null {
  if (
    raw &&
    raw.version === 2 &&
    typeof raw.url === 'string' &&
    typeof raw.filename === 'string' &&
    typeof raw.directory === 'string' &&
    typeof raw.expectedSize === 'number'
  ) {
    return raw as StagedDownloadMeta
  }
  return null
}

function readMetaFile(filePath: string): StagedDownloadMeta | null {
  try {
    return parseStagedMeta(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
  } catch {
    return null
  }
}

export function readStagedMeta(metaPath: string): StagedDownloadMeta | null {
  return readMetaFile(metaPath + STAGING_META_TMP_SUFFIX) ?? readMetaFile(metaPath)
}

export function writeStagedMeta(metaPath: string, meta: StagedDownloadMeta): boolean {
  const tmpPath = metaPath + STAGING_META_TMP_SUFFIX
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(meta))
  } catch {
    try {
      fs.unlinkSync(tmpPath)
    } catch {}
    return false
  }
  try {
    fs.renameSync(tmpPath, metaPath)
    return true
  } catch {}
  try {
    fs.unlinkSync(metaPath)
  } catch {}
  try {
    fs.renameSync(tmpPath, metaPath)
    return true
  } catch {
    return fs.existsSync(tmpPath)
  }
}

export function removeStagedArtifacts(finalPath: string): boolean {
  const metaPath = stagingMetaPathFor(finalPath)
  try {
    fs.unlinkSync(stagingPathFor(finalPath))
  } catch {}
  try {
    fs.unlinkSync(metaPath)
  } catch {}
  try {
    fs.unlinkSync(metaPath + STAGING_META_TMP_SUFFIX)
  } catch {}
  return !fs.existsSync(metaPath) && !fs.existsSync(metaPath + STAGING_META_TMP_SUFFIX)
}

export const LINK_UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'EPERM',
  'ENOTSUP',
  'EOPNOTSUPP',
  'ENOSYS',
  'EXDEV',
  'EMLINK'
])

export function parkFileNoClobber(
  source: string,
  candidateFor: (n: number) => string
): string | null {
  for (let n = 0; n < 10_000; n++) {
    const parked = candidateFor(n)
    let linked = false
    try {
      fs.linkSync(source, parked)
      linked = true
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') continue
      if (code === 'ENOENT') return null
      if (!LINK_UNSUPPORTED_CODES.has(code ?? '')) return null
    }
    if (linked) {
      try {
        fs.unlinkSync(source)
        return parked
      } catch {
        try {
          fs.unlinkSync(parked)
        } catch {}
        return null
      }
    }
    let fd: number
    try {
      fd = fs.openSync(parked, 'wx')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      return null
    }
    try {
      fs.closeSync(fd)
    } catch {}
    try {
      fs.renameSync(source, parked)
      return parked
    } catch {
      try {
        fs.unlinkSync(parked)
      } catch {}
      return null
    }
  }
  return null
}

export function quarantineOrphanStagedBytes(finalPath: string): boolean {
  const stagingPath = stagingPathFor(finalPath)
  return (
    parkFileNoClobber(stagingPath, (n) =>
      n === 0 ? stagingPath + '.orphan' : stagingPath + `.orphan-${n}`
    ) !== null
  )
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    let ended = false
    stream.on('error', reject)
    stream.on('end', () => {
      ended = true
    })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('close', () => {
      if (!ended) {
        reject(new Error(`sha256 read stream closed before end of file: ${filePath}`))
        return
      }
      resolve(hash.digest('hex'))
    })
  })
}

export async function filesHaveSameBytes(a: string, b: string): Promise<boolean> {
  const CHUNK = 1024 * 1024
  let fdA: fs.promises.FileHandle | undefined
  let fdB: fs.promises.FileHandle | undefined
  try {
    fdA = await fs.promises.open(a, 'r')
    fdB = await fs.promises.open(b, 'r')
    const bufA = Buffer.allocUnsafe(CHUNK)
    const bufB = Buffer.allocUnsafe(CHUNK)
    for (;;) {
      const [readA, readB] = await Promise.all([
        fdA.read(bufA, 0, CHUNK, null),
        fdB.read(bufB, 0, CHUNK, null)
      ])
      if (readA.bytesRead !== readB.bytesRead) return false
      if (readA.bytesRead === 0) return true
      if (!bufA.subarray(0, readA.bytesRead).equals(bufB.subarray(0, readB.bytesRead))) {
        return false
      }
    }
  } catch {
    return false
  } finally {
    try {
      await fdA?.close()
    } catch {}
    try {
      await fdB?.close()
    } catch {}
  }
}

export async function installStagedAtFinal(
  stagingPath: string,
  finalPath: string,
  finalBytes: number
): Promise<void> {
  const conflictOrAccept = async (): Promise<void> => {
    let existingSize = -1
    try {
      existingSize = fs.statSync(finalPath).size
    } catch {}
    if (existingSize === finalBytes && (await filesHaveSameBytes(stagingPath, finalPath))) {
      try {
        fs.unlinkSync(stagingPath)
      } catch {}
      return
    }
    throw new Error('a different file already exists at the destination')
  }

  try {
    fs.linkSync(stagingPath, finalPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      await conflictOrAccept()
      return
    }
    if (!LINK_UNSUPPORTED_CODES.has(code ?? '')) throw err
    if (fs.existsSync(finalPath)) {
      await conflictOrAccept()
      return
    }
    throw new Error('atomic no-replace install is not supported by this filesystem', { cause: err })
  }
  try {
    fs.unlinkSync(stagingPath)
  } catch {}
}

export function ensureStagedPlaceholder(finalPath: string, meta: StagedDownloadMeta): boolean {
  const metaPath = stagingMetaPathFor(finalPath)
  const stagingPath = stagingPathFor(finalPath)
  const existing = readStagedMeta(metaPath)
  if (existing !== null) {
    if (meta.sha256 && existing.sha256 !== meta.sha256) {
      if (!writeStagedMeta(metaPath, { ...existing, sha256: meta.sha256 })) return false
    }
    if (fs.existsSync(stagingPath)) return true
    try {
      fs.writeFileSync(stagingPath, '')
      return true
    } catch {
      return false
    }
  }
  if (fs.existsSync(stagingPath) && !quarantineOrphanStagedBytes(finalPath)) {
    return false
  }
  try {
    fs.writeFileSync(stagingPath, '')
  } catch {
    return false
  }
  return writeStagedMeta(metaPath, meta)
}

export function hasModelExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export interface DiscoveredStagedDownload {
  finalPath: string
  stagedBytes: number
  meta: StagedDownloadMeta
}

export function revalidateStagedPair(
  finalPath: string
): { meta: StagedDownloadMeta; stagedBytes: number } | null {
  const meta = readStagedMeta(stagingMetaPathFor(finalPath))
  if (!meta) return null
  try {
    const stat = fs.statSync(stagingPathFor(finalPath))
    if (!stat.isFile()) return null
    return { meta, stagedBytes: stat.size }
  } catch {
    return null
  }
}

const SCAN_MAX_DEPTH = 8

const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__'])

const SCAN_YIELD_EVERY = 500

interface WalkYieldState {
  sinceYield: number
}

async function walkForSuffixes(
  dir: string,
  suffixes: readonly string[],
  depth: number,
  out: string[],
  strict = false,
  yieldState: WalkYieldState = { sinceYield: 0 }
): Promise<void> {
  if (!strict && depth > SCAN_MAX_DEPTH) return
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (!strict || code === 'ENOENT' || code === 'ENOTDIR') return
    throw err
  }
  for (const entry of entries) {
    if (++yieldState.sinceYield >= SCAN_YIELD_EVERY) {
      yieldState.sinceYield = 0
      await new Promise((resolve) => setImmediate(resolve))
    }
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue
      await walkForSuffixes(
        path.join(dir, entry.name),
        suffixes,
        depth + 1,
        out,
        strict,
        yieldState
      )
    } else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      out.push(path.join(dir, entry.name))
    }
  }
}

function pruneCoveredRoots(roots: readonly string[]): string[] {
  const infos: { root: string; key: string }[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    let physical: string
    try {
      physical = fs.realpathSync(root)
    } catch {
      physical = path.resolve(root)
    }
    const key = physical.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    infos.push({ root, key })
  }
  const coveredBy = (child: string, parent: string): boolean => {
    const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep
    if (!child.startsWith(prefix)) return false
    return child
      .slice(prefix.length)
      .split(path.sep)
      .every((component) => !SCAN_SKIP_DIRS.has(component))
  }
  return infos
    .filter((info) => !infos.some((other) => other !== info && coveredBy(info.key, other.key)))
    .map((info) => info.root)
}

function dedupeResolved(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const key = path.resolve(p).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

export interface StagedDownloadScanResult {
  downloads: DiscoveredStagedDownload[]
  unsafeFinalPaths: string[]
}

export async function scanForStagedDownloads(
  roots: readonly string[]
): Promise<StagedDownloadScanResult> {
  const tmpSuffix = STAGING_META_SUFFIX + STAGING_META_TMP_SUFFIX
  const matched: string[] = []
  const yieldState: WalkYieldState = { sinceYield: 0 }
  for (const root of pruneCoveredRoots(roots)) {
    await walkForSuffixes(root, [STAGING_META_SUFFIX, tmpSuffix], 0, matched, true, yieldState)
  }
  const metaFiles: string[] = []
  const tmpFiles: string[] = []
  for (const filePath of matched) {
    ;(filePath.endsWith(tmpSuffix) ? tmpFiles : metaFiles).push(filePath)
  }
  for (const tmpPath of tmpFiles) {
    const mainPath = tmpPath.slice(0, -STAGING_META_TMP_SUFFIX.length)
    if (readMetaFile(tmpPath) !== null) {
      try {
        await fs.promises.rename(tmpPath, mainPath)
      } catch {
        try {
          await fs.promises.unlink(mainPath)
        } catch {}
        try {
          await fs.promises.rename(tmpPath, mainPath)
        } catch {}
      }
      if (!metaFiles.includes(mainPath)) metaFiles.push(mainPath)
      continue
    }
    try {
      await fs.promises.unlink(tmpPath)
    } catch {}
  }
  const found: DiscoveredStagedDownload[] = []
  const unsafeFinalPaths: string[] = []
  const seenFinals = new Set<string>()
  for (const metaPath of metaFiles) {
    const finalPath = metaPath.slice(0, -STAGING_META_SUFFIX.length)
    if (!hasModelExtension(path.basename(finalPath))) continue
    const key = path.resolve(finalPath).toLowerCase()
    if (seenFinals.has(key)) continue
    seenFinals.add(key)
    const meta = readStagedMeta(metaPath)
    const partPath = stagingPathFor(finalPath)
    let stagedBytes = -1
    try {
      const stat = await fs.promises.stat(partPath)
      if (stat.isFile()) stagedBytes = stat.size
    } catch {}
    if (!meta || stagedBytes < 0) {
      try {
        await fs.promises.unlink(metaPath)
      } catch {}
      try {
        await fs.promises.unlink(metaPath + STAGING_META_TMP_SUFFIX)
      } catch {}
      continue
    }
    if (fs.existsSync(finalPath)) {
      let finalSize = -1
      try {
        finalSize = fs.statSync(finalPath).size
      } catch {}
      if (finalSize === 0) {
        const parked = parkFileNoClobber(finalPath, (n) =>
          n === 0
            ? finalPath + '.claimed' + STAGING_SUFFIX
            : finalPath + `.claimed-${n}` + STAGING_SUFFIX
        )
        if (parked === null) {
          unsafeFinalPaths.push(finalPath)
        }
      } else if (finalSize === stagedBytes && (await filesHaveSameBytes(partPath, finalPath))) {
        removeStagedArtifacts(finalPath)
        continue
      }
    }
    found.push({ finalPath, stagedBytes, meta })
  }
  return { downloads: found, unsafeFinalPaths }
}

function relativeModelDirectory(root: string, filePath: string): string {
  const rel = path.relative(path.resolve(root), path.resolve(path.dirname(filePath)))
  if (rel === '' || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return path.basename(path.dirname(filePath))
  }
  return rel.split(path.sep).join('/')
}

export interface LegacyMigrationResult {
  finalized: string[]
  staged: string[]
  removedStaleMeta: string[]
  quarantined: string[]
  unsafe: string[]
}

export async function migrateLegacyModelDownloadArtifacts(
  roots: readonly string[]
): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = {
    finalized: [],
    staged: [],
    removedStaleMeta: [],
    quarantined: [],
    unsafe: []
  }
  const metaFilesByRoot: Array<{ root: string; metaPath: string }> = []
  const yieldState: WalkYieldState = { sinceYield: 0 }
  for (const root of dedupeResolved([...roots])) {
    const files: string[] = []
    await walkForSuffixes(root, [LEGACY_META_SUFFIX], 0, files, true, yieldState)
    for (const metaPath of files) metaFilesByRoot.push({ root, metaPath })
  }
  const seenData = new Set<string>()
  for (const { root, metaPath } of metaFilesByRoot) {
    if (metaPath.endsWith(STAGING_META_SUFFIX)) continue
    const dataPath = metaPath.slice(0, -LEGACY_META_SUFFIX.length)
    if (!hasModelExtension(path.basename(dataPath))) continue
    const dataKey = path.resolve(dataPath).toLowerCase()
    if (seenData.has(dataKey)) continue
    seenData.add(dataKey)
    let dataSize = -1
    try {
      const stat = await fs.promises.stat(dataPath)
      if (stat.isFile()) dataSize = stat.size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        result.unsafe.push(dataPath)
        continue
      }
    }
    if (dataSize < 0) {
      try {
        await fs.promises.unlink(metaPath)
        result.removedStaleMeta.push(metaPath)
      } catch {}
      continue
    }

    let legacy: { url?: unknown; expectedSize?: unknown; etag?: unknown; lastModified?: unknown }
    try {
      legacy = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8')) as typeof legacy
    } catch {
      legacy = {}
    }
    const url = typeof legacy.url === 'string' ? legacy.url : ''
    const expectedSize = typeof legacy.expectedSize === 'number' ? legacy.expectedSize : 0

    if (url && expectedSize > 0 && dataSize === expectedSize) {
      try {
        await fs.promises.unlink(metaPath)
        result.finalized.push(dataPath)
      } catch {}
      continue
    }

    const partPath = stagingPathFor(dataPath)
    if (fs.existsSync(partPath)) {
      const parked = parkFileNoClobber(dataPath, (n) =>
        n === 0 ? dataPath + '.legacy' + STAGING_SUFFIX : dataPath + `.legacy-${n}` + STAGING_SUFFIX
      )
      if (!parked) {
        result.unsafe.push(dataPath)
        continue
      }
      result.quarantined.push(parked)
      try {
        await fs.promises.unlink(metaPath)
      } catch {}
      continue
    }
    const v2MetaPath = stagingMetaPathFor(dataPath)
    if (url) {
      const wrote = writeStagedMeta(v2MetaPath, {
        version: 2,
        url,
        expectedSize,
        etag: typeof legacy.etag === 'string' ? legacy.etag : undefined,
        lastModified: typeof legacy.lastModified === 'string' ? legacy.lastModified : undefined,
        directory: relativeModelDirectory(root, dataPath),
        filename: path.basename(dataPath)
      })
      if (!wrote) {
        result.unsafe.push(dataPath)
        continue
      }
    }
    const failMove = async (): Promise<void> => {
      if (url) {
        try {
          await fs.promises.unlink(v2MetaPath)
        } catch {}
      }
      result.unsafe.push(dataPath)
    }
    try {
      fs.closeSync(fs.openSync(partPath, 'wx'))
    } catch {
      await failMove()
      continue
    }
    try {
      await fs.promises.rename(dataPath, partPath)
    } catch {
      try {
        fs.unlinkSync(partPath)
      } catch {}
      await failMove()
      continue
    }
    result[url ? 'staged' : 'quarantined'].push(partPath)
    try {
      await fs.promises.unlink(metaPath)
    } catch {}
  }
  return result
}
