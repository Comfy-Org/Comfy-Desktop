import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), isPackaged: false } }))
vi.mock('./listing', async (importOriginal) => ({
  ...(await importOriginal<typeof Listing>()),
  MAX_LISTED_ENTRIES: 3
}))

import { listLocalAssets, localAssetFile } from './assets'
import type * as Listing from './listing'

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'install-assets-')))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

function write(relative: string, when: Date): void {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'x')
  fs.utimesSync(file, when, when)
}

write('output/old.png', new Date(2024, 0, 1))
write('output/clips/new.mp4', new Date(2025, 0, 1))
write('output/notes.txt', new Date(2025, 0, 1))
write('input/voice.wav', new Date(2024, 6, 1))
const folders = { output: path.join(root, 'output'), input: path.join(root, 'input') }

describe('listLocalAssets', () => {
  it('lists media from output and input, newest first, with protocol URLs', async () => {
    const page = await listLocalAssets('a', folders, {})
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((a) => [a.id, a.mediaType])).toEqual([
      ['output/clips/new.mp4', 'video'],
      ['input/voice.wav', 'audio'],
      ['output/old.png', 'image']
    ])
    expect(page.items[0]!.url).toBe('comfy-media://local/a/output/clips/new.mp4')
    expect(page.items[1]).toMatchObject({
      category: 'input',
      size: 1,
      modifiedAt: new Date(2024, 6, 1).getTime()
    })
  })

  it('lists a folder shared by output and input once', async () => {
    const page = await listLocalAssets('a', { output: folders.output, input: folders.output }, {})
    expect(page).toMatchObject({ ok: true, total: 2 })
  })

  it('keeps the newest past the listing cap', async () => {
    for (let day = 1; day <= 4; day++) write(`many/${day}.png`, new Date(2025, 0, day))
    const many = path.join(root, 'many')
    const page = await listLocalAssets('a', { output: many, input: many }, {})
    expect(page).toMatchObject({ ok: true, truncated: true })
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((a) => a.name)).toEqual(['4.png', '3.png', '2.png'])
  })
})

describe('localAssetFile', () => {
  it('finds an asset by id inside its area only', async () => {
    expect(await localAssetFile(folders, 'input/voice.wav')).toBe(
      path.join(root, 'input', 'voice.wav')
    )
    expect(await localAssetFile(folders, 'output/../input/voice.wav')).toBeNull()
    expect(await localAssetFile(folders, 'models/x.safetensors')).toBeNull()
    expect(await localAssetFile(folders, 'voice.wav')).toBeNull()
  })
})
