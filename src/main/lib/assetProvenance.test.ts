import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { onMessage, follow, stop, stateRoot } = vi.hoisted(() => ({
  onMessage: { current: (_message: unknown): void => {} },
  follow: vi.fn(),
  stop: vi.fn(),
  stateRoot: { current: '' }
}))

vi.mock('../apps/localRelay', () => ({
  createLocalRelay: (callback: (message: unknown) => void) => {
    onMessage.current = callback
    return { follow, stop }
  }
}))
vi.mock('./paths', () => ({ stateDir: () => stateRoot.current }))

import { createAssetProvenanceStore, trackAssetProvenance } from './assetProvenance'

let root: string
let outputs: string
let index: string
const generatedAt = Date.parse('2026-11-01T00:00:00Z')

function history(filename: string, extra: Record<string, unknown> = {}) {
  return {
    run: {
      outputs: { '9': { images: [{ filename, subfolder: '', type: 'output', ...extra }] } },
      status: {
        completed: true,
        messages: [
          ['execution_start', { timestamp: generatedAt - 100 }],
          ['execution_success', { timestamp: generatedAt + 100 }]
        ]
      }
    }
  }
}

async function writeOutput(name = 'image.png'): Promise<string> {
  const file = path.join(outputs, name)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'image')
  await fs.utimes(file, generatedAt / 1000, generatedAt / 1000)
  return file
}

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'asset-provenance-')))
  outputs = path.join(root, 'output')
  index = path.join(root, 'provenance.json')
  stateRoot.current = root
})

beforeEach(async () => {
  vi.clearAllMocks()
  await fs.rm(outputs, { recursive: true, force: true })
  await fs.rm(index, { force: true })
  await fs.mkdir(outputs, { recursive: true })
})

afterEach(() => vi.unstubAllGlobals())
afterAll(async () => fs.rm(root, { recursive: true, force: true }))

describe('asset provenance', () => {
  it('persists each generating build separately even when their output folder is shared', async () => {
    const a = await writeOutput('a.png')
    const b = await writeOutput('nested/b.png')
    const unknown = await writeOutput('legacy.png')
    const store = createAssetProvenanceStore(index)
    await Promise.all([
      store.recordHistory('a', outputs, history('a.png')),
      store.recordHistory('b', outputs, history('b.png', { subfolder: 'nested' }))
    ])

    const reloaded = createAssetProvenanceStore(index)
    await reloaded.ready()
    expect(reloaded.originFor(a, await fs.stat(a))).toBe('a')
    expect(reloaded.originFor(b, await fs.stat(b))).toBe('b')
    expect(reloaded.originFor(unknown, await fs.stat(unknown))).toBeNull()
  })

  it('does not transfer ownership from stale history to a file overwritten by another build', async () => {
    const file = await writeOutput()
    const store = createAssetProvenanceStore(index)
    await store.recordHistory('a', outputs, history('image.png'))
    await fs.writeFile(file, 'other image')
    await fs.utimes(file, generatedAt / 1000 + 10, generatedAt / 1000 + 10)
    const current = await fs.stat(file)

    expect(store.originFor(file, current)).toBeNull()
    await store.recordHistory('a', outputs, history('image.png'))
    expect(store.originFor(file, current)).toBeNull()

    const next = history('image.png')
    next.run.status.messages = [
      ['execution_start', { timestamp: generatedAt + 9900 }],
      ['execution_success', { timestamp: generatedAt + 10100 }]
    ]
    await store.recordHistory('b', outputs, next)
    expect(store.originFor(file, current)).toBe('b')
  })

  it('leaves a file with conflicting evidence unassigned in either observation order', async () => {
    const file = await writeOutput()
    for (const owners of [
      ['a', 'b'],
      ['b', 'a']
    ]) {
      const store = createAssetProvenanceStore(path.join(root, `${owners[0]}.json`))
      for (const owner of owners) await store.recordHistory(owner!, outputs, history('image.png'))
      await store.recordHistory(owners[0]!, outputs, history('image.png'))
      expect(store.originFor(file, await fs.stat(file))).toBeNull()
    }
  })

  it('requires execution timestamps and excludes cached files from earlier runs', async () => {
    const file = await writeOutput()
    const store = createAssetProvenanceStore(index)
    const missingTimes = history('image.png')
    missingTimes.run.status.messages = []
    await store.recordHistory('a', outputs, missingTimes)
    expect(store.originFor(file, await fs.stat(file))).toBeNull()

    const cached = history('image.png')
    cached.run.status.messages[0]![1] = { timestamp: generatedAt + 1 }
    await store.recordHistory('b', outputs, cached)
    expect(store.originFor(file, await fs.stat(file))).toBeNull()
  })

  it('rejects temporary files, path traversal and links outside the output folder', async () => {
    const inside = await writeOutput()
    const outside = path.join(root, 'outside.png')
    await fs.writeFile(outside, 'private')
    await fs.utimes(outside, generatedAt / 1000, generatedAt / 1000)
    await fs.symlink(outside, path.join(outputs, 'link.png'))
    const store = createAssetProvenanceStore(index)
    for (const row of [
      history('image.png', { type: 'temp' }),
      history('../outside.png'),
      history('outside.png', { subfolder: '..\\' }),
      history(outside),
      history('link.png')
    ])
      await store.recordHistory('a', outputs, row)

    expect(store.originFor(inside, await fs.stat(inside))).toBeNull()
    expect(store.originFor(outside, await fs.stat(outside))).toBeNull()
  })

  it.each(['broken', '{"version":2,"files":{}}', '{"version":1,"files":{"x":null}}'])(
    'treats an unreadable or unsupported index as unknown: %s',
    async (saved) => {
      const file = await writeOutput()
      await fs.writeFile(index, saved)
      const store = createAssetProvenanceStore(index)
      await store.ready()
      expect(store.originFor(file, await fs.stat(file))).toBeNull()
    }
  )

  it('retries persisting evidence after a failed write', async () => {
    const file = await writeOutput()
    await fs.mkdir(index)
    const store = createAssetProvenanceStore(index)
    await expect(store.recordHistory('a', outputs, history('image.png'))).rejects.toThrow()
    await fs.rm(index, { recursive: true })
    await store.recordHistory('a', outputs, history('image.png'))

    const reloaded = createAssetProvenanceStore(index)
    await reloaded.ready()
    expect(reloaded.originFor(file, await fs.stat(file))).toBe('a')
  })
})

describe('live history capture', () => {
  it('uses the history API on queue updates and keeps evidence after the build stops', async () => {
    const file = await writeOutput('live.png')
    const fetchHistory = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchHistory)
    const tracker = trackAssetProvenance('live', outputs, 8188)
    await tracker.sync()
    fetchHistory.mockResolvedValue(new Response(JSON.stringify(history('live.png'))))
    onMessage.current({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } })
    await tracker.sync()
    tracker.stop()
    await tracker.sync()

    expect(follow).toHaveBeenCalledWith(8188)
    expect(stop).toHaveBeenCalledOnce()
    expect(fetchHistory).toHaveBeenCalledWith(
      'http://127.0.0.1:8188/history?max_items=1000',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    )
    const persisted = createAssetProvenanceStore(path.join(root, 'asset-provenance.json'))
    await persisted.ready()
    expect(persisted.originFor(file, await fs.stat(file))).toBe('live')
  })

  it('survives an unavailable history API without assigning files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const tracker = trackAssetProvenance('offline', outputs, 8189)
    await expect(tracker.sync()).resolves.toBeUndefined()
    tracker.stop()
  })
})
