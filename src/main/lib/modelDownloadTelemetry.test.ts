import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadTelemetry } from './modelDownloadTelemetry'

const capture = vi.hoisted(() => vi.fn())
vi.mock('./telemetry', () => ({ capture }))

beforeEach(() => {
  capture.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(1000)
})

afterEach(() => vi.useRealTimers())

describe('model download telemetry', () => {
  it('counts transitions once and retains unthrottled bytes in terminal events', () => {
    const telemetry = new ModelDownloadTelemetry('https://huggingface.co/private/model', 'comfyui')
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
      'comfy.desktop.model_download.cancelled'
    ])
    expect(capture).toHaveBeenLastCalledWith('comfy.desktop.model_download.cancelled', {
      download_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      source: 'comfyui',
      provider: 'huggingface',
      is_retry: false,
      received_bytes: 100,
      total_bytes: 200,
      duration_ms: 4000,
      resume_count: 1
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
    new ModelDownloadTelemetry(url, 'app').report({ status: 'pending' })
    expect(capture.mock.calls[0]?.[1].provider).toBe(provider)
    expect(JSON.stringify(capture.mock.calls)).not.toContain(url)
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
    new ModelDownloadTelemetry('https://private.example.com/model', 'template').report({
      status: 'error',
      error
    })
    const properties = capture.mock.lastCall?.[1]
    expect(properties).toMatchObject({ error_bucket: errorBucket })
    expect(properties.http_status).toBe(httpStatus)
    expect(JSON.stringify(capture.mock.calls)).not.toContain(error)
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private')
    expect(JSON.stringify(capture.mock.calls)).not.toContain('secret')
  })

  it('does not let telemetry failures escape into download handling', () => {
    capture.mockImplementation(() => {
      throw new Error('telemetry unavailable')
    })
    const telemetry = new ModelDownloadTelemetry('https://example.com/model', 'app')
    expect(() => {
      telemetry.report({ status: 'pending' })
      telemetry.report({ status: 'completed', receivedBytes: 4, totalBytes: 4 })
    }).not.toThrow()
  })
})
