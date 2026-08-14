import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { ALLOWED_EXTENSIONS } from './downloadFilename'

/**
 * Durable staging layer for managed model downloads.
 *
 * Incomplete model bytes are NEVER written under a recognized final model
 * extension (ComfyUI scans model dirs by extension, so a truncated
 * `foo.safetensors` would appear to be a loadable model - issue #1322).
 * Instead a transfer writes to `<final>.part` with a JSON sidecar
 * `<final>.part.dl-meta`, and only a size-verified completion atomically
 * renames the staged file onto the final name.
 *
 * This module owns the staging path scheme, the versioned sidecar format,
 * startup discovery of resumable staged jobs, and the migration of legacy
 * `<final>` + `<final>.dl-meta` pairs left behind by releases where the
 * template task downloaded straight to the final path (`lib/download.ts`
 * semantics). It is deliberately Electron-free so it is unit-testable.
 */

export const STAGING_SUFFIX = '.part'
export const STAGING_META_SUFFIX = '.part.dl-meta'
/** Scratch suffix for atomic sidecar replacement (write tmp + rename). */
export const STAGING_META_TMP_SUFFIX = '.tmp'
/** Sidecar suffix used by `lib/download.ts` (still valid for cache/env
 *  downloads - only model-dir artifacts are migrated away from it). */
export const LEGACY_META_SUFFIX = '.dl-meta'

/** Sidecar payload. Versioned so a future format change can migrate. Stores
 *  everything needed to reconstruct a resumable job after a restart. */
export interface StagedDownloadMeta {
  version: 2
  /** Manager job ID, persisted so restart hydration restores the same stable
   *  identity instead of minting a new one. Optional: legacy-migrated
   *  sidecars predate the field and hydrate with a fresh ID. */
  jobId?: string
  /** ORIGINAL source url - stable across redirects; the job's resume identity. */
  url: string
  /** Total expected bytes; 0 when the server never reported a length. */
  expectedSize: number
  /** Validators for Range/If-Range resume. Resume restarts when absent. */
  etag?: string
  lastModified?: string
  /** Models subdirectory (e.g. `checkpoints`), for rebuilding the job row. */
  directory: string
  /** Final on-disk filename. */
  filename: string
  /** Install that initiated the download, when known. */
  installationId?: string | null
  /** Expected lowercase-hex sha256 of the complete file. When present, the
   *  transport verifies the staged bytes against it before finalizing, and a
   *  restart-hydrated job keeps verifying without the original caller. */
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
  // `writeStagedMeta` always writes the NEWEST content to the `.tmp` scratch
  // file first and removes it only by renaming it onto the main sidecar, so a
  // VALID scratch copy is always at least as new as the main sidecar. After a
  // rewrite whose replacing rename failed (Windows EPERM/EBUSY - e.g. a
  // scanner holding the target open) the main sidecar still holds STALE
  // content; preferring it could resume against outdated validators or, far
  // worse, finalize an incomplete file against an outdated expectedSize. A
  // torn scratch copy from a crash mid-write parses as null and falls back.
  return readMetaFile(metaPath + STAGING_META_TMP_SUFFIX) ?? readMetaFile(metaPath)
}

/** Write the sidecar crash-safely. Returns true when the durable sidecar (or
 *  its recoverable `.tmp` copy) holds the new content. */
export function writeStagedMeta(metaPath: string, meta: StagedDownloadMeta): boolean {
  // Atomic (write tmp + rename) so a crash mid-write can never leave a torn
  // sidecar that later parses as garbage.
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
  // Sidecars are REWRITTEN repeatedly (per response, per validator refresh).
  // On Windows, rename-over-existing can fail transiently (EPERM/EBUSY -
  // e.g. a scanner holding the target open). Clear the target and retry once.
  try {
    fs.unlinkSync(metaPath)
  } catch {}
  try {
    fs.renameSync(tmpPath, metaPath)
    return true
  } catch {
    // Both renames failed. Do NOT delete the temp file: with the main sidecar
    // possibly gone it is the only durable copy of the resume identity, and
    // `readStagedMeta` / startup recovery fall back to it.
    return fs.existsSync(tmpPath)
  }
}

/** Best-effort removal of a job's staged bytes + sidecar (cancel semantics).
 *  Returns true when no resumable metadata remains (main sidecar and its
 *  `.tmp` fallback are both gone) - the bytes alone cannot rehydrate. */
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

/** linkSync errno values that mean "this filesystem/inode cannot take a hard
 *  link" (a capability gap the rename fallback may bridge) rather than a real
 *  I/O or permission failure (which must fail the parking outright). */
export const LINK_UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'EPERM', // Windows exFAT/FAT32 and some network filesystems
  'ENOTSUP',
  'EOPNOTSUPP',
  'ENOSYS',
  'EXDEV', // same-directory link refused: link semantics unavailable
  'EMLINK' // inode cannot take another name; rename still can
])

/**
 * Move `source` onto a fresh name from `candidateFor` WITHOUT ever
 * overwriting an existing file. `existsSync` + `rename` is not enough:
 * POSIX rename silently replaces a destination that appears between the two
 * calls, destroying previously parked bytes. Instead each candidate name is
 * claimed atomically with an exclusive create (`wx` fails EEXIST on every
 * filesystem); the rename then replaces only our own empty claim marker.
 * Returns the parked path, or null when the bytes could not be moved.
 */
export function parkFileNoClobber(
  source: string,
  candidateFor: (n: number) => string
): string | null {
  for (let n = 0; n < 10_000; n++) {
    const parked = candidateFor(n)
    // Prefer a GENUINE no-replace move: link() atomically fails EEXIST when
    // anything occupies the candidate name and can never replace it, closing
    // the claim-then-rename window below (between closing the claim marker
    // and renaming onto it, another writer could in principle re-create or
    // write into the claim, and rename would clobber those bytes). Hard
    // links also cost nothing for multi-gigabyte legacy files. NTFS and
    // every POSIX filesystem support them; exFAT/FAT32 fall back below.
    let linked = false
    try {
      fs.linkSync(source, parked)
      linked = true
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') continue
      if (code === 'ENOENT') return null // source is gone - nothing to park
      // Fall through to the claim-marker rename path ONLY when the
      // filesystem cannot provide hard-link semantics at all (exFAT/FAT32
      // report EPERM on Windows; ENOTSUP/EOPNOTSUPP/ENOSYS elsewhere; EXDEV
      // cannot happen for a same-directory candidate except on filesystems
      // that refuse links outright; EMLINK means this inode cannot take
      // another name while rename still can). Any OTHER failure (EIO,
      // EACCES, ENOSPC, ...) is a real error, not a capability gap - the
      // fallback's claim-close-rename window is a clobber risk that is only
      // acceptable when no atomic no-replace primitive exists, so fail
      // closed instead of degrading to it.
      if (!LINK_UNSUPPORTED_CODES.has(code ?? '')) return null
    }
    if (linked) {
      try {
        fs.unlinkSync(source)
        return parked
      } catch {
        // Could not drop the source name (locked). Remove the extra link so
        // the source stays the file's only name; the caller reports failure.
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
      // Could not move (source locked/missing). Remove the empty claim
      // marker; the source stays where it was.
      try {
        fs.unlinkSync(parked)
      } catch {}
      return null
    }
  }
  return null
}

/** Move orphan staged bytes (`<final>.part` with no readable sidecar) aside
 *  to a unique non-model name instead of deleting them: they may be
 *  quarantined data from the legacy migration whose provenance is unknown -
 *  never a new job's to claim (resuming into foreign bytes corrupts the
 *  model) and never its to destroy. The parked name has no model extension
 *  and no staging suffix, so it is invisible to both ComfyUI's scan and
 *  launcher discovery. Returns false when the bytes could not be moved. */
export function quarantineOrphanStagedBytes(finalPath: string): boolean {
  const stagingPath = stagingPathFor(finalPath)
  return (
    parkFileNoClobber(stagingPath, (n) =>
      n === 0 ? stagingPath + '.orphan' : stagingPath + `.orphan-${n}`
    ) !== null
  )
}

/** Streaming lowercase-hex sha256 of a file. Resolves on 'close' (not 'end')
 *  so the fd is released before any following rm/rename, avoiding EBUSY on
 *  Windows. Shared by the model transport and ComfyBuilder archive install. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('close', () => resolve(hash.digest('hex')))
  })
}

/** Byte-for-byte comparison in 1 MiB chunks, async so a multi-gigabyte model
 *  compare cannot block the main process. Any read failure counts as a
 *  mismatch - "same content" must never be assumed. */
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

/**
 * Install verified staged bytes at the final name without overwriting a file
 * that appeared there independently. An identical final is accepted and the
 * staged copy is removed; a different final is preserved and reported as a
 * conflict. Filesystems without atomic hard-link support fail closed and keep
 * the staged bytes for retry.
 */
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

/** Ensure a job admitted to the in-memory registry has a COMPLETE hydratable
 *  staging pair on disk (`.part` plus v2 sidecar) before its first transfer
 *  starts, so a quit/crash in that window cannot lose the job. An existing
 *  sidecar is a previous attempt's resume identity (validators, expected
 *  size) and is never clobbered - only its missing `.part` is restored.
 *  Orphan `.part` bytes without a sidecar (possibly quarantined migration
 *  data) are parked aside, never claimed or overwritten. Returns false when
 *  the durable pair could not be established - the job must not be admitted
 *  as if it were restart-safe. */
export function ensureStagedPlaceholder(finalPath: string, meta: StagedDownloadMeta): boolean {
  const metaPath = stagingMetaPathFor(finalPath)
  const stagingPath = stagingPathFor(finalPath)
  if (readStagedMeta(metaPath) !== null) {
    if (fs.existsSync(stagingPath)) return true
    // The pair is only hydratable when both files exist: restore a missing
    // `.part` (e.g. removed by a scanner) as an empty file; the sidecar's
    // resume identity stays authoritative.
    try {
      fs.writeFileSync(stagingPath, '')
      return true
    } catch {
      return false
    }
  }
  if (fs.existsSync(stagingPath) && !quarantineOrphanStagedBytes(finalPath)) {
    // Writing the placeholder over unmovable orphan bytes would destroy them.
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
  /** Final destination the staged bytes belong to. */
  finalPath: string
  /** Bytes already staged on disk. */
  stagedBytes: number
  meta: StagedDownloadMeta
}

/** Synchronously re-read a staged pair. Hydration calls this in the same
 *  event-loop turn that registers the restored job: the async discovery scan
 *  ran earlier, and a destructive cancel's deferred cleanup may have deleted
 *  the pair in between - registering from the stale snapshot would resurrect
 *  the destination the user cancelled. Returns null when the pair is no
 *  longer hydratable (sidecar unreadable or `.part` missing). */
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

/** Directory names that can never contain launcher-staged model files. */
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__'])

/** Recursive suffix scan. In `strict` mode only a missing directory
 *  (ENOENT/ENOTDIR - normal for optional roots) is ignored; any other
 *  enumeration failure (EACCES/EIO/...) propagates, because a tree we could
 *  not list may hide artifacts the caller must act on. Strict mode also has
 *  no depth cutoff: silently stopping partway would certify a scan that
 *  never covered the deeper tree (cycles are not a risk - symlinks and
 *  junctions report as non-directories and are never descended). Lenient
 *  mode swallows everything and is depth-capped - callers whose worst case
 *  is losing a Downloads row. */
async function walkForSuffix(
  dir: string,
  suffix: string,
  depth: number,
  out: string[],
  strict = false
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
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue
      await walkForSuffix(full, suffix, depth + 1, out, strict)
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(full)
    }
  }
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

/** Result of the startup staged-download discovery pass. */
export interface StagedDownloadScanResult {
  downloads: DiscoveredStagedDownload[]
  /** Final-extension files KNOWN to be broken (a crashed install's zero-byte
   *  claim marker that could not be moved aside) and still visible to
   *  ComfyUI's model scan. Callers must gate launch on this being empty. */
  unsafeFinalPaths: string[]
}

/**
 * Discover launcher-owned staged downloads under `roots` (model roots only -
 * never cache or output dirs). A sidecar without its `.part` file is stale
 * bookkeeping and is deleted. A lone `.part` without a sidecar is left in
 * place untouched: it may be quarantined data from an ambiguous migration,
 * and it is invisible to ComfyUI's model scan, so preserving it is safe.
 *
 * The walk is STRICT: a root we cannot fully enumerate (EACCES/EIO/...)
 * propagates instead of scanning as empty, because this pass is also what
 * finds zero-byte final-name claim markers (`unsafeFinalPaths`) - a swallowed
 * failure would certify "no broken finals" over a tree that was never
 * checked. The caller treats a failed scan as unsafe and gates launch.
 */
export async function scanForStagedDownloads(
  roots: readonly string[]
): Promise<StagedDownloadScanResult> {
  const metaFiles: string[] = []
  const tmpFiles: string[] = []
  for (const root of dedupeResolved([...roots])) {
    await walkForSuffix(root, STAGING_META_SUFFIX, 0, metaFiles, true)
    await walkForSuffix(root, STAGING_META_SUFFIX + STAGING_META_TMP_SUFFIX, 0, tmpFiles, true)
  }
  // Scratch files left behind by `writeStagedMeta`. A VALID scratch copy is
  // always the newest durably written sidecar content (see `readStagedMeta`),
  // so promote it over whatever the main sidecar holds - a stale main sidecar
  // must never win (its outdated expectedSize could finalize an incomplete
  // file). A torn/garbage scratch copy from a crash mid-write is scrap.
  for (const tmpPath of tmpFiles) {
    const mainPath = tmpPath.slice(0, -STAGING_META_TMP_SUFFIX.length)
    if (readMetaFile(tmpPath) !== null) {
      try {
        await fs.promises.rename(tmpPath, mainPath)
      } catch {
        // Rename-over-existing can fail transiently on Windows (EPERM/EBUSY);
        // clear the stale target and retry once.
        try {
          await fs.promises.unlink(mainPath)
        } catch {}
        try {
          await fs.promises.rename(tmpPath, mainPath)
        } catch {
          // Promotion failed (locked file / permissions). The scratch copy is
          // the ONLY current resume identity for these staged bytes - keep it.
          // Discovery below still works: `readStagedMeta` prefers the `.tmp`.
        }
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
    // Only model files are ever launcher-staged. A pair whose final name has
    // no recognized model extension is not ours to manage (or delete) - it is
    // also invisible to ComfyUI's model scan, so leaving it is safe.
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
      // Unreadable sidecar or missing staged bytes - not resumable. Remove the
      // sidecar (and its `.tmp` fallback copy, which `readStagedMeta` would
      // otherwise keep rediscovering); leave any `.part` bytes alone (see
      // docstring).
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
        // A zero-byte file under the final model name next to OUR staged pair
        // is a crashed install's claim marker (the link-less install fallback
        // creates the final name empty, then renames the verified bytes onto
        // it) - never a real model. This must run even when the staged bytes
        // are ALSO empty (the durable placeholder before any byte lands):
        // two empty files would satisfy the identical-bytes branch below and
        // delete the pair while leaving the zero-byte fake model visible.
        // Hide it before ComfyUI can scan it as a broken model; the staged
        // pair hydrates as a normal paused job below. Park (no-clobber
        // move), never delete in place: any bytes an external writer landed
        // since the stat above survive under the parked non-model name. The
        // parked file is then left alone even when it still looks empty - a
        // writer that already had the original name open can land bytes at
        // ANY later moment, and a stat-then-unlink here would drop those
        // bytes into an unlinked inode. A still-empty parked
        // `.part`-suffixed file is inert clutter, never a model. If the file
        // cannot be moved (locked), the broken-looking final name stays
        // visible - surface it as unsafe so a warning row is shown and jobs
        // for that exact destination are refused until it can be cleared.
        const parked = parkFileNoClobber(finalPath, (n) =>
          n === 0
            ? finalPath + '.claimed' + STAGING_SUFFIX
            : finalPath + `.claimed-${n}` + STAGING_SUFFIX
        )
        if (parked === null) {
          unsafeFinalPaths.push(finalPath)
        }
      } else if (finalSize === stagedBytes && (await filesHaveSameBytes(partPath, finalPath))) {
        // Byte-identical content proves the staged copy is redundant (crash
        // between install and sidecar cleanup - after a hard-link install
        // both names even share an inode).
        removeStagedArtifacts(finalPath)
        continue
      }
      // Anything else is a CONFLICT: the staged bytes are a verified download
      // in their own right and must not be destroyed because a different file
      // occupies the final name (e.g. the user dropped in another model).
      // Keep the pair and hydrate it as a paused job - resuming it surfaces
      // the conflict through the transport's no-clobber comparison.
    }
    found.push({ finalPath, stagedBytes, meta })
  }
  return { downloads: found, unsafeFinalPaths }
}

/** Models-subdirectory of `filePath` relative to its scan root (e.g.
 *  `loras/sub`), falling back to the parent dir name when outside the root. */
function relativeModelDirectory(root: string, filePath: string): string {
  const rel = path.relative(path.resolve(root), path.resolve(path.dirname(filePath)))
  if (rel === '' || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return path.basename(path.dirname(filePath))
  }
  return rel.split(path.sep).join('/')
}

export interface LegacyMigrationResult {
  /** Exact-size pairs finalized in place (sidecar removed, file kept). */
  finalized: string[]
  /** Incomplete pairs converted to staged `.part` + v2 sidecar (resumable). */
  staged: string[]
  /** Sidecars removed because their data file was missing. */
  removedStaleMeta: string[]
  /** Data files quarantined to `.part` without a resumable sidecar
   *  (unreadable legacy meta - preserved, hidden from ComfyUI). */
  quarantined: string[]
  /** Known-incomplete files that could NOT be hidden from ComfyUI's model
   *  scan (move failed - e.g. the file is locked). Left with their legacy
   *  sidecar so the next launch retries; callers should surface these. */
  unsafe: string[]
}

/**
 * Migrate legacy `<model>` + `<model>.dl-meta` pairs (from releases where the
 * template task downloaded directly to the final path) BEFORE ComfyUI can
 * scan the model dirs. Only files with a recognized model extension are
 * touched. Exact-size pairs are finalized by the same integrity standard the
 * new transport uses (on-disk size == recorded expectedSize); anything else
 * becomes staged/quarantined. User model data is never deleted merely
 * because migration is ambiguous.
 */
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
  for (const root of dedupeResolved([...roots])) {
    const files: string[] = []
    // Strict walk: a root we cannot enumerate (EACCES/EIO/...) may hide
    // legacy truncated files under final model names. Swallowing the error
    // would certify a scan that never happened - propagate instead; the
    // caller treats a failed migration pass as unsafe and gates launch.
    await walkForSuffix(root, LEGACY_META_SUFFIX, 0, files, true)
    for (const metaPath of files) metaFilesByRoot.push({ root, metaPath })
  }
  const seenData = new Set<string>()
  for (const { root, metaPath } of metaFilesByRoot) {
    if (metaPath.endsWith(STAGING_META_SUFFIX)) continue // v2 sidecar, not legacy
    const dataPath = metaPath.slice(0, -LEGACY_META_SUFFIX.length)
    if (!hasModelExtension(path.basename(dataPath))) continue // not a model artifact
    const dataKey = path.resolve(dataPath).toLowerCase()
    if (seenData.has(dataKey)) continue // overlapping roots
    seenData.add(dataKey)
    let dataSize = -1
    try {
      const stat = await fs.promises.stat(dataPath)
      if (stat.isFile()) dataSize = stat.size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Cannot prove whether the data file exists (EACCES/EIO/...). It may
        // be a truncated model visible to ComfyUI - do NOT remove its resume
        // identity below; report unsafe so launch is gated and retried.
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
      // Complete by the same standard the new transport enforces - finalize.
      try {
        await fs.promises.unlink(metaPath)
        result.finalized.push(dataPath)
      } catch {}
      continue
    }

    // Incomplete or ambiguous: hide the bytes from ComfyUI's scan by moving
    // them to the staging name; keep them resumable when the source is known.
    const partPath = stagingPathFor(dataPath)
    if (fs.existsSync(partPath)) {
      // A v2 staged file already exists for this destination; keep it as
      // the authoritative partial and park the legacy bytes untouched under
      // a non-colliding, non-model name (atomic no-clobber - a plain rename
      // could destroy previously parked bytes). The partial MUST leave its
      // model extension, so on failure to move it leave the legacy sidecar
      // in place (retried next launch) rather than record a success.
      const parked = parkFileNoClobber(dataPath, (n) =>
        n === 0 ? dataPath + '.legacy' + STAGING_SUFFIX : dataPath + `.legacy-${n}` + STAGING_SUFFIX
      )
      if (!parked) {
        result.unsafe.push(dataPath)
        continue
      }
      result.quarantined.push(parked)
      // The bytes are hidden from ComfyUI's scan - a leftover legacy sidecar
      // without its data file is just stale bookkeeping, removed next launch.
      try {
        await fs.promises.unlink(metaPath)
      } catch {}
      continue
    }
    // Sidecar FIRST, data move second: a crash or failure between the two
    // steps must never leave moved bytes without their resume identity.
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
        // No durable sidecar - leave the legacy pair intact for a retry on
        // the next launch rather than orphaning unresumable bytes.
        result.unsafe.push(dataPath)
        continue
      }
    }
    // Exclusive claim on the staging name so a `.part` that appeared since
    // the collision check above is never clobbered by the rename.
    const failMove = async (): Promise<void> => {
      // Could not hide the incomplete file. Remove the just-written v2
      // sidecar (it describes a staged file that does not exist) and leave
      // the legacy pair untouched so the next launch retries.
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
        fs.unlinkSync(partPath) // remove the empty claim marker
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
