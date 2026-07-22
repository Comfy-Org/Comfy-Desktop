// @vitest-environment node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The artifact download itself is exercised end-to-end in the integration test
// (real `net` → node http bridge). Here we mock main's `download()` so the unit
// test never imports electron and can drive the sha256-verify branch directly.
const KNOWN_BYTES = Buffer.from('comfybuilder-artifact-bytes')
const KNOWN_SHA256 = createHash('sha256').update(KNOWN_BYTES).digest('hex')

vi.mock('../lib/download', () => ({
  download: vi.fn(async (_url: string, destPath: string) => {
    fs.writeFileSync(destPath, KNOWN_BYTES)
    return destPath
  }),
}))

import { downloadArtifact, resolveSignedDownloadUrl } from './artifactDownload'
import { startMockBuilderApi } from '../../test/comfybuilder/mockBuilderApi'
import type { MockBuilderApi } from '../../test/comfybuilder/mockBuilderApi'

describe('resolveSignedDownloadUrl', () => {
  let api: MockBuilderApi

  beforeAll(async () => {
    api = await startMockBuilderApi()
  })
  afterAll(async () => {
    await api.stop()
  })

  it('returns the presigned downloadUrl for an artifact', async () => {
    const url = await resolveSignedDownloadUrl('artifact-123', { baseUrl: api.baseUrl })
    expect(url).toBe(`${api.baseUrl}/archive.tgz`)
  })

  it('tolerates a trailing slash on the base URL', async () => {
    const url = await resolveSignedDownloadUrl('artifact-123', { baseUrl: `${api.baseUrl}/` })
    expect(url).toBe(`${api.baseUrl}/archive.tgz`)
  })

  it('throws on a non-2xx response', async () => {
    // An extra path segment shifts the route so the resolve endpoint 404s.
    await expect(
      resolveSignedDownloadUrl('artifact-123', { baseUrl: `${api.baseUrl}/nope` }),
    ).rejects.toThrow(/HTTP 404/)
  })
})

describe('downloadArtifact', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-dl-'))
  })
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('downloads and returns the destination path', async () => {
    const destPath = path.join(tmpDir, 'ok.tar.gz')
    const result = await downloadArtifact({ signedUrl: 'https://example.test/a', destPath })
    expect(result).toBe(destPath)
    expect(fs.readFileSync(destPath)).toEqual(KNOWN_BYTES)
  })

  it('passes when the sha256 matches (with a sha256: prefix)', async () => {
    const destPath = path.join(tmpDir, 'match.tar.gz')
    await expect(
      downloadArtifact({ signedUrl: 'https://example.test/a', destPath, expectedSha256: `sha256:${KNOWN_SHA256}` }),
    ).resolves.toBe(destPath)
  })

  it('throws on a sha256 mismatch', async () => {
    const destPath = path.join(tmpDir, 'bad.tar.gz')
    await expect(
      downloadArtifact({ signedUrl: 'https://example.test/a', destPath, expectedSha256: 'deadbeef' }),
    ).rejects.toThrow(/checksum mismatch/)
  })
})
