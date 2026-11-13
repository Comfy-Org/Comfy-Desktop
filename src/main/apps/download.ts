import { promises as fsp } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'

export interface StallGuard {
  signal: AbortSignal
  alive: () => void
  stop: () => void
}

export function stallGuard(ms: number): StallGuard {
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    alive: () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), ms)
    },
    stop: () => clearTimeout(timer)
  }
}

class TooLarge extends Error {}

export async function streamToFile(
  body: ReadableStream<Uint8Array> | null,
  file: string,
  max: number,
  onChunk: () => void = () => {}
): Promise<number | null> {
  const handle = await fsp.open(file, 'wx')
  let size = 0
  try {
    await pipeline(
      body ? Readable.fromWeb(body as WebReadableStream<Uint8Array>) : Readable.from([]),
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          size += chunk.byteLength
          if (size > max) throw new TooLarge()
          onChunk()
          yield chunk
        }
      },
      handle.createWriteStream()
    )
    return size
  } catch (err) {
    await handle.close().catch(() => {})
    await fsp.rm(file, { force: true }).catch(() => {})
    if (err instanceof TooLarge) return null
    throw err
  }
}
