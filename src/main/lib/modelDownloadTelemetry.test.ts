import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadTelemetry } from './modelDownloadTelemetry'

const capture = vi.hoisted(() => vi.fn())
vi.mock('./telemetry', () => ({ capture }))

const model = {
  url: 'https://huggingface.co/private/model',
  source: 'comfyui',
  filename: 'private-model.SafeTensors',
  directory: 'C:\\models\\checkpoints',
  installationId: 'build-id'
} as const

beforeEach(() => {
  capture.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(1000)
})

afterEach(() => vi.useRealTimers())

describe('model download telemetry', () => {
  it('counts transitions once and retains unthrottled bytes in terminal events', () => {
    const telemetry = new ModelDownloadTelemetry(model)
    telemetry.report({ status: 'pending' })
    for (let bytes = 1; bytes <= 100; bytes++) {
      telemetry.updateBytes(bytes, 200)
      telemetry.report({ status: 'downloading' })
    }
    vi.setSystemTime(2000)
    telemetry.report({ status: 'paused', receivedBytes: 0 })
    telemetry.report({ status: 'paused' })
    vi.setSystemTime(4000)
    telemetry.report({ status: 'downloading' })
    telemetry.report({ status: 'downloading' })
    vi.setSystemTime(5000)
    telemetry.report({ status: 'cancelled', receivedBytes: 0 })
    telemetry.report({ status: 'cancelled' })
    telemetry.report({ status: 'completed' })

    expect(capture.mock.calls.map(([event]) => event)).toEqual([
      'comfy.desktop.model_download.started',
      'comfy.desktop.model_download.paused',
      'comfy.desktop.model_download.resumed',
      'comfy.desktop.model_download.result'
    ])
    expect(capture.mock.calls[0]?.[1]).toMatchObject({
      size_bucket: 'unknown',
      installation_id: 'build-id'
    })
    expect(capture).toHaveBeenLastCalledWith('comfy.desktop.model_download.result', {
      download_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      installation_id: 'build-id',
      source: 'comfyui',
      provider: 'huggingface',
      is_retry: false,
      directory_bucket: 'checkpoints',
      file_ext: 'safetensors',
      received_bytes: 100,
      total_bytes: 200,
      size_bucket: 'lt_10mb',
      duration_ms: 4000,
      resume_count: 1,
      result: 'cancelled'
    })
    expect(new Set(capture.mock.calls.map(([, properties]) => properties.download_id)).size).toBe(1)
  })

  it.each([
    ['https://huggingface.co/repo/model?token=secret', 'huggingface'],
    ['https://civitai.com/api/download?token=secret', 'civitai'],
    ['https://private.example.com/personal/model', 'other'],
    ['https://huggingface.co.evil.example/model', 'other'],
    ['not a url', 'other']
  ])('only records a provider category for %s', (url, provider) => {
    new ModelDownloadTelemetry({ ...model, url, source: 'app' }).report({ status: 'pending' })
    expect(capture.mock.calls[0]?.[1].provider).toBe(provider)
    expect(JSON.stringify(capture.mock.calls)).not.toContain(url)
  })

  it('buckets custom directory names and unsupported file extensions without exposing them', () => {
    new ModelDownloadTelemetry({
      ...model,
      filename: 'model.private-extension',
      directory: 'models/private-directory',
      installationId: null
    }).report({ status: 'pending' })

    expect(capture.mock.lastCall?.[1]).toMatchObject({
      directory_bucket: 'other',
      file_ext: 'other',
      installation_id: null
    })
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private')
  })

  it.each([
    ['Download failed: HTTP 401', 'access_denied', 401],
    ['Download failed: HTTP 403', 'access_denied', 403],
    ['Download failed: HTTP 503', 'http', 503],
    ['Download corrupt: checksum mismatch: expected secret, got private', 'checksum', undefined],
    [
      'Download size mismatch: expected 100 bytes but server reported 99',
      'size_mismatch',
      undefined
    ],
    ['Download incomplete: expected 100 bytes but got 99', 'size_mismatch', undefined],
    ['Download stalled: no data for 60s', 'timeout', undefined],
    ['Write failed: ENOSPC /Users/private/model.safetensors', 'disk', undefined],
    [
      'Download failed: net::ERR_CONNECTION_RESET https://user:secret@private',
      'network',
      undefined
    ],
    ['EACCES: permission denied /Users/private/model.safetensors', 'permissions', undefined]
  ])('categorizes %s without sending error text', (error, errorBucket, httpStatus) => {
    new ModelDownloadTelemetry({
      ...model,
      url: 'https://private.example.com/model',
      source: 'template'
    }).report({ status: 'error', error })
    const properties = capture.mock.lastCall?.[1]
    expect(capture.mock.lastCall?.[0]).toBe('comfy.desktop.model_download.result')
    expect(properties).toMatchObject({ result: 'error', error_bucket: errorBucket })
    expect(properties.http_status).toBe(httpStatus)
    expect(JSON.stringify(capture.mock.calls)).not.toContain(error)
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private')
    expect(JSON.stringify(capture.mock.calls)).not.toContain('secret')
  })

  it('does not let telemetry failures escape into download handling', () => {
    capture.mockImplementation(() => {
      throw new Error('telemetry unavailable')
    })
    const telemetry = new ModelDownloadTelemetry(model)
    expect(() => {
      telemetry.report({ status: 'pending' })
      telemetry.report({ status: 'completed', receivedBytes: 4, totalBytes: 4 })
    }).not.toThrow()
  })
})
