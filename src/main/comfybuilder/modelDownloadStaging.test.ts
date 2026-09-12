// @vitest-environment node
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { digestKey } from './integrity'
import {
  digestFile,
  ensureStagedPlaceholder,
  hashFile,
  readStagedMeta,
  stagedMetaDigest,
  stagedMetaDigestFields,
  stagingMetaPathFor,
  stagingPathFor,
  writeStagedMeta,
  type StagedDownloadMeta
} from '../lib/modelDownloadStaging'

const HEX_A = 'a'.repeat(64)
const HEX_B = 'b'.repeat(64)

let tmpDir: string
let finalPath: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-staging-digest-'))
  finalPath = path.join(tmpDir, 'checkpoints', 'model.safetensors')
  fs.mkdirSync(path.dirname(finalPath), { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function meta(overrides: Partial<StagedDownloadMeta> = {}): StagedDownloadMeta {
  return {
    version: 2,
    url: 'https://example.com/model.safetensors',
    expectedSize: 10,
    directory: 'checkpoints',
    filename: 'model.safetensors',
    ...overrides
  }
}

describe('STAGING METADATA carries an algorithm-tagged digest', () => {
  it('persists {algo, value} in the sidecar and reads it back tagged', () => {
    const digest = { algo: 'blake3', value: HEX_A } as const
    writeStagedMeta(stagingMetaPathFor(finalPath), meta(stagedMetaDigestFields(digest)))
    const roundTripped = readStagedMeta(stagingMetaPathFor(finalPath))
    expect(roundTripped?.digest).toEqual(digest)
    expect(stagedMetaDigest(roundTripped)).toEqual(digest)
  })

  it('mirrors sha256 alongside the tagged field, but never mirrors blake3 as sha256', () => {
    expect(stagedMetaDigestFields({ algo: 'sha256', value: HEX_A })).toEqual({
      digest: { algo: 'sha256', value: HEX_A },
      sha256: HEX_A
    })
    expect(stagedMetaDigestFields({ algo: 'blake3', value: HEX_A })).toEqual({
      digest: { algo: 'blake3', value: HEX_A }
    })
    expect(stagedMetaDigestFields(null)).toEqual({})
  })

  it('reads a LEGACY sha256-only sidecar as a sha256-tagged digest (backward compat)', () => {
    writeStagedMeta(stagingMetaPathFor(finalPath), meta({ sha256: HEX_B }))
    const legacy = readStagedMeta(stagingMetaPathFor(finalPath))
    expect(legacy?.digest).toBeUndefined()
    expect(stagedMetaDigest(legacy)).toEqual({ algo: 'sha256', value: HEX_B })
  })

  it('never re-tags a legacy sha256-only sidecar as blake3', () => {
    const legacy = stagedMetaDigest(meta({ sha256: HEX_A }))
    expect(digestKey(legacy)).toBe(`sha256:${HEX_A}`)
    expect(digestKey(legacy)).not.toBe(`blake3:${HEX_A}`)
  })

  it('upgrades a persisted sha256 expectation to blake3 with the SAME hex', () => {
    fs.writeFileSync(stagingPathFor(finalPath), 'staged-bytes')
    writeStagedMeta(stagingMetaPathFor(finalPath), meta({ sha256: HEX_A }))

    const upgraded = { algo: 'blake3', value: HEX_A } as const
    expect(ensureStagedPlaceholder(finalPath, meta(stagedMetaDigestFields(upgraded)))).toBe(true)
    expect(stagedMetaDigest(readStagedMeta(stagingMetaPathFor(finalPath)))).toEqual(upgraded)
  })

  it('keeps a persisted digest when the new caller declares none', () => {
    fs.writeFileSync(stagingPathFor(finalPath), 'staged-bytes')
    const existing = meta(stagedMetaDigestFields({ algo: 'blake3', value: HEX_A }))
    writeStagedMeta(stagingMetaPathFor(finalPath), existing)
    expect(ensureStagedPlaceholder(finalPath, meta())).toBe(true)
    expect(stagedMetaDigest(readStagedMeta(stagingMetaPathFor(finalPath)))).toEqual({
      algo: 'blake3',
      value: HEX_A
    })
  })
})

describe('file hashing under both algorithms', () => {
  it('computes the published BLAKE3 vectors', async () => {
    const empty = path.join(tmpDir, 'empty.bin')
    fs.writeFileSync(empty, '')
    expect(await hashFile(empty, 'blake3')).toBe(
      'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'
    )
    const abc = path.join(tmpDir, 'abc.bin')
    fs.writeFileSync(abc, 'abc')
    expect(await hashFile(abc, 'blake3')).toBe(
      '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85'
    )
  })

  it('streams a multi-chunk file to the same digest as a one-shot hash', async () => {
    const big = path.join(tmpDir, 'big.bin')
    const bytes = Buffer.alloc(3 * 64 * 1024 + 17, 7)
    fs.writeFileSync(big, bytes)
    expect(await hashFile(big, 'sha256')).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect((await hashFile(big, 'blake3')).length).toBe(64)
  })

  it('returns the actual content already tagged with the algorithm used', async () => {
    const file = path.join(tmpDir, 'weights.bin')
    fs.writeFileSync(file, 'weights')
    await expect(digestFile(file, 'blake3')).resolves.toMatchObject({ algo: 'blake3' })
    await expect(digestFile(file, 'sha256')).resolves.toEqual({
      algo: 'sha256',
      value: createHash('sha256').update('weights').digest('hex')
    })
  })

  it('gives the same bytes DIFFERENT digests under the two algorithms', async () => {
    const file = path.join(tmpDir, 'weights.bin')
    fs.writeFileSync(file, 'weights')
    const [asBlake3, asSha256] = await Promise.all([
      digestFile(file, 'blake3'),
      digestFile(file, 'sha256')
    ])
    expect(asBlake3.value).not.toBe(asSha256.value)
  })
})
