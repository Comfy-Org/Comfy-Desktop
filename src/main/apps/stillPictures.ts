const MAX_PARALLEL_REQUESTS = 6
const MAX_STILL_BYTES = 2 * 1024 * 1024
const STILL_TYPES: ReadonlySet<string> = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])

interface StillBytes {
  type: string
  bytes: Uint8Array
}

async function readCapped(response: Response): Promise<Uint8Array | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_STILL_BYTES) return null
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  return size > 0 ? Buffer.concat(chunks) : null
}

function stillTypeOf(response: Response): string | null {
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return type && STILL_TYPES.has(type) ? type : null
}

export async function readStill(response: Response): Promise<StillBytes | null> {
  const type = stillTypeOf(response)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (!response.ok || !type || declared > MAX_STILL_BYTES) {
    void response.body?.cancel().catch(() => {})
    return null
  }
  const bytes = await readCapped(response)
  return bytes ? { type, bytes } : null
}

export async function stillDataUrl(response: Response): Promise<string | null> {
  const still = await readStill(response)
  return still ? `data:${still.type};base64,${Buffer.from(still.bytes).toString('base64')}` : null
}

export async function inTurns<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, items.length) }, worker))
  return results
}
