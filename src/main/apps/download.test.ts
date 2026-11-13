// @vitest-environment node
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stallGuard, streamToFile } from './download'

const MB = 1024 * 1024

function chunked(count: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === count) return controller.close()
      controller.enqueue(new Uint8Array(size).fill(sent % 256))
      sent++
    }
  })
}

describe('streamToFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'apps-download-'))
  })

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('streams a big file to disk chunk by chunk', async () => {
    const file = path.join(dir, 'big.mp4')
    const onChunk = vi.fn()
    const size = await streamToFile(chunked(64, MB), file, 2_000_000_000, onChunk)
    expect(size).toBe(64 * MB)
    expect((await fsp.stat(file)).size).toBe(64 * MB)
    expect(onChunk).toHaveBeenCalledTimes(64)
    const handle = await fsp.open(file, 'r')
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, 64 * MB - 1)
    await handle.close()
    expect(last[0]).toBe(63)
  })

  it('stops and removes the file when it goes over the limit', async () => {
    const file = path.join(dir, 'over.mp4')
    expect(await streamToFile(chunked(4, MB), file, 3 * MB)).toBeNull()
    await expect(fsp.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never writes over a file that is already there', async () => {
    const file = path.join(dir, 'taken.mp4')
    await fsp.writeFile(file, 'keep')
    await expect(streamToFile(chunked(1, 10), file, MB)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fsp.readFile(file, 'utf8')).toBe('keep')
  })

  it('removes the partial file when the download breaks', async () => {
    const file = path.join(dir, 'broken.mp4')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10))
        controller.error(new Error('connection reset'))
      }
    })
    await expect(streamToFile(body, file, MB)).rejects.toThrow('connection reset')
    await expect(fsp.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('stallGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not abort while data keeps coming', () => {
    const guard = stallGuard(1000)
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(900)
      guard.alive()
    }
    expect(guard.signal.aborted).toBe(false)
    guard.stop()
  })

  it('aborts when no data comes for the whole stall time', () => {
    const guard = stallGuard(1000)
    vi.advanceTimersByTime(900)
    guard.alive()
    vi.advanceTimersByTime(1000)
    expect(guard.signal.aborted).toBe(true)
  })

  it('does not abort after it is stopped', () => {
    const guard = stallGuard(1000)
    guard.stop()
    vi.advanceTimersByTime(5000)
    expect(guard.signal.aborted).toBe(false)
  })
})
