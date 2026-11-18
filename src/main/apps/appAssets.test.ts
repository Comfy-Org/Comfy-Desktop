import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { root, sharedOutput, sharedInput, ownOutput, ownInput, outside, mocks } = await vi.hoisted(
  async () => {
    const nodeFs = await import('node:fs')
    const nodeOs = await import('node:os')
    const nodePath = await import('node:path')
    const base = nodeFs.realpathSync(
      nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'app-assets-'))
    )
    return {
      root: base,
      sharedOutput: nodePath.join(base, 'shared', 'output'),
      sharedInput: nodePath.join(base, 'shared', 'input'),
      ownOutput: nodePath.join(base, 'own', 'output'),
      ownInput: nodePath.join(base, 'own', 'input'),
      outside: nodePath.join(base, 'Pictures'),
      mocks: {
        buildId: null as string | null,
        listCloud: vi.fn(),
        readCloud: vi.fn(),
        thumbnail: vi.fn(async (file: string) => `data:image/jpeg;base64,${file.length}`),
        cloudThumbnail: vi.fn((_bytes: Uint8Array) => 'data:image/jpeg;base64,Y2xvdWQ=')
      }
    }
  }
)

vi.mock('./localComfy', () => ({ pageBuildId: () => mocks.buildId }))
vi.mock('../installations', () => ({
  get: async (id: string) => (id === 'own-build' ? { id } : null)
}))
vi.mock('../lib/outputFolders', () => ({
  comfyFoldersOf: (build: { id: string } | null) =>
    build ? { output: ownOutput, input: ownInput } : { output: sharedOutput, input: sharedInput },
  thumbnailDataUrl: (file: string) => mocks.thumbnail(file),
  thumbnailDataUrlFromBytes: (bytes: Uint8Array) => mocks.cloudThumbnail(bytes)
}))
vi.mock('../lib/assets', () => ({
  listNewestCloudOutputs: (limit: number, after?: string) => mocks.listCloud(limit, after),
  readCloudOutput: (id: string, max: number, timeout: number) => mocks.readCloud(id, max, timeout)
}))

import type { WebContents } from 'electron'
import type { ComfyDesktopAssetRef } from '../../types/comfyDesktopBridge'
import type { CloudOutput, CloudOutputPage } from '../lib/assets'
import {
  _heldRefsForTest,
  _resetForTest,
  annotatedName,
  appOfResult,
  assetFromPath,
  assetRunValue,
  DEFAULT_RECENT,
  MAX_CLOUD_PAGES,
  MAX_FILE_BYTES,
  MAX_READ_BYTES,
  MAX_RECENT,
  MAX_REFS_PER_PAGE,
  readAsset,
  recentAssets
} from './appAssets'

type FakePage = WebContents & EventEmitter

function newPage(): FakePage {
  return new EventEmitter() as FakePage
}

let page: FakePage

function write(file: string, body: string | Buffer = 'x', modified = 1_700_000_000): string {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  fs.utimesSync(file, modified, modified)
  return file
}

function sha16(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

function cloudOutput(extra: Partial<CloudOutput> = {}): CloudOutput {
  return {
    id: 'asset-1',
    name: 'ComfyUI_00001_.png',
    size: 1_000,
    mimeType: 'image/png',
    createdAt: '2026-11-10T12:00:00.000Z',
    loaderPath: '0f3a9c.png',
    tags: ['output'],
    ...extra
  }
}

function cloudPage(outputs: CloudOutput[], nextCursor: string | null = null): CloudOutputPage {
  return { outputs, nextCursor }
}

async function refOf(file: string, kinds = ['image', 'video']): Promise<ComfyDesktopAssetRef> {
  const answer = await assetFromPath(page, file, { kinds })
  if ('error' in answer) throw new Error(`No reference for ${file}: ${answer.error}`)
  return answer
}

const CUTOUT = path.join(sharedOutput, 'apps', 'remove-background', 'cutout_00001_.png')

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  _resetForTest()
  mocks.buildId = null
  mocks.listCloud.mockResolvedValue(cloudPage([]))
  mocks.readCloud.mockResolvedValue({ error: 'missing' })
  for (const entry of fs.readdirSync(root)) fs.rmSync(path.join(root, entry), { recursive: true })
  for (const dir of [sharedOutput, sharedInput, ownOutput, ownInput, outside]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  page = newPage()
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('annotatedName', () => {
  it('names a file inside a folder by its path from that folder, with forward slashes', () => {
    expect(annotatedName(sharedOutput, CUTOUT, 'output')).toBe(
      'apps/remove-background/cutout_00001_.png [output]'
    )
  })

  it('uses forward slashes for a Windows path under output\\apps\\remove-background', () => {
    expect(
      annotatedName(
        'C:\\Users\\me\\ComfyUI\\output',
        'C:\\Users\\me\\ComfyUI\\output\\apps\\remove-background\\cutout_00001_.png',
        'output',
        path.win32
      )
    ).toBe('apps/remove-background/cutout_00001_.png [output]')
    expect(
      annotatedName(
        'C:\\Users\\me\\ComfyUI\\input',
        'c:\\users\\me\\comfyui\\input\\desktop\\0123456789abcdef.png',
        'input',
        path.win32
      ),
      'Windows paths differ only in case'
    ).toBe('desktop/0123456789abcdef.png [input]')
  })

  it('gives no name for a file outside the folder or the folder itself', () => {
    const win = 'C:\\Users\\me\\ComfyUI\\output'
    expect(annotatedName(win, 'D:\\output\\cutout.png', 'output', path.win32)).toBeNull()
    expect(
      annotatedName(win, 'C:\\Users\\me\\ComfyUI\\outputs\\a.png', 'output', path.win32)
    ).toBeNull()
    expect(annotatedName(sharedOutput, path.join(outside, 'a.png'), 'output')).toBeNull()
    expect(annotatedName(sharedOutput, sharedOutput, 'output')).toBeNull()
  })

  it('keeps a file whose name starts with two dots', () => {
    expect(annotatedName(sharedOutput, path.join(sharedOutput, '..cutout.png'), 'output')).toBe(
      '..cutout.png [output]'
    )
  })
})

describe('appOfResult', () => {
  it('is the first folder under apps/, or null for a file directly in it', () => {
    const apps = path.join(sharedOutput, 'apps')
    expect(appOfResult(apps, CUTOUT)).toBe('remove-background')
    expect(appOfResult(apps, path.join(apps, 'cutout.png'))).toBeNull()
    expect(
      appOfResult(
        'C:\\ComfyUI\\output\\apps',
        'C:\\ComfyUI\\output\\apps\\extend-picture\\wide.png',
        path.win32
      )
    ).toBe('extend-picture')
  })
})

describe('recent on This computer', () => {
  beforeEach(() => {
    write(CUTOUT, 'cutout', 1_700_000_300)
    write(path.join(sharedOutput, 'apps', 'sdr-to-hdr', 'clip.mp4'), 'clip', 1_700_000_200)
    write(path.join(sharedOutput, 'apps', 'loose.webp'), 'loose', 1_700_000_100)
    write(path.join(sharedOutput, 'apps', '.hidden.png'), 'hidden', 1_700_000_900)
    write(path.join(sharedOutput, 'apps', 'notes.txt'), 'notes', 1_700_000_900)
    write(path.join(sharedOutput, 'apps', 'vector.svg'), '<svg/>', 1_700_000_900)
    write(path.join(sharedOutput, 'ComfyUI_00001_.png'), 'graph', 1_700_000_900)
    write(path.join(sharedOutput, 'graphs', 'portrait.png'), 'graph', 1_700_000_900)
  })

  it('lists only app results under output/apps, newest first, with the app that made each', async () => {
    const recent = await recentAssets(page, { kinds: ['image', 'video'], where: 'local' })

    expect(recent.map(({ name, kind, app, where }) => ({ name, kind, app, where }))).toEqual([
      { name: 'cutout_00001_.png', kind: 'image', app: 'remove-background', where: 'local' },
      { name: 'clip.mp4', kind: 'video', app: 'sdr-to-hdr', where: 'local' },
      { name: 'loose.webp', kind: 'image', app: null, where: 'local' }
    ])
    expect(recent[0]).toMatchObject({
      createdAt: 1_700_000_300_000,
      size: 'cutout'.length,
      thumb: expect.stringMatching(/^data:image\/jpeg;base64,/)
    })
    expect(mocks.thumbnail).toHaveBeenCalledWith(CUTOUT)
  })

  it('lists only the kinds the input takes, told by extension', async () => {
    const videos = await recentAssets(page, { kinds: ['video'], where: 'local' })
    expect(videos.map((asset) => asset.name)).toEqual(['clip.mp4'])

    const images = await recentAssets(page, { kinds: ['image', 'audio'], where: 'local' })
    expect(images.map((asset) => asset.name)).toEqual(['cutout_00001_.png', 'loose.webp'])
  })

  it('lists nothing for a request without kinds or a known place', async () => {
    expect(await recentAssets(page, { kinds: [], where: 'local' })).toEqual([])
    expect(await recentAssets(page, { kinds: ['image'], where: 'disk' })).toEqual([])
    expect(await recentAssets(page, null)).toEqual([])
  })

  it('lists 12 by default and never more than 48', async () => {
    for (let i = 0; i < MAX_RECENT + 5; i++) {
      write(path.join(sharedOutput, 'apps', 'many', `m${i}.png`), `m${i}`, 1_700_001_000 + i)
    }

    const byDefault = await recentAssets(page, { kinds: ['image'], where: 'local' })
    expect(byDefault).toHaveLength(DEFAULT_RECENT)
    expect(byDefault[0]?.name).toBe(`m${MAX_RECENT + 4}.png`)
    expect(await recentAssets(page, { kinds: ['image'], where: 'local', limit: 500 })).toHaveLength(
      MAX_RECENT
    )
    expect(await recentAssets(page, { kinds: ['image'], where: 'local', limit: 1 })).toHaveLength(1)
  })

  it("lists the output folder of the build the page's local runs go to", async () => {
    write(path.join(ownOutput, 'apps', 'genjutsu', 'own.png'), 'own')
    mocks.buildId = 'own-build'

    const recent = await recentAssets(page, { kinds: ['image'], where: 'local' })

    expect(recent.map((asset) => asset.name)).toEqual(['own.png'])
  })

  it('lists nothing when output/apps links to a folder outside the output folder', async () => {
    fs.rmSync(path.join(sharedOutput, 'apps'), { recursive: true })
    write(path.join(outside, 'private.png'))
    fs.symlinkSync(outside, path.join(sharedOutput, 'apps'))

    expect(await recentAssets(page, { kinds: ['image'], where: 'local' })).toEqual([])
  })

  it('gives the same reference for the same file each time', async () => {
    const first = await recentAssets(page, { kinds: ['image'], where: 'local' })
    const second = await recentAssets(page, { kinds: ['image'], where: 'local' })

    expect(second.map((asset) => asset.ref)).toEqual(first.map((asset) => asset.ref))
    expect(_heldRefsForTest(page)).toBe(2)
  })
})

describe('recent on Comfy Cloud', () => {
  it('lists the newest Cloud outputs of the kinds asked for, without missing ones', async () => {
    mocks.listCloud.mockResolvedValue(
      cloudPage([
        cloudOutput({ id: 'a', name: 'a.png' }),
        cloudOutput({ id: 'b', name: 'b.mp4', mimeType: 'video/mp4', size: 50_000_000 }),
        cloudOutput({ id: 'c', name: 'c.png', tags: ['output', 'missing'] }),
        cloudOutput({ id: 'd', name: 'd.glb', mimeType: 'model/gltf-binary' }),
        cloudOutput({ id: 'e', name: 'e.png', size: 20 * 1024 ** 2 })
      ])
    )
    mocks.readCloud.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) })

    const recent = await recentAssets(page, { kinds: ['image', 'video'], where: 'cloud', limit: 3 })

    expect(mocks.listCloud).toHaveBeenCalledExactlyOnceWith(12, undefined)
    expect(recent.map(({ name, kind, where, thumb }) => ({ name, kind, where, thumb }))).toEqual([
      { name: 'a.png', kind: 'image', where: 'cloud', thumb: 'data:image/jpeg;base64,Y2xvdWQ=' },
      { name: 'b.mp4', kind: 'video', where: 'cloud', thumb: null },
      { name: 'e.png', kind: 'image', where: 'cloud', thumb: null }
    ])
    expect(recent[0]).toMatchObject({
      app: null,
      size: 1_000,
      createdAt: Date.parse('2026-11-10T12:00:00.000Z')
    })
    expect(mocks.readCloud).toHaveBeenCalledTimes(1)
  })

  it('makes each Cloud thumbnail once, and fetches nothing already seen on a relist', async () => {
    mocks.listCloud.mockResolvedValue(
      cloudPage([cloudOutput({ id: 'a', name: 'a.png' }), cloudOutput({ id: 'b', name: 'b.png' })])
    )
    mocks.readCloud.mockResolvedValue({ bytes: new Uint8Array([1]) })

    const first = await recentAssets(page, { kinds: ['image'], where: 'cloud' })
    const again = await recentAssets(newPage(), { kinds: ['image'], where: 'cloud' })

    expect(mocks.readCloud).toHaveBeenCalledTimes(2)
    expect(again.map((asset) => asset.thumb)).toEqual(first.map((asset) => asset.thumb))
    expect(again[0]?.thumb).toBe('data:image/jpeg;base64,Y2xvdWQ=')
  })

  it('tries a Cloud thumbnail again after a failed fetch', async () => {
    mocks.listCloud.mockResolvedValue(cloudPage([cloudOutput({ id: 'a', name: 'a.png' })]))
    mocks.readCloud.mockResolvedValueOnce({ error: 'elsewhere' })
    mocks.readCloud.mockResolvedValueOnce({ bytes: new Uint8Array([1]) })

    const [failed] = await recentAssets(page, { kinds: ['image'], where: 'cloud' })
    const [fetched] = await recentAssets(page, { kinds: ['image'], where: 'cloud' })

    expect(failed?.thumb).toBeNull()
    expect(fetched?.thumb).toBe('data:image/jpeg;base64,Y2xvdWQ=')
    expect(mocks.readCloud).toHaveBeenCalledTimes(2)
  })

  it('reads on past a page with none of the kind asked for', async () => {
    const videos = Array.from({ length: DEFAULT_RECENT * 4 }, (_, i) =>
      cloudOutput({ id: `v${i}`, name: `v${i}.mp4`, mimeType: 'video/mp4' })
    )
    mocks.listCloud
      .mockResolvedValueOnce(cloudPage(videos, 'page-2'))
      .mockResolvedValueOnce(cloudPage([cloudOutput({ id: 'old', name: 'old.png' })], 'page-3'))
      .mockResolvedValueOnce(cloudPage([cloudOutput({ id: 'older', name: 'older.png' })]))

    const recent = await recentAssets(page, { kinds: ['image'], where: 'cloud' })

    expect(recent.map((asset) => asset.name)).toEqual(['old.png', 'older.png'])
    expect(mocks.listCloud.mock.calls).toEqual([
      [48, undefined],
      [48, 'page-2'],
      [48, 'page-3']
    ])
  })

  it('stops reading once it has as many as asked for', async () => {
    const both = [cloudOutput({ id: 'a', name: 'a.png' }), cloudOutput({ id: 'b', name: 'b.jpg' })]
    mocks.listCloud.mockResolvedValue(cloudPage(both, 'more'))

    const recent = await recentAssets(page, { kinds: ['image'], where: 'cloud', limit: 2 })

    expect(recent.map((asset) => asset.name)).toEqual(['a.png', 'b.jpg'])
    expect(mocks.listCloud).toHaveBeenCalledTimes(1)
  })

  it(`reads at most ${MAX_CLOUD_PAGES} pages, and stops on a cursor it has seen`, async () => {
    let pages = 0
    mocks.listCloud.mockImplementation(async () =>
      cloudPage([cloudOutput({ name: 'clip.mp4', mimeType: 'video/mp4' })], `page-${++pages}`)
    )

    expect(await recentAssets(page, { kinds: ['image'], where: 'cloud' })).toEqual([])
    expect(mocks.listCloud).toHaveBeenCalledTimes(MAX_CLOUD_PAGES)

    mocks.listCloud.mockClear()
    mocks.listCloud.mockResolvedValue(cloudPage([], 'same'))

    expect(await recentAssets(page, { kinds: ['image'], where: 'cloud' })).toEqual([])
    expect(mocks.listCloud).toHaveBeenCalledTimes(2)
  })

  it('lists nothing when signed out', async () => {
    mocks.listCloud.mockResolvedValue(null)

    expect(await recentAssets(page, { kinds: ['image'], where: 'cloud' })).toEqual([])
  })
})

describe('fromFile', () => {
  it('refuses a request with no path, a relative path or no string', async () => {
    const images = { kinds: ['image'] }

    expect(await assetFromPath(page, '', images)).toEqual({ error: 'no-path' })
    expect(await assetFromPath(page, 'photo.png', images)).toEqual({ error: 'no-path' })
    expect(await assetFromPath(page, { path: CUTOUT }, images)).toEqual({ error: 'no-path' })
  })

  it('refuses a folder, even one named like a picture', async () => {
    const album = path.join(outside, 'album.png')
    fs.mkdirSync(album)

    expect(await assetFromPath(page, album, { kinds: ['image'] })).toEqual({ error: 'not-a-file' })
  })

  it('refuses a file of a kind the input does not take', async () => {
    const report = write(path.join(outside, 'report.pdf'))
    const photo = write(path.join(outside, 'photo.jpg'))

    expect(await assetFromPath(page, report, { kinds: ['image', 'video'] })).toEqual({
      error: 'wrong-kind'
    })
    expect(await assetFromPath(page, photo, { kinds: ['video'] })).toEqual({ error: 'wrong-kind' })
    expect(await assetFromPath(page, photo, {})).toEqual({ error: 'wrong-kind' })
  })

  it('answers missing for a file that is not there', async () => {
    const gone = path.join(outside, 'gone.png')

    expect(await assetFromPath(page, gone, { kinds: ['image'] })).toEqual({ error: 'missing' })
  })

  it('refuses a file above 2 GiB', async () => {
    const file = write(path.join(outside, 'huge.mp4'))
    const real = await fsp.stat(file)
    vi.spyOn(fsp, 'stat').mockResolvedValueOnce(
      Object.assign(Object.create(Object.getPrototypeOf(real)), real, { size: MAX_FILE_BYTES + 1 })
    )

    expect(await assetFromPath(page, file, { kinds: ['video'] })).toEqual({ error: 'too-large' })
  })

  it('takes a file anywhere, named by where its links lead', async () => {
    const photo = write(path.join(outside, 'photo.jpg'), 'photo', 1_700_000_500)
    const link = path.join(root, 'shortcut.png')
    fs.symlinkSync(photo, link)

    const asset = await refOf(link, ['image'])

    expect(asset).toMatchObject({
      name: 'photo.jpg',
      kind: 'image',
      where: 'local',
      app: null,
      size: 5,
      createdAt: 1_700_000_500_000,
      thumb: null
    })
    expect(mocks.thumbnail, 'the page already has the dropped file to show').not.toHaveBeenCalled()
    const bytes = await readAsset(page, asset.ref)
    expect(bytes).toEqual({ bytes: expect.any(ArrayBuffer), mime: 'image/jpeg' })
    expect(Buffer.from((bytes as { bytes: ArrayBuffer }).bytes).toString()).toBe('photo')
  })

  it('names the app for a file dropped from output/apps', async () => {
    write(CUTOUT)

    expect(await refOf(CUTOUT)).toMatchObject({ app: 'remove-background' })
  })
})

describe('read', () => {
  it('answers missing for a reference this page was not given', async () => {
    write(CUTOUT)
    const asset = await refOf(CUTOUT)

    expect(await readAsset(newPage(), asset.ref)).toEqual({ error: 'missing' })
    expect(await readAsset(page, 'not-a-ref')).toEqual({ error: 'missing' })
    expect(await readAsset(page, 42)).toEqual({ error: 'missing' })
  })

  it('answers missing once the file is gone', async () => {
    write(CUTOUT)
    const asset = await refOf(CUTOUT)
    fs.rmSync(CUTOUT)

    expect(await readAsset(page, asset.ref)).toEqual({ error: 'missing' })
  })

  it('reads a Cloud output with the cap, and passes on why it could not', async () => {
    mocks.listCloud.mockResolvedValue(cloudPage([cloudOutput({ size: 20 * 1024 ** 2 })]))
    const [asset] = await recentAssets(page, { kinds: ['image'], where: 'cloud' })

    mocks.readCloud.mockResolvedValueOnce({ bytes: new Uint8Array([7, 8]) })
    const bytes = await readAsset(page, asset!.ref)
    expect(bytes).toMatchObject({ mime: 'image/png' })
    expect([...new Uint8Array((bytes as { bytes: ArrayBuffer }).bytes)]).toEqual([7, 8])
    expect(mocks.readCloud).toHaveBeenLastCalledWith('asset-1', MAX_READ_BYTES, expect.any(Number))

    mocks.readCloud.mockResolvedValueOnce({ error: 'too-large' })
    expect(await readAsset(page, asset!.ref)).toEqual({ error: 'too-large' })
    mocks.readCloud.mockResolvedValueOnce({ error: 'signed-out' })
    expect(await readAsset(page, asset!.ref)).toEqual({ error: 'signed-out' })
    mocks.readCloud.mockResolvedValueOnce({ error: 'elsewhere' })
    expect(await readAsset(page, asset!.ref)).toEqual({ error: 'elsewhere' })
  })

  it('answers elsewhere, not missing, when reading from Cloud fails', async () => {
    mocks.listCloud.mockResolvedValue(cloudPage([cloudOutput({ size: 20 * 1024 ** 2 })]))
    const [asset] = await recentAssets(page, { kinds: ['image'], where: 'cloud' })
    mocks.readCloud.mockRejectedValueOnce(new TypeError('fetch failed'))

    expect(await readAsset(page, asset!.ref)).toEqual({ error: 'elsewhere' })
  })
})

describe('valueFor on This computer', () => {
  it('names a result in the output folder in place', async () => {
    write(CUTOUT)
    const asset = await refOf(CUTOUT)

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: 'apps/remove-background/cutout_00001_.png [output]'
    })
    expect(fs.readdirSync(sharedInput)).toEqual([])
  })

  it('names a file in the input folder in place', async () => {
    const file = write(path.join(sharedInput, 'comfy-apps', 'upload.png'))
    const asset = await refOf(file)

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: 'comfy-apps/upload.png [input]'
    })
  })

  it("checks the file against the folders of the page's build", async () => {
    write(CUTOUT)
    const asset = await refOf(CUTOUT)
    mocks.buildId = 'own-build'

    const answer = await assetRunValue(page, asset.ref, { where: 'local' })

    expect(answer).toEqual({ value: `desktop/${sha16('x')}.png [input]` })
    expect(fs.existsSync(path.join(ownInput, 'desktop', `${sha16('x')}.png`))).toBe(true)
  })

  it('copies a file from elsewhere once into input/desktop, by clone, never by hard link', async () => {
    const photo = write(path.join(outside, 'Photo.JPG'), 'holiday')
    const asset = await refOf(photo)
    const copyFile = vi.spyOn(fsp, 'copyFile')
    const name = `${sha16('holiday')}.jpg`

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: `desktop/${name} [input]`
    })
    const copy = path.join(sharedInput, 'desktop', name)
    expect(fs.readFileSync(copy, 'utf8')).toBe('holiday')
    expect(fs.statSync(copy).nlink).toBe(1)
    expect(fs.statSync(photo).nlink).toBe(1)
    expect(fs.statSync(copy).ino).not.toBe(fs.statSync(photo).ino)
    expect(copyFile).toHaveBeenCalledExactlyOnceWith(
      photo,
      expect.stringMatching(/\.part$/),
      fs.constants.COPYFILE_FICLONE
    )
    expect(fs.readdirSync(path.join(sharedInput, 'desktop'))).toEqual([name])

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: `desktop/${name} [input]`
    })
    expect(copyFile, 'the second run reuses the copy').toHaveBeenCalledTimes(1)
  })

  it('hashes a dropped file once until it changes', async () => {
    const photo = write(path.join(outside, 'photo.png'), 'first', 1_700_000_000)
    const asset = await refOf(photo)
    const reads = vi.spyOn(fs, 'createReadStream')

    await assetRunValue(page, asset.ref, { where: 'local' })
    await assetRunValue(page, asset.ref, { where: 'local' })
    expect(reads, 'the second run reuses the hash').toHaveBeenCalledTimes(1)

    write(photo, 'second', 1_700_000_100)
    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: `desktop/${sha16('second')}.png [input]`
    })
    expect(reads, 'a changed file is hashed again').toHaveBeenCalledTimes(2)
  })

  it('reuses a copy of the same picture made before', async () => {
    const name = `${sha16('same')}.png`
    const earlier = write(path.join(sharedInput, 'desktop', name), 'same')
    const earlierFile = fs.statSync(earlier).ino
    const asset = await refOf(write(path.join(outside, 'again.png'), 'same'))

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: `desktop/${name} [input]`
    })
    expect(fs.readdirSync(path.join(sharedInput, 'desktop'))).toEqual([name])
    expect(fs.statSync(earlier).ino, 'the earlier copy stays in place').toBe(earlierFile)
  })

  it('names the copy by the bytes it copied when the file is replaced while copying', async () => {
    const photo = write(path.join(outside, 'photo.png'), 'original', 1_700_000_000)
    const asset = await refOf(photo)
    const realCopyFile = fsp.copyFile
    vi.spyOn(fsp, 'copyFile').mockImplementationOnce(async (from, to, mode) => {
      write(photo, 'replaced', 1_700_000_100)
      return realCopyFile(from, to, mode)
    })
    const desktop = path.join(sharedInput, 'desktop')

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: `desktop/${sha16('replaced')}.png [input]`
    })
    expect(fs.readdirSync(desktop)).toEqual([`${sha16('replaced')}.png`])
    expect(fs.readFileSync(path.join(desktop, `${sha16('replaced')}.png`), 'utf8')).toBe('replaced')

    const original = await refOf(write(path.join(outside, 'original.png'), 'original'))
    expect(await assetRunValue(page, original.ref, { where: 'local' })).toEqual({
      value: `desktop/${sha16('original')}.png [input]`
    })
    expect(fs.readFileSync(path.join(desktop, `${sha16('original')}.png`), 'utf8')).toBe('original')
  })

  it('makes one copy when two runs ask at once', async () => {
    const asset = await refOf(write(path.join(outside, 'twice.png'), 'twice'))
    const copyFile = vi.spyOn(fsp, 'copyFile')

    const [first, second] = await Promise.all([
      assetRunValue(page, asset.ref, { where: 'local' }),
      assetRunValue(page, asset.ref, { where: 'local' })
    ])

    expect(first).toEqual(second)
    expect(copyFile).toHaveBeenCalledTimes(1)
  })

  it('leaves no partial copy behind when the copy fails', async () => {
    const asset = await refOf(write(path.join(outside, 'broken.png'), 'broken'))
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('disk full'))

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({ error: 'missing' })
    expect(fs.readdirSync(path.join(sharedInput, 'desktop'))).toEqual([])
  })

  it('refuses to copy where input/desktop leads out of the input folder', async () => {
    const elsewhere = path.join(root, 'elsewhere')
    fs.mkdirSync(elsewhere)
    fs.symlinkSync(elsewhere, path.join(sharedInput, 'desktop'))
    const asset = await refOf(write(path.join(outside, 'photo.png'), 'photo'))

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      error: 'elsewhere'
    })
    expect(fs.readdirSync(elsewhere)).toEqual([])
  })

  it('refuses to reuse a target name that is a folder or a link', async () => {
    const name = `${sha16('photo')}.png`
    fs.mkdirSync(path.join(sharedInput, 'desktop', name), { recursive: true })
    const asset = await refOf(write(path.join(outside, 'photo.png'), 'photo'))

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      error: 'elsewhere'
    })
  })

  it('answers missing once the file is gone, and elsewhere for a Cloud run', async () => {
    write(CUTOUT)
    const asset = await refOf(CUTOUT)

    expect(await assetRunValue(page, asset.ref, { where: 'cloud' })).toEqual({
      error: 'elsewhere'
    })
    fs.rmSync(CUTOUT)
    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({ error: 'missing' })
    expect(await assetRunValue(page, 'unknown', { where: 'local' })).toEqual({ error: 'missing' })
  })
})

describe('valueFor on Comfy Cloud', () => {
  it("answers the Cloud output's loader path, and elsewhere for a run on This computer", async () => {
    mocks.listCloud.mockResolvedValue(
      cloudPage([cloudOutput(), cloudOutput({ id: 'asset-2', name: 'b.png', loaderPath: null })])
    )
    const [asset, noLoader] = await recentAssets(page, { kinds: ['image'], where: 'cloud' })

    expect(await assetRunValue(page, asset!.ref, { where: 'cloud' })).toEqual({
      value: '0f3a9c.png [output]'
    })
    expect(await assetRunValue(page, asset!.ref, { where: 'local' })).toEqual({
      error: 'elsewhere'
    })
    expect(await assetRunValue(page, noLoader!.ref, { where: 'cloud' })).toEqual({
      error: 'elsewhere'
    })
  })
})

describe('references', () => {
  it('end when the page navigates to a new document', async () => {
    write(CUTOUT)
    const asset = await refOf(CUTOUT)

    page.emit('did-navigate')

    expect(await readAsset(page, asset.ref)).toEqual({ error: 'missing' })
    expect(_heldRefsForTest(page)).toBe(0)
  })

  it('end when the page is destroyed', async () => {
    write(CUTOUT)
    await refOf(CUTOUT)

    page.emit('destroyed')

    expect(_heldRefsForTest(page)).toBe(0)
  })

  it('keep working for the next document after a navigation', async () => {
    write(CUTOUT)
    await refOf(CUTOUT)
    page.emit('did-navigate')

    const asset = await refOf(CUTOUT)

    expect(await assetRunValue(page, asset.ref, { where: 'local' })).toEqual({
      value: 'apps/remove-background/cutout_00001_.png [output]'
    })
    expect(page.listenerCount('did-navigate')).toBe(1)
  })

  it(`keep at most ${MAX_REFS_PER_PAGE} per page, dropping the oldest`, async () => {
    const refs: string[] = []
    for (let i = 0; i <= MAX_REFS_PER_PAGE; i++) {
      refs.push((await refOf(write(path.join(outside, `p${i}.png`), `p${i}`))).ref)
    }

    expect(_heldRefsForTest(page)).toBe(MAX_REFS_PER_PAGE)
    expect(await readAsset(page, refs[0])).toEqual({ error: 'missing' })
    expect(await readAsset(page, refs[MAX_REFS_PER_PAGE])).toMatchObject({ mime: 'image/png' })
  })
})
