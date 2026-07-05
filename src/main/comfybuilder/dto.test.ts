import { describe, expect, it } from 'vitest'
import { ComfyBuilderDTOParseError, parseArtifact, parseDeployments, parsePipelines } from './dto'

describe('comfybuilder dto parsers', () => {
  it('parses mixed-status deployments and succeeds with artifact on succeeded items', () => {
    const parsed = parseDeployments({
      items: [
        { id: 'd1', pipeline_id: 'p1', pipeline_revision: 1, version: 'v1', status: 'queued' },
        { id: 'd2', pipeline_id: 'p1', pipeline_revision: 2, version: 'v2', status: 'building' },
        {
          id: 'd3',
          pipeline_id: 'p2',
          pipeline_revision: 3,
          version: 'v3',
          status: 'succeeded',
          artifact: {
            artifact_id: 'a1',
            filename: 'dist.tar.gz',
            download_url: 'https://example.invalid/dist.tar.gz',
            checksum: 'sha256:abc',
            size_bytes: 42
          }
        },
        {
          id: 'd4',
          pipeline_id: 'p2',
          pipeline_revision: 4,
          version: 'v4',
          status: 'failed',
          error_code: 'BROKEN',
          error_message: 'build failed'
        }
      ]
    })

    expect(parsed).toHaveLength(4)
    expect(parsed[0]?.status).toBe('queued')
    expect(parsed[1]?.status).toBe('building')
    expect(parsed[2]?.status).toBe('succeeded')
    expect(parsed[2]?.artifact).toEqual({
      artifact_id: 'a1',
      filename: 'dist.tar.gz',
      download_url: 'https://example.invalid/dist.tar.gz',
      checksum: 'sha256:abc',
      size_bytes: 42
    })
    expect(parsed[3]?.status).toBe('failed')
  })

  it('throws on invalid artifact payloads', () => {
    expect(() => parseArtifact({})).toThrow(ComfyBuilderDTOParseError)
  })

  it('keeps forward-compatible pipeline fields', () => {
    const parsed = parsePipelines([{ id: 'p1', org_id: 'org1', name: 'x', revision: 1, extra_future_field: true }])
    expect(parsed).toEqual([
      {
        id: 'p1',
        org_id: 'org1',
        name: 'x',
        revision: 1,
        extra_future_field: true
      }
    ])
  })
})
