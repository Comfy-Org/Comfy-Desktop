import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pacedForVideo,
  recordVideoOptions,
  VIDEO_PACE_MS,
  videoRecordingEnabled
} from './videoRecording'

const TEST_RESULTS_DIR = path.resolve(__dirname, '..', '..', 'test-results')

describe('videoRecordingEnabled', () => {
  it('is off when E2E_VIDEO is unset', () => {
    expect(videoRecordingEnabled({})).toBe(false)
  })

  it.each(['', '0'])('is off when E2E_VIDEO is "%s"', (value) => {
    expect(videoRecordingEnabled({ E2E_VIDEO: value })).toBe(false)
  })

  it.each(['1', 'true', 'yes'])('is on when E2E_VIDEO is %s', (value) => {
    expect(videoRecordingEnabled({ E2E_VIDEO: value })).toBe(true)
  })
})

describe('recordVideoOptions', () => {
  it('is undefined when recording is off', () => {
    expect(recordVideoOptions({})).toBeUndefined()
    expect(recordVideoOptions({ E2E_VIDEO: '0' })).toBeUndefined()
  })

  it('records at 1280x800 into a folder under test-results when on', () => {
    const options = recordVideoOptions({ E2E_VIDEO: '1' })
    expect(options?.size).toEqual({ width: 1280, height: 800 })
    const relative = path.relative(TEST_RESULTS_DIR, options?.dir ?? '')
    expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(false)
  })
})

describe('pacedForVideo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the action promise itself when recording is off', () => {
    const actionResult = Promise.resolve('done')
    expect(pacedForVideo(() => actionResult, {})).toBe(actionResult)
  })

  it('waits before and after the action when recording is on', async () => {
    vi.useFakeTimers()
    const action = vi.fn(() => Promise.resolve('done'))
    let settled = false
    const paced = pacedForVideo(action, { E2E_VIDEO: '1' }).then((value) => {
      settled = true
      return value
    })

    await vi.advanceTimersByTimeAsync(VIDEO_PACE_MS - 1)
    expect(action).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(action).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(VIDEO_PACE_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(paced).resolves.toBe('done')
  })
})
