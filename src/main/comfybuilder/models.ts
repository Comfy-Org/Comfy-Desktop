/**
 * Model staging: the models half of a Builder build install.
 *
 * A build archive carries only code and the environment (`venv/` +
 * `ComfyUI/`), never model weights. After the archive extracts, this stages the
 * build's declared models into the install's own ComfyUI model tree so
 * they are present before ComfyUI starts, mirroring how comfy-deploy provisions
 * weights onto a volume before boot.
 *
 * Placement is `<installPath>/ComfyUI/models/<type>/<filename>`, the install's
 * built-in model root. That root is always on ComfyUI's model search path, so a
 * staged model is found whether or not the user shares a global model library.
 * `<type>` may be NESTED (`diffusers/<model>/unet`) - a Diffusers tree is many
 * models under one parent, and Cloud seals such types.
 *
 * Every model transfer is a REAL managed job in `comfyDownloadManager` - the
 * same job type as in-Comfy and starter-template model downloads. Jobs appear
 * in the Downloads tray, download to a staged `.part` + sidecar pair (never
 * partial bytes under a model extension), and their staged bytes survive
 * failures and app restarts, so a re-run resumes rather than re-fetching.
 * The job surface is INJECTED by the caller: the download manager imports the
 * source registry, which includes the ComfyBuilder plugin, so importing it
 * here at runtime would be a cycle.
 *
 * Integrity is expressed as an ALGORITHM-TAGGED digest - BLAKE3 when the build
 * was sealed with one, else the SHA-256 older sealed manifests carry - which
 * the managed transport verifies byte-for-byte before the file appears under
 * its final name. A file already at the destination must match that digest to
 * be kept; a mismatch is a conflict, never silently overwritten.
 *
 * Whether a digest is REQUIRED depends on the install:
 *   - A model with NO usable hash in either field is refused when the manifest
 *     declared one anyway - a malformed hash is a broken or tampered manifest,
 *     never a licence to skip verification.
 *   - A manifest that declares no hash at all is staged unverified on an
 *     ordinary install, because public model sources may legitimately omit it
 *     (the API accepts such manifests, so staging must too).
 *   - The same hashless model is REFUSED on a governed install. A managed
 *     installation exists to guarantee that what runs is what its organization
 *     signed off, which it cannot do for bytes it has no way to verify.
 *
 * The two fields are tried in order, so a malformed `blake3` alongside a valid
 * `sha256` verifies under SHA-256 rather than failing: verification still
 * happens byte-for-byte, and anyone able to corrupt one manifest field can
 * corrupt the other, so refusing would cost availability and buy nothing.
 */
import fs from 'fs'
import path from 'path'

import type { ModelJobHandle, ModelJobOptions, ModelJobOutcome } from '../lib/comfyDownloadManager'
import { governedModelDigests, readGovernanceMarker } from './governance'
import {
  declaresModelIntegrity,
  digestKey,
  isSecureDownloadUrl,
  selectModelDigest
} from './integrity'
import { createModelLedgerEntry, writeModelLedger } from './modelLedger'
import type { ModelLedgerEntry } from './modelLedger'
import type { ModelDescriptor, StageProgress } from './types'

export type StageModelsErrorKind = 'invalid-model' | 'model-checksum-mismatch' | 'model-conflict'

export class StageModelsError extends Error {
  override name = 'StageModelsError'
  readonly kind: StageModelsErrorKind
  constructor(kind: StageModelsErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** The managed model-download surface, narrowed to what staging needs and
 *  injected by the caller (import-cycle firewall; also lets tests fake it). */
export interface ModelJobSurface {
  start: (opts: ModelJobOptions) => Promise<ModelJobHandle>
  /** Destructive cancel by job id; used on abort so rollback never races a
   *  still-open download stream inside the install's model tree. */
  cancel: (id: string) => boolean
}

export interface StageModelsOptions {
  models: readonly ModelDescriptor[]
  /** The install root (the dir that contains `ComfyUI/`). */
  installPath: string
  /** Install record id, so jobs are attributed to this install. */
  installationId?: string | null
  /** The install record's governance marker, AS STORED. Deliberately untyped:
   *  it is validated here by {@link readGovernanceMarker}, and a caller that
   *  narrowed it first would have to collapse "present but unparseable" into
   *  "absent", which is precisely the distinction the integrity rule below
   *  depends on. */
  governance?: unknown
  jobs: ModelJobSurface
  onProgress?: (p: StageProgress) => void
  signal?: AbortSignal
}

/** Transient-failure retry budget per model. The managed job keeps its staged
 *  bytes on error, so a retry RESUMES from the prior byte count. Integrity
 *  failures (checksum/conflict) are deterministic and never retried. */
const MODEL_DOWNLOAD_RETRIES = 2

/** Progress is forwarded to the install stepper over IPC; the managed job's
 *  onProgress fires per chunk, so sample it down. */
const PROGRESS_REPORT_MS = 500

/** A single path segment that cannot escape its parent: no separators, no `..`,
 *  no drive/absolute markers. Guards the `<filename>` half of
 *  `models/<type>/<filename>` against a manifest that tries to traverse out of
 *  the model tree. A filename is ALWAYS exactly one segment - a manifest that
 *  smuggles a separator into it is refused, not split. */
function isSafeSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false
  if (seg.includes('/') || seg.includes('\\') || seg.includes('\0')) return false
  if (path.isAbsolute(seg) || /^[a-zA-Z]:/.test(seg)) return false
  return true
}

/** One safe directory segment, mirroring Cloud's `modelDirSegmentPattern`
 *  (`cloud/common/model_directories.go`). Alphanumeric-led is what rules out
 *  traversal, leading dots, drive prefixes, separators and whitespace in a
 *  single expression. */
const MODEL_DIR_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/

/** Bounds the path, and so its depth. Cloud's `maxModelDirLen`. */
const MAX_MODEL_DIR_LEN = 255

/** Roots ComfyUI reads as config or code rather than weights, so a "model"
 *  placed under either would be imported instead of loaded. Cloud's
 *  `reservedModelDirRoots`. */
const RESERVED_MODEL_DIR_ROOTS = new Set(['configs', 'custom_nodes'])

/** DOS device names, which the install cannot create a directory for on
 *  Windows. Cloud's `windowsReservedNames`. */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

/**
 * `type` is a RELATIVE, possibly MULTI-SEGMENT directory under `models/`. Cloud
 * deliberately seals nested types (`text_encoders/gemma_3_12b_it_hf`,
 * `diffusers/Kolors/unet`), so validating the whole type as ONE segment rejected
 * every distribution carrying one - a Diffusers distribution could never install.
 *
 * The rule is Cloud's `common.ValidModelDir` segment grammar, so neither side can
 * accept what the other rejects. A leading, trailing or doubled `/`, a `..`, and
 * an absolute or drive-prefixed path all fail as an unmatched segment.
 *
 * Deliberately NOT mirrored: Cloud's vetted-directory allow-list and its
 * rejection of case variants of it, which exist so Cloud's model mirror cannot
 * presign a URL that 404s. Desktop is handed a ready-to-GET `downloadUrl` and has
 * no way to keep a copy of that list in sync; Cloud's own
 * `TestVettedDirectoriesSatisfyTheSegmentRule` pins every vetted entry as
 * grammar-valid, so this rule still accepts everything Cloud can seal.
 *
 * Containment stays enforced separately by {@link isContained} once the directory
 * exists - no grammar can see a symlinked segment.
 */
function isSafeModelDir(dir: string): boolean {
  if (!dir || dir.length > MAX_MODEL_DIR_LEN) return false
  const segments = dir.split('/')
  if (RESERVED_MODEL_DIR_ROOTS.has(segments[0]!.toLowerCase())) return false
  for (const segment of segments) {
    if (!MODEL_DIR_SEGMENT.test(segment) || segment.endsWith('.')) return false
    if (WINDOWS_RESERVED_NAMES.has(segment.split('.')[0]!.toUpperCase())) return false
  }
  return true
}

/** The real path of `dir` is inside `root` (defends against a symlinked model
 *  subdir in the extracted archive redirecting a write outside the install). */
function isContained(root: string, dir: string): boolean {
  try {
    const realRoot = fs.realpathSync(root)
    const realDir = fs.realpathSync(dir)
    return realDir === realRoot || realDir.startsWith(realRoot + path.sep)
  } catch {
    return false
  }
}

/** The install's built-in ComfyUI models root, `<installPath>/ComfyUI/models`. */
export function installModelsRoot(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'models')
}

/** Run one managed job to completion, translating its outcome. Abort cancels
 *  the job destructively and waits for its teardown to settle, so the staged
 *  files inside the install tree are gone before rollback renames it. */
async function runModelJob(
  jobs: ModelJobSurface,
  opts: ModelJobOptions,
  model: ModelDescriptor,
  signal: AbortSignal | undefined
): Promise<ModelJobOutcome> {
  const handle = await jobs.start(opts)
  const onAbort = (): void => {
    jobs.cancel(handle.id)
  }
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const outcome = await handle.completion
    if (outcome.status === 'error') {
      if (outcome.code === 'checksum-mismatch') {
        throw new StageModelsError(
          'model-checksum-mismatch',
          `Model ${model.type}/${model.filename} checksum mismatch: ${outcome.error}`
        )
      }
      if (outcome.code === 'existing-file-mismatch') {
        throw new StageModelsError(
          'model-conflict',
          `Model ${model.type}/${model.filename} conflicts with a different existing file.`
        )
      }
    }
    return outcome
  } finally {
    signal?.removeEventListener('abort', onAbort)
    handle.release()
  }
}

/**
 * Download + verify + place each model under `<installPath>/ComfyUI/models`.
 * Throws {@link StageModelsError} on an unsafe path or a checksum mismatch. A
 * model already present with a matching hash is skipped, so a resumed or
 * repeated install does not re-download what is already staged.
 */
export async function stageModels(opts: StageModelsOptions): Promise<void> {
  const { models, installPath, installationId, governance, jobs, onProgress, signal } = opts
  const total = models.length
  const modelsRoot = installModelsRoot(installPath)
  const installation = { installPath, governance }
  const governanceState = readGovernanceMarker(installation)
  // Only an ABSENT marker means "ordinary install". A marker that exists but
  // does not parse is a managed install whose record was truncated or edited,
  // so it must keep the stricter rule - otherwise corrupting one field of the
  // installation record would be a way to buy the right to stage unverifiable
  // models.
  const integrityRequired = governanceState.kind !== 'absent'
  const modelGovernanceActive =
    governanceState.kind === 'governed' && governanceState.marker.activeForms.includes('model')
  const approvedModelDigests = modelGovernanceActive
    ? await governedModelDigests(installation)
    : null
  const ledgerEntries: ModelLedgerEntry[] = []

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new Error('Cancelled')
    const model = models[i]!
    const index = i + 1

    if (!isSafeModelDir(model.type) || !isSafeSegment(model.filename)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} has an unsafe path.`
      )
    }
    if (!isSecureDownloadUrl(model.downloadUrl)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} download URL must be https.`
      )
    }
    // Prefer BLAKE3, fall back to the SHA-256 older sealed manifests carry.
    // A DECLARED value that does not parse is always fatal; a manifest that
    // declares nothing is fatal only under governance (see the file header).
    const digest = selectModelDigest(model)
    if (!digest) {
      if (declaresModelIntegrity(model)) {
        throw new StageModelsError(
          'invalid-model',
          `Model ${model.type}/${model.filename} has an invalid BLAKE3 or SHA-256 integrity value.`
        )
      }
      if (integrityRequired) {
        throw new StageModelsError(
          'invalid-model',
          `Model ${model.type}/${model.filename} carries no BLAKE3 or SHA-256 integrity value, ` +
            'and a managed installation cannot stage a model it is unable to verify.'
        )
      }
    }

    const destDir = path.join(modelsRoot, model.type)
    // Create the target dir first, then confirm it really resolves inside the
    // install: a malicious archive can ship `ComfyUI/models/<type>` as a symlink
    // pointing outside, and writing through it would escape the install.
    fs.mkdirSync(destDir, { recursive: true })
    if (!isContained(installPath, destDir)) {
      throw new StageModelsError(
        'invalid-model',
        `Model directory ${model.type} escapes the install.`
      )
    }

    const dest = path.join(destDir, model.filename)
    // Legacy leftover from the pre-managed-job staging flow, which downloaded
    // to a bare `.partial` sibling; it can never be resumed or finalized now.
    await fs.promises.rm(`${dest}.partial`, { force: true }).catch(() => {})

    onProgress?.({ index, total, filename: model.filename, percent: 0 })
    let lastReport = 0
    let lastReportBytes = 0
    const jobOptions: ModelJobOptions = {
      url: model.downloadUrl,
      filename: model.filename,
      directory: model.type,
      installationId,
      ...(digest ? { digest } : {}),
      // Always the install's own model tree, even when the install's model
      // settings would route interactive downloads to a shared root - and the
      // caller holds this root's download lock for the whole transaction.
      destinationBaseDir: modelsRoot,
      bypassRootLockFor: modelsRoot,
      onProgress: (receivedBytes, totalBytes) => {
        const now = Date.now()
        if (now - lastReport < PROGRESS_REPORT_MS) return
        // Rate over the sample window, not since the start: a resumed job
        // begins mid-file, so a from-zero average would overstate the speed.
        const windowSecs = lastReport > 0 ? (now - lastReport) / 1000 : 0
        const windowBytes = receivedBytes - lastReportBytes
        const speed = windowSecs > 0 && windowBytes > 0 ? windowBytes / windowSecs : undefined
        lastReport = now
        lastReportBytes = receivedBytes
        onProgress?.({
          index,
          total,
          filename: model.filename,
          percent: totalBytes > 0 ? Math.min(100, (receivedBytes / totalBytes) * 100) : 0,
          receivedBytes,
          ...(totalBytes > 0 ? { totalBytes } : {}),
          ...(speed !== undefined ? { speedBytesPerSec: speed } : {}),
          ...(speed !== undefined && totalBytes > 0
            ? { etaSecs: Math.max(0, totalBytes - receivedBytes) / speed }
            : {})
        })
      }
    }

    let outcome: ModelJobOutcome | undefined
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new Error('Cancelled')
      outcome = await runModelJob(jobs, jobOptions, model, signal)
      if (outcome.status !== 'error' || attempt >= MODEL_DOWNLOAD_RETRIES) break
    }
    if (signal?.aborted || outcome.status === 'cancelled') throw new Error('Cancelled')
    if (outcome.status === 'error') {
      // Integrity failures were already thrown as StageModelsError inside
      // runModelJob; whatever reaches here is a transport/filesystem failure.
      throw new Error(`Model ${model.type}/${model.filename} download failed: ${outcome.error}`)
    }
    const ledgerDigest = digest?.algo === 'blake3' ? digestKey(digest) : undefined
    if (ledgerDigest && approvedModelDigests?.has(ledgerDigest)) {
      // The job's own `savePath`, never a recomputed one: the download manager
      // strips query params from the filename, so a recomputed path can name a
      // file that was never written and fail the ledger's realpath outright.
      ledgerEntries.push(await createModelLedgerEntry(outcome.savePath ?? dest, ledgerDigest))
    }
    onProgress?.({ index, total, filename: model.filename, percent: 100 })
  }

  // Written whenever the model form is active, INCLUDING with no entries: a
  // run that approves nothing must supersede a ledger left by an earlier
  // policy, not leave it standing as though it still described this install.
  if (modelGovernanceActive) await writeModelLedger(installPath, ledgerEntries)
}
