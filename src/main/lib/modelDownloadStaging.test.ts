import fs from 'fs'
import os from 'os'
import path from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LEGACY_META_SUFFIX,
  STAGING_META_SUFFIX,
  STAGING_SUFFIX,
  ensureStagedPlaceholder,
  hasModelExtension,
  migrateLegacyModelDownloadArtifacts,
  quarantineOrphanStagedBytes,
  readStagedMeta,
  removeStagedArtifacts,
  scanForStagedDownloads,
  sha256File,
  stagingMetaPathFor,
  stagingPathFor,
  writeStagedMeta,
  type StagedDownloadMeta
} from './modelDownloadStaging'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-staging-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function validMeta(overrides: Partial<StagedDownloadMeta> = {}): StagedDownloadMeta {
  return {
    version: 2,
    url: 'https://example.com/model.safetensors',
    expectedSize: 1000,
    etag: '"abc123"',
    directory: 'checkpoints',
    filename: 'model.safetensors',
    ...overrides
  }
}

describe('sha256File', () => {
  it('hashes a complete file', async () => {
    const filePath = path.join(tmpDir, 'small.bin')
    fs.writeFileSync(filePath, 'abc')
    await expect(sha256File(filePath)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('rejects when the read stream closes before end', async () => {
    const stream = new PassThrough()
    const createReadStreamSpy = vi
      .spyOn(fs, 'createReadStream')
      .mockReturnValue(stream as unknown as ReturnType<typeof fs.createReadStream>)
    try {
      const result = sha256File(path.join(tmpDir, 'partial.bin'))
      stream.write('partial')
      stream.destroy()
      await expect(result).rejects.toThrow('sha256 read stream closed before end of file')
    } finally {
      createReadStreamSpy.mockRestore()
    }
  })
})

describe('staging path scheme', () => {
  it('derives the .part and .part.dl-meta paths from the final path', () => {
    const finalPath = path.join(tmpDir, 'checkpoints', 'model.safetensors')
    expect(stagingPathFor(finalPath)).toBe(finalPath + STAGING_SUFFIX)
    expect(stagingMetaPathFor(finalPath)).toBe(finalPath + STAGING_META_SUFFIX)
  })

  it('never produces a staged name with a recognized model extension', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    expect(hasModelExtension(path.basename(stagingPathFor(finalPath)))).toBe(false)
    expect(hasModelExtension(path.basename(stagingMetaPathFor(finalPath)))).toBe(false)
  })
})

describe('readStagedMeta / writeStagedMeta', () => {
  it('round-trips a valid v2 sidecar', () => {
    const metaPath = path.join(tmpDir, 'model.safetensors' + STAGING_META_SUFFIX)
    const meta = validMeta({ lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT' })
    writeStagedMeta(metaPath, meta)
    expect(readStagedMeta(metaPath)).toEqual(meta)
  })

  it('returns null for malformed JSON', () => {
    const metaPath = path.join(tmpDir, 'bad' + STAGING_META_SUFFIX)
    fs.writeFileSync(metaPath, '{ not json')
    expect(readStagedMeta(metaPath)).toBeNull()
  })

  it('returns null for a wrong version', () => {
    const metaPath = path.join(tmpDir, 'v1' + STAGING_META_SUFFIX)
    fs.writeFileSync(metaPath, JSON.stringify({ ...validMeta(), version: 1 }))
    expect(readStagedMeta(metaPath)).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    const metaPath = path.join(tmpDir, 'partial' + STAGING_META_SUFFIX)
    fs.writeFileSync(metaPath, JSON.stringify({ version: 2, url: 'https://example.com/x' }))
    expect(readStagedMeta(metaPath)).toBeNull()
  })

  it('returns null for a missing file', () => {
    expect(readStagedMeta(path.join(tmpDir, 'nope' + STAGING_META_SUFFIX))).toBeNull()
  })

  it('prefers a valid .tmp sidecar over a stale main sidecar (newest durable write wins)', () => {
    // A rewrite whose replacing rename failed leaves the NEWEST content in
    // .tmp while the main sidecar still holds stale content. Resuming or
    // finalizing against the stale expectedSize would be wrong.
    const metaPath = path.join(tmpDir, 'model.safetensors' + STAGING_META_SUFFIX)
    fs.writeFileSync(metaPath, JSON.stringify(validMeta({ expectedSize: 10, etag: '"stale"' })))
    fs.writeFileSync(
      metaPath + '.tmp',
      JSON.stringify(validMeta({ expectedSize: 20, etag: '"newer"' }))
    )
    const meta = readStagedMeta(metaPath)
    expect(meta?.expectedSize).toBe(20)
    expect(meta?.etag).toBe('"newer"')
  })

  it('falls back to the main sidecar when the .tmp copy is torn', () => {
    const metaPath = path.join(tmpDir, 'model.safetensors' + STAGING_META_SUFFIX)
    fs.writeFileSync(metaPath, JSON.stringify(validMeta({ expectedSize: 10 })))
    // Crash mid-write leaves a torn scratch copy - it must not mask the
    // valid main sidecar.
    fs.writeFileSync(metaPath + '.tmp', '{ torn')
    expect(readStagedMeta(metaPath)?.expectedSize).toBe(10)
  })

  it('rewrites an existing sidecar in place without leaving the temp file', () => {
    // Sidecars are updated repeatedly across a job's life (per response,
    // validator refresh) - replacement of an EXISTING file must work and
    // leave no scratch litter, including on Windows.
    const metaPath = path.join(tmpDir, 'model.safetensors' + STAGING_META_SUFFIX)
    writeStagedMeta(metaPath, validMeta({ expectedSize: 10, etag: '"v1"' }))
    writeStagedMeta(metaPath, validMeta({ expectedSize: 20, etag: '"v2"' }))
    writeStagedMeta(metaPath, validMeta({ expectedSize: 30, etag: '"v3"' }))
    const meta = readStagedMeta(metaPath)
    expect(meta?.expectedSize).toBe(30)
    expect(meta?.etag).toBe('"v3"')
    expect(fs.existsSync(metaPath + '.tmp')).toBe(false)
  })
})

describe('removeStagedArtifacts', () => {
  it('removes both the staged bytes and the sidecar', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'partial')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())
    removeStagedArtifacts(finalPath)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })

  it('is a no-op when nothing is staged', () => {
    expect(() => removeStagedArtifacts(path.join(tmpDir, 'model.safetensors'))).not.toThrow()
  })
})

describe('scanForStagedDownloads', () => {
  it('discovers a resumable pair with its staged byte count', async () => {
    const dir = path.join(tmpDir, 'checkpoints')
    fs.mkdirSync(dir, { recursive: true })
    const finalPath = path.join(dir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), Buffer.alloc(123))
    const meta = validMeta()
    writeStagedMeta(stagingMetaPathFor(finalPath), meta)

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(1)
    expect(found[0]!.finalPath).toBe(finalPath)
    expect(found[0]!.stagedBytes).toBe(123)
    expect(found[0]!.meta).toEqual(meta)
  })

  it('deletes a sidecar whose .part file is missing and does not report it', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(0)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })

  it('deletes an unreadable sidecar but preserves the .part bytes', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'bytes')
    fs.writeFileSync(stagingMetaPathFor(finalPath), 'not json at all')

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(0)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
  })

  it('leaves a lone .part without a sidecar untouched and unreported', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'quarantined bytes')

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(0)
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('quarantined bytes')
  })

  it('drops redundant staging when the final file has identical bytes', async () => {
    // Crash between install and sidecar cleanup: final and staged copies are
    // byte-identical, so the staging pair is provably redundant.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(finalPath, 'the real model')
    fs.writeFileSync(stagingPathFor(finalPath), 'the real model')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(0)
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('the real model')
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })

  it('keeps a staged pair whose final name holds DIFFERENT content and hydrates it', async () => {
    // A different file at the final name (e.g. the user dropped in another
    // model) does not make the staged bytes disposable: keep the pair and
    // report it so it hydrates as an actionable paused job; resuming later
    // surfaces the conflict through the transport's no-clobber install.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(finalPath, 'user-provided model')
    fs.writeFileSync(stagingPathFor(finalPath), 'partial download')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(1)
    expect(found[0]?.finalPath).toBe(finalPath)
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('user-provided model')
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('partial download')
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
  })

  it('parks a zero-byte claim marker off the final name and hydrates the staged pair', async () => {
    // Crash inside the link-less install fallback: it claims the final name
    // with an empty exclusive-create marker before renaming the verified
    // bytes onto it. The zero-byte file is never a real model - ComfyUI
    // would scan it as a broken one - so the scan parks it under a non-model
    // name and the staged pair hydrates as a normal actionable paused job.
    // The parked marker is NEVER deleted, even while still empty: a writer
    // that already had the original name open can land bytes at any later
    // moment, and unlinking would drop them into an unlinked inode.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(finalPath, '')
    fs.writeFileSync(stagingPathFor(finalPath), 'downloaded bytes')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads: found, unsafeFinalPaths } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(1)
    expect(found[0]?.finalPath).toBe(finalPath)
    expect(unsafeFinalPaths).toHaveLength(0)
    expect(fs.existsSync(finalPath)).toBe(false)
    // The parked marker survives as inert non-model clutter.
    expect(fs.existsSync(finalPath + '.claimed.part')).toBe(true)
    expect(fs.statSync(finalPath + '.claimed.part').size).toBe(0)
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('downloaded bytes')
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
  })

  it('parks a zero-byte claim marker even when the staged bytes are also empty', async () => {
    // Crash right after the placeholder + claim marker were created, before
    // any byte landed: final name and .part are BOTH zero bytes. Two empty
    // files are byte-identical, so without the explicit zero-final guard the
    // redundant-staging branch would delete the pair and leave the zero-byte
    // fake model visible to ComfyUI (#1322). The marker must still be parked
    // and the empty pair must hydrate as a normal paused job.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(finalPath, '')
    fs.writeFileSync(stagingPathFor(finalPath), '')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads: found, unsafeFinalPaths } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(1)
    expect(found[0]?.finalPath).toBe(finalPath)
    expect(found[0]?.stagedBytes).toBe(0)
    expect(unsafeFinalPaths).toHaveLength(0)
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.existsSync(finalPath + '.claimed.part')).toBe(true)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
  })

  it('reports the final path as unsafe when the zero-byte claim marker cannot be moved', async () => {
    // The marker is locked (e.g. a scanner holds it open on Windows): the
    // broken-looking file stays visible under a final model name, so the
    // scan must surface it (warning row; jobs to that destination refused)
    // instead of silently hydrating
    // around it. The staged pair still hydrates as an actionable paused job.
    // Both park primitives (hard link and claim+rename fallback) fail.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(finalPath, '')
    fs.writeFileSync(stagingPathFor(finalPath), 'downloaded bytes')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation((from) => {
      if (from === finalPath) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from) => {
      if (from === finalPath) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    try {
      const { downloads: found, unsafeFinalPaths } = await scanForStagedDownloads([tmpDir])
      expect(unsafeFinalPaths).toEqual([finalPath])
      expect(fs.existsSync(finalPath)).toBe(true)
      expect(found).toHaveLength(1)
      expect(found[0]?.finalPath).toBe(finalPath)
      expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
    } finally {
      linkSpy.mockRestore()
      renameSpy.mockRestore()
    }
  })

  it('preserves bytes an external writer landed in the claim marker between stat and move', async () => {
    // TOCTOU guard: the scan stats the final name as zero bytes, but by the
    // time it moves the marker aside an external copy has started filling
    // it. The move (a rename, never an in-place delete) carries those bytes
    // to the parked non-model name, where the non-empty check preserves them.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(finalPath, '')
    fs.writeFileSync(stagingPathFor(finalPath), 'downloaded bytes')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const realStat = fs.statSync
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, ...rest) => {
      if (p === finalPath) {
        // Simulate the external writer landing bytes right after the scan's
        // zero-size observation.
        statSpy.mockRestore()
        const stat = realStat(finalPath)
        fs.writeFileSync(finalPath, 'external bytes')
        return stat
      }
      return realStat(p as fs.PathLike, ...(rest as unknown as []))
    }) as typeof fs.statSync)
    try {
      const { downloads: found, unsafeFinalPaths } = await scanForStagedDownloads([tmpDir])
      expect(unsafeFinalPaths).toHaveLength(0)
      expect(found).toHaveLength(1)
      expect(fs.existsSync(finalPath)).toBe(false)
      expect(fs.readFileSync(finalPath + '.claimed.part', 'utf-8')).toBe('external bytes')
    } finally {
      statSpy.mockRestore()
    }
  })

  it('reports each destination once for overlapping roots', async () => {
    const sub = path.join(tmpDir, 'checkpoints')
    fs.mkdirSync(sub, { recursive: true })
    const finalPath = path.join(sub, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), Buffer.alloc(7))
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads: found } = await scanForStagedDownloads([tmpDir, sub, tmpDir])
    expect(found).toHaveLength(1)
  })

  it('ignores and preserves a staged pair whose final name is not a model file', async () => {
    // Only model files are launcher-staged; a foreign .part/.dl-meta pair
    // under a model root is not ours to hydrate or delete.
    const finalPath = path.join(tmpDir, 'notes.txt')
    fs.writeFileSync(stagingPathFor(finalPath), 'abc')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta({ filename: 'notes.txt' }))
    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(0)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
  })

  it('removes crash-leftover sidecar temp files without touching the real pair', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'abc')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())
    // A crash between writeFileSync(tmp) and renameSync leaves this behind.
    const tmpLeftover = stagingMetaPathFor(finalPath) + '.tmp'
    fs.writeFileSync(tmpLeftover, '{ torn')
    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(1)
    expect(fs.existsSync(tmpLeftover)).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
  })

  it('skips node_modules-style directories', async () => {
    const skip = path.join(tmpDir, 'node_modules')
    fs.mkdirSync(skip, { recursive: true })
    const finalPath = path.join(skip, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'x')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(0)
  })

  it('promotes a valid .tmp sidecar when the durable one is missing', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'abcd')
    const metaPath = stagingMetaPathFor(finalPath)
    fs.writeFileSync(metaPath + '.tmp', JSON.stringify(validMeta({ expectedSize: 4000 })))

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(1)
    expect(found[0]!.meta.expectedSize).toBe(4000)
    expect(fs.existsSync(metaPath)).toBe(true)
    expect(fs.existsSync(metaPath + '.tmp')).toBe(false)
  })

  it('promotes a valid .tmp sidecar OVER a stale main sidecar', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'abcd')
    const metaPath = stagingMetaPathFor(finalPath)
    fs.writeFileSync(metaPath, JSON.stringify(validMeta({ expectedSize: 10, etag: '"stale"' })))
    fs.writeFileSync(
      metaPath + '.tmp',
      JSON.stringify(validMeta({ expectedSize: 4000, etag: '"newer"' }))
    )

    const { downloads: found } = await scanForStagedDownloads([tmpDir])
    expect(found).toHaveLength(1)
    // The newest durable write wins - a stale expectedSize must never
    // resume/finalize the job.
    expect(found[0]!.meta.expectedSize).toBe(4000)
    expect(found[0]!.meta.etag).toBe('"newer"')
    expect(readStagedMeta(metaPath)?.etag).toBe('"newer"')
    expect(fs.existsSync(metaPath + '.tmp')).toBe(false)
  })

  it('keeps a valid .tmp sidecar (the only resume identity) when promotion fails', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'abcd')
    const metaPath = stagingMetaPathFor(finalPath)
    const tmpPath = metaPath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(validMeta({ expectedSize: 4000 })))

    // Rename fails (e.g. a scanner holding the file open on Windows). The
    // .tmp copy is the ONLY valid resume identity - it must be preserved and
    // the job must still be discovered through the readStagedMeta fallback.
    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    try {
      const { downloads: found } = await scanForStagedDownloads([tmpDir])
      expect(found).toHaveLength(1)
      expect(found[0]!.meta.expectedSize).toBe(4000)
      expect(found[0]!.stagedBytes).toBe(4)
      expect(fs.existsSync(tmpPath)).toBe(true)
    } finally {
      renameSpy.mockRestore()
    }
  })
})

describe('quarantineOrphanStagedBytes', () => {
  it('parks orphan bytes under a unique non-model name without overwriting prior quarantines', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    const stagingPath = stagingPathFor(finalPath)

    fs.writeFileSync(stagingPath, 'first')
    expect(quarantineOrphanStagedBytes(finalPath)).toBe(true)
    fs.writeFileSync(stagingPath, 'second')
    expect(quarantineOrphanStagedBytes(finalPath)).toBe(true)

    // Both quarantines survive with distinct names ...
    expect(fs.readFileSync(stagingPath + '.orphan', 'utf-8')).toBe('first')
    expect(fs.readFileSync(stagingPath + '.orphan-1', 'utf-8')).toBe('second')
    expect(fs.existsSync(stagingPath)).toBe(false)
    // ... and no parked name is visible to ComfyUI's model scan or to
    // launcher staging discovery.
    expect(hasModelExtension(path.basename(stagingPath + '.orphan'))).toBe(false)
    expect((stagingPath + '.orphan').endsWith(STAGING_SUFFIX)).toBe(false)
  })

  it('returns false when the bytes cannot be moved', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    expect(quarantineOrphanStagedBytes(finalPath)).toBe(false) // nothing staged
  })

  it('fails closed on a real link error instead of degrading to claim+rename', () => {
    // EIO (or EACCES/ENOSPC/...) is a genuine failure, not a "hard links
    // unsupported here" capability gap: the claim-close-rename fallback has
    // a clobber window that is only acceptable when no atomic no-replace
    // primitive exists. A disk-level error must abort the parking entirely -
    // no claim marker, no rename attempt, source untouched.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    const orphanPath = stagingPathFor(finalPath)
    fs.writeFileSync(orphanPath, 'quarantined')

    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' })
    })
    const openSpy = vi.spyOn(fs, 'openSync')
    const renameSpy = vi.spyOn(fs, 'renameSync')
    try {
      expect(quarantineOrphanStagedBytes(finalPath)).toBe(false)
      // The rename fallback was never attempted.
      expect(openSpy).not.toHaveBeenCalled()
      expect(renameSpy).not.toHaveBeenCalled()
    } finally {
      linkSpy.mockRestore()
      openSpy.mockRestore()
      renameSpy.mockRestore()
    }
    expect(fs.readFileSync(orphanPath, 'utf-8')).toBe('quarantined')
    expect(fs.existsSync(orphanPath + '.orphan')).toBe(false)
  })
})

describe('ensureStagedPlaceholder', () => {
  it('creates an empty .part and a v2 sidecar so a new job is hydratable', () => {
    const dir = path.join(tmpDir, 'checkpoints')
    fs.mkdirSync(dir, { recursive: true })
    const finalPath = path.join(dir, 'model.safetensors')
    const meta = validMeta({ jobId: 'job-1', etag: undefined })

    expect(ensureStagedPlaceholder(finalPath, meta)).toBe(true)
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toEqual(meta)
  })

  it('never clobbers an existing sidecar (a previous attempt owns the resume identity)', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'staged-bytes')
    const existing = validMeta({ expectedSize: 999, etag: '"keep-me"' })
    writeStagedMeta(stagingMetaPathFor(finalPath), existing)

    expect(ensureStagedPlaceholder(finalPath, validMeta({ expectedSize: 0 }))).toBe(true)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toEqual(existing)
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('staged-bytes')
  })

  it('persists a new caller hash onto an existing hashless sidecar, keeping its resume identity', () => {
    // A crash after preflight but before the transport's response-phase
    // sidecar rewrite must still hydrate with the caller's hash - otherwise
    // the restarted job would finalize without verification.
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'staged-bytes')
    const existing = validMeta({ expectedSize: 999, etag: '"keep-me"' })
    writeStagedMeta(stagingMetaPathFor(finalPath), existing)

    const sha256 = 'a'.repeat(64)
    expect(ensureStagedPlaceholder(finalPath, validMeta({ expectedSize: 0, sha256 }))).toBe(true)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toEqual({ ...existing, sha256 })
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('staged-bytes')
  })

  it('replaces a stale persisted hash with the new caller hash', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'staged-bytes')
    const existing = validMeta({ sha256: 'b'.repeat(64) })
    writeStagedMeta(stagingMetaPathFor(finalPath), existing)

    const sha256 = 'a'.repeat(64)
    expect(ensureStagedPlaceholder(finalPath, validMeta({ sha256 }))).toBe(true)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toEqual({ ...existing, sha256 })
  })

  it('keeps a persisted hash when the new caller has none', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'staged-bytes')
    const existing = validMeta({ sha256: 'b'.repeat(64) })
    writeStagedMeta(stagingMetaPathFor(finalPath), existing)

    expect(ensureStagedPlaceholder(finalPath, validMeta())).toBe(true)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toEqual(existing)
  })

  it('fails closed when the caller hash cannot be persisted onto the existing sidecar', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'staged-bytes')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    // Both the scratch write and its cleanup fail -> no durable copy of the
    // upgraded sidecar can exist.
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })
    try {
      expect(ensureStagedPlaceholder(finalPath, validMeta({ sha256: 'a'.repeat(64) }))).toBe(false)
    } finally {
      writeSpy.mockRestore()
    }
  })

  it('parks orphan .part bytes (possibly quarantined data) instead of claiming them', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'quarantined')

    const meta = validMeta()
    expect(ensureStagedPlaceholder(finalPath, meta)).toBe(true)
    // A fresh hydratable pair was created ...
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toEqual(meta)
    // ... and the foreign bytes were preserved under a parked name.
    expect(fs.readFileSync(stagingPathFor(finalPath) + '.orphan', 'utf-8')).toBe('quarantined')
  })

  it('returns false instead of overwriting orphan bytes that cannot be moved aside', () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    const orphanPath = stagingPathFor(finalPath)
    fs.writeFileSync(orphanPath, 'quarantined')

    // Both park primitives (hard link and claim+rename fallback) fail.
    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    try {
      expect(ensureStagedPlaceholder(finalPath, validMeta())).toBe(false)
    } finally {
      linkSpy.mockRestore()
      renameSpy.mockRestore()
    }
    expect(fs.readFileSync(orphanPath, 'utf-8')).toBe('quarantined')
  })

  it('returns false when the placeholder cannot be created', () => {
    // Parent directory does not exist -> writeFileSync fails.
    const finalPath = path.join(tmpDir, 'missing-dir', 'model.safetensors')
    expect(ensureStagedPlaceholder(finalPath, validMeta())).toBe(false)
  })
})

describe('migrateLegacyModelDownloadArtifacts', () => {
  function writeLegacyPair(
    dir: string,
    name: string,
    bytes: number,
    meta: Record<string, unknown> | string
  ): { dataPath: string; metaPath: string } {
    fs.mkdirSync(dir, { recursive: true })
    const dataPath = path.join(dir, name)
    const metaPath = dataPath + LEGACY_META_SUFFIX
    fs.writeFileSync(dataPath, Buffer.alloc(bytes, 1))
    fs.writeFileSync(metaPath, typeof meta === 'string' ? meta : JSON.stringify(meta))
    return { dataPath, metaPath }
  }

  it('finalizes an exact-size pair: sidecar removed, bytes kept at the final name', async () => {
    const { dataPath, metaPath } = writeLegacyPair(
      path.join(tmpDir, 'checkpoints'),
      'ok.safetensors',
      100,
      {
        url: 'https://example.com/ok.safetensors',
        expectedSize: 100
      }
    )

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
    expect(result.finalized).toEqual([dataPath])
    expect(fs.existsSync(metaPath)).toBe(false)
    expect(fs.statSync(dataPath).size).toBe(100)
  })

  it('converts an incomplete pair to a resumable .part + v2 sidecar', async () => {
    const dir = path.join(tmpDir, 'checkpoints', 'sub')
    const { dataPath, metaPath } = writeLegacyPair(dir, 'trunc.safetensors', 40, {
      url: 'https://example.com/trunc.safetensors',
      expectedSize: 100,
      etag: '"tag"',
      lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT'
    })

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
    expect(result.staged).toEqual([stagingPathFor(dataPath)])
    // The truncated bytes no longer live under a model extension.
    expect(fs.existsSync(dataPath)).toBe(false)
    expect(fs.statSync(stagingPathFor(dataPath)).size).toBe(40)
    expect(fs.existsSync(metaPath)).toBe(false)
    const migrated = readStagedMeta(stagingMetaPathFor(dataPath))
    expect(migrated).toEqual({
      version: 2,
      url: 'https://example.com/trunc.safetensors',
      expectedSize: 100,
      etag: '"tag"',
      lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT',
      directory: 'checkpoints/sub',
      filename: 'trunc.safetensors'
    })
  })

  it('quarantines bytes with an unreadable legacy sidecar instead of deleting them', async () => {
    const { dataPath, metaPath } = writeLegacyPair(tmpDir, 'mystery.safetensors', 55, '{ bad json')

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
    expect(result.quarantined).toEqual([stagingPathFor(dataPath)])
    expect(result.staged).toHaveLength(0)
    expect(fs.existsSync(dataPath)).toBe(false)
    expect(fs.statSync(stagingPathFor(dataPath)).size).toBe(55)
    expect(fs.existsSync(metaPath)).toBe(false)
    // No resumable sidecar was fabricated for unknown provenance.
    expect(fs.existsSync(stagingMetaPathFor(dataPath))).toBe(false)
  })

  it('removes a legacy sidecar whose data file is gone', async () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    const metaPath = path.join(tmpDir, 'gone.safetensors' + LEGACY_META_SUFFIX)
    fs.writeFileSync(metaPath, JSON.stringify({ url: 'https://example.com/gone', expectedSize: 5 }))

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
    expect(result.removedStaleMeta).toEqual([metaPath])
    expect(fs.existsSync(metaPath)).toBe(false)
  })

  it('ignores non-model legacy pairs (cache/env downloads keep download.ts semantics)', async () => {
    const { dataPath, metaPath } = writeLegacyPair(tmpDir, 'bundle.7z', 10, {
      url: 'https://example.com/bundle.7z',
      expectedSize: 999
    })

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
    expect(result.finalized).toHaveLength(0)
    expect(result.staged).toHaveLength(0)
    expect(result.quarantined).toHaveLength(0)
    expect(fs.existsSync(dataPath)).toBe(true)
    expect(fs.existsSync(metaPath)).toBe(true)
  })

  it('does not treat a v2 .part.dl-meta sidecar as a legacy pair', async () => {
    const finalPath = path.join(tmpDir, 'model.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'partial')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
    expect(result.finalized).toHaveLength(0)
    expect(result.staged).toHaveLength(0)
    expect(result.quarantined).toHaveLength(0)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toEqual(validMeta())
  })

  it('parks legacy bytes aside when a v2 .part already owns the destination', async () => {
    const { dataPath, metaPath } = writeLegacyPair(tmpDir, 'clash.safetensors', 30, {
      url: 'https://example.com/clash.safetensors',
      expectedSize: 100
    })
    // v2 staged transfer already in progress for the same destination.
    fs.writeFileSync(stagingPathFor(dataPath), 'authoritative v2 partial')

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
    const parked = dataPath + '.legacy' + STAGING_SUFFIX
    expect(result.quarantined).toEqual([parked])
    expect(fs.existsSync(dataPath)).toBe(false)
    expect(fs.statSync(parked).size).toBe(30)
    expect(fs.readFileSync(stagingPathFor(dataPath), 'utf-8')).toBe('authoritative v2 partial')
    expect(fs.existsSync(metaPath)).toBe(false)
  })

  it('processes each pair once for overlapping roots', async () => {
    const sub = path.join(tmpDir, 'loras')
    const { dataPath } = writeLegacyPair(sub, 'once.safetensors', 20, {
      url: 'https://example.com/once.safetensors',
      expectedSize: 100
    })

    const result = await migrateLegacyModelDownloadArtifacts([tmpDir, sub])
    expect(result.staged).toEqual([stagingPathFor(dataPath)])
  })

  it('records the models subdirectory relative to the scanned root', async () => {
    const dir = path.join(tmpDir, 'loras')
    const { dataPath } = writeLegacyPair(dir, 'rel.safetensors', 10, {
      url: 'https://example.com/rel.safetensors',
      expectedSize: 100
    })

    await migrateLegacyModelDownloadArtifacts([tmpDir])
    const meta = readStagedMeta(stagingMetaPathFor(dataPath))
    expect(meta?.directory).toBe('loras')
  })

  it('tolerates a missing root but propagates an unreadable one', async () => {
    // A root that does not exist is normal (fresh install, optional extra
    // path) and scans as empty. A root that EXISTS but cannot be enumerated
    // (EACCES/EIO) may hide legacy truncated files under final model names -
    // swallowing that error would certify a scan that never happened, so it
    // must propagate (the caller gates launch on a failed pass).
    const missing = path.join(tmpDir, 'does-not-exist')
    await expect(migrateLegacyModelDownloadArtifacts([missing])).resolves.toBeTruthy()

    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockRejectedValue(err)
    try {
      await expect(migrateLegacyModelDownloadArtifacts([tmpDir])).rejects.toBe(err)
    } finally {
      readdirSpy.mockRestore()
    }
  })

  it('reports a pair unsafe (and keeps its sidecar) when the data file cannot be statted', async () => {
    // EACCES on stat: the data file may be a truncated model visible to
    // ComfyUI. Treating it as missing would delete the sidecar - the resume
    // identity - while the broken file stays. It must be unsafe instead.
    const { dataPath, metaPath } = writeLegacyPair(
      path.join(tmpDir, 'checkpoints'),
      'locked.safetensors',
      40,
      { url: 'https://example.com/locked.safetensors', expectedSize: 100 }
    )
    const realStat = fs.promises.stat
    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation((async (
      p: fs.PathLike,
      ...rest: unknown[]
    ) => {
      if (path.resolve(String(p)) === path.resolve(dataPath)) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
      return realStat(p, ...(rest as []))
    }) as typeof fs.promises.stat)
    try {
      const result = await migrateLegacyModelDownloadArtifacts([tmpDir])
      expect(result.unsafe).toEqual([dataPath])
      expect(result.removedStaleMeta).toHaveLength(0)
      expect(fs.existsSync(metaPath)).toBe(true)
      expect(fs.existsSync(dataPath)).toBe(true)
    } finally {
      statSpy.mockRestore()
    }
  })
})

describe('scanForStagedDownloads root failures', () => {
  it('propagates an unreadable root instead of scanning it as empty (fail closed)', async () => {
    // The scan is what finds zero-byte final-name claim markers; a swallowed
    // enumeration failure would certify "no broken finals" over a tree that
    // was never checked. The caller treats the rejection as unsafe.
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockRejectedValue(err)
    try {
      await expect(scanForStagedDownloads([tmpDir])).rejects.toThrow('EACCES')
    } finally {
      readdirSpy.mockRestore()
    }
  })

  it('tolerates a missing root (normal for optional model dirs)', async () => {
    const { downloads, unsafeFinalPaths } = await scanForStagedDownloads([
      path.join(tmpDir, 'does-not-exist')
    ])
    expect(downloads).toHaveLength(0)
    expect(unsafeFinalPaths).toHaveLength(0)
  })

  it('discovers sidecars nested deeper than the lenient depth cap', async () => {
    // Strict mode must not silently stop at SCAN_MAX_DEPTH: a certified scan
    // has to cover the whole tree.
    let dir = tmpDir
    for (let i = 0; i < 10; i++) dir = path.join(dir, `d${i}`)
    fs.mkdirSync(dir, { recursive: true })
    const finalPath = path.join(dir, 'deep.safetensors')
    fs.writeFileSync(stagingPathFor(finalPath), 'bytes')
    writeStagedMeta(stagingMetaPathFor(finalPath), validMeta())

    const { downloads } = await scanForStagedDownloads([tmpDir])
    expect(downloads.map((d) => d.finalPath)).toContain(finalPath)
  })
})
