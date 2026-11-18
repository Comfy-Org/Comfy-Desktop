import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'comfyui-desktop-2-test') }
}))

import { modelBytesOnDisk, resolveModelsPresence } from './modelDownloadPaths'

describe('resolveModelsPresence', () => {
  it('reads unresolvable or model-free templates as not downloaded', async () => {
    const { presence, timedOut } = await resolveModelsPresence(
      ['broken', 'empty'],
      null,
      async (id) => {
        if (id === 'broken') throw new Error('HTTP 404')
        return []
      },
      1000
    )

    expect(timedOut).toBe(false)
    expect(presence).toEqual(
      new Map([
        ['broken', false],
        ['empty', false]
      ])
    )
  })

  it('leaves templates unbadged when the lookup overruns its budget', async () => {
    vi.useFakeTimers()
    try {
      let finishSlowLookup!: () => void
      const result = resolveModelsPresence(
        ['fast', 'slow'],
        null,
        (id) =>
          id === 'fast'
            ? Promise.resolve([])
            : new Promise((resolve) => (finishSlowLookup = () => resolve([]))),
        50
      )
      await vi.advanceTimersByTimeAsync(50)
      const { presence, timedOut } = await result

      expect(timedOut).toBe(true)
      expect(presence).toEqual(new Map([['fast', false]]))

      finishSlowLookup()
      await vi.runAllTimersAsync()
      expect(presence.has('slow')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('modelBytesOnDisk', () => {
  it("measures a model file where the build would find it, and nothing that isn't a file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-bytes-'))
    try {
      const shared = path.join(root, 'shared')
      fs.mkdirSync(path.join(shared, 'unet'), { recursive: true })
      fs.writeFileSync(path.join(shared, 'unet', 'wan.safetensors'), 'x'.repeat(42))
      fs.mkdirSync(path.join(root, 'base', 'vae', 'folder.safetensors'), { recursive: true })
      const base = path.join(root, 'base')
      const ctx = { downloadBaseDir: base, modelRoots: [shared], extraPaths: [] }

      expect(await modelBytesOnDisk(ctx, base, 'diffusion_models', 'wan.safetensors')).toBe(42)
      expect(await modelBytesOnDisk(ctx, base, 'vae', 'folder.safetensors')).toBeNull()
      expect(await modelBytesOnDisk(ctx, base, 'vae', 'missing.safetensors')).toBeNull()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
