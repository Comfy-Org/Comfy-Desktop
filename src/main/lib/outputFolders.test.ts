import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  root,
  sharedDir,
  ownDir,
  installDir,
  outsideDir,
  installs,
  fetchFile,
  thumbnailImage,
  fullImage,
  shownInFolder,
  trashed,
  copiedImage
} = await vi.hoisted(async () => {
  const nodeFs = await import('node:fs')
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const base = nodeFs.realpathSync(
    nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'output-folders-'))
  )
  return {
    root: base,
    sharedDir: nodePath.join(base, 'shared-output'),
    ownDir: nodePath.join(base, 'own-output'),
    installDir: nodePath.join(base, 'install'),
    outsideDir: nodePath.join(base, 'outside'),
    installs: vi.fn(),
    fetchFile: vi.fn(async (url: string) => new Response(`file ${url}`)),
    thumbnailImage: vi.fn(),
    fullImage: vi.fn(),
    shownInFolder: vi.fn(),
    trashed: vi.fn(async (file: string) => nodeFs.rmSync(file)),
    copiedImage: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: {
    showItemInFolder: (file: string) => shownInFolder(file),
    trashItem: (file: string) => trashed(file)
  },
  clipboard: { writeImage: (image: unknown) => copiedImage(image) },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: { fetch: (url: string) => fetchFile(url) },
  nativeImage: {
    createThumbnailFromPath: (file: string) => thumbnailImage(file),
    createFromPath: (file: string) => fullImage(file)
  }
}))
vi.mock('../installations', () => ({ list: () => installs() }))
vi.mock('../settings', () => ({
  get: (key: string) => (key === 'outputDir' ? sharedDir : undefined),
  defaults: { outputDir: path.join(root, 'default-output') }
}))
vi.mock('./ipc/shared', () => ({
  sourceMap: {
    standalone: { category: 'local', getLaunchCommand: () => ({ cmd: 'python' }) },
    desktop: {
      category: 'local',
      getLaunchCommand: () => ({ cmd: 'open', skipSharedPaths: true })
    },
    cloud: { category: 'cloud' }
  }
}))
vi.mock('./models', () => ({
  installOutputDir: (installPath: string) => path.join(installPath, 'ComfyUI', 'output')
}))
vi.mock('./assets', () => ({
  assetKind: (name: string) =>
    ({ png: 'image', mp4: 'video', webm: 'video', wav: 'audio', glb: '3d' })[
      name.split('.').pop() ?? ''
    ] ?? null
}))

import type { InstallationRecord } from '../installations'
import {
  MAX_FOLDER_DEPTH,
  MAX_LOCAL_ASSETS,
  THUMBNAIL_WAIT_MS,
  copyOutputImage,
  revealOutputFile,
  trashOutputFile,
  listLocalAssets,
  listOutputFolders,
  outputDirOverride,
  outputFilePath,
  outputFileUrl,
  serveOutputFile
} from './outputFolders'

function install(name: string, extra: Record<string, unknown> = {}): InstallationRecord {
  return {
    id: name,
    name,
    sourceId: 'standalone',
    installPath: installDir,
    createdAt: '2026-11-01T00:00:00Z',
    ...extra
  }
}

const SAMPLE_VIDEO = path.resolve('src/renderer/public/install-showcase-scene/Assets/earpods.webm')

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header.writeUInt8(8, 24)
  header.writeUInt8(2, 25)
  return header
}

function write(
  file: string,
  body: string | Buffer = 'x',
  modified = new Date('2026-11-01T00:00:00Z')
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  fs.utimesSync(file, modified, modified)
}

beforeEach(() => {
  vi.clearAllMocks()
  thumbnailImage.mockReset()
  fullImage.mockReset()
  for (const dir of [sharedDir, ownDir, outsideDir, installDir])
    fs.rmSync(dir, { recursive: true, force: true })
  for (const dir of [sharedDir, ownDir, outsideDir, path.join(installDir, 'ComfyUI', 'output')])
    fs.mkdirSync(dir, { recursive: true })
  installs.mockResolvedValue([
    install('Test Instance'),
    install('My Local 1'),
    install('Apps', { useSharedOutput: false, outputDir: ownDir }),
    install('Bare', { useSharedOutput: false }),
    install('Cloud', { sourceId: 'cloud' }),
    install('Old Desktop', { sourceId: 'desktop' })
  ])
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('outputDirOverride', () => {
  it('uses the shared folder unless the build turned sharing off', () => {
    expect(outputDirOverride(install('a'), sharedDir)).toBe(sharedDir)
    expect(
      outputDirOverride(install('a', { useSharedOutput: false, outputDir: ownDir }), sharedDir)
    ).toBe(ownDir)
    expect(outputDirOverride(install('a', { useSharedOutput: false }), sharedDir)).toBeNull()
  })
})

describe('listOutputFolders', () => {
  it('lists each real output folder once, leaving out Cloud and builds that manage their own paths', async () => {
    expect(await listOutputFolders()).toEqual([
      sharedDir,
      ownDir,
      path.join(installDir, 'ComfyUI', 'output')
    ])
  })

  it('leaves out folders that do not exist yet', async () => {
    installs.mockResolvedValue([
      install('Gone', { useSharedOutput: false, outputDir: path.join(root, 'missing') })
    ])
    expect(await listOutputFolders()).toEqual([sharedDir])
  })
})

describe('listLocalAssets', () => {
  it('lists media from every output folder and its subfolders, newest first', async () => {
    write(path.join(sharedDir, 'old.png'), 'x', new Date('2026-10-01T00:00:00Z'))
    write(path.join(sharedDir, 'video', 'new.mp4'), 'xx', new Date('2026-11-05T00:00:00Z'))
    write(path.join(ownDir, 'voice.wav'), 'xxx', new Date('2026-11-03T00:00:00Z'))
    write(
      path.join(installDir, 'ComfyUI', 'output', 'mesh.glb'),
      'x',
      new Date('2026-11-02T00:00:00Z')
    )
    write(path.join(sharedDir, 'notes.txt'))
    write(path.join(sharedDir, '.hidden.png'))
    write(path.join(sharedDir, '.cache', 'inside-hidden.png'))

    const assets = await listLocalAssets()

    expect(assets.map((a) => a.name)).toEqual(['new.mp4', 'voice.wav', 'mesh.glb', 'old.png'])
    const newVideo = path.join(sharedDir, 'video', 'new.mp4')
    expect(assets[0]).toEqual({
      id: newVideo,
      name: 'new.mp4',
      kind: 'video',
      sizeBytes: 2,
      createdAt: '2026-11-05T00:00:00.000Z',
      mimeType: null,
      tags: ['output'],
      previewUrl: outputFileUrl(newVideo),
      thumbnailUrl: null,
      width: null,
      height: null,
      durationSeconds: null
    })
    const oldPicture = path.join(sharedDir, 'old.png')
    expect(assets[3]!.thumbnailUrl, 'an image thumbnail link changes when the file does').toBe(
      outputFileUrl(oldPicture, fs.statSync(oldPicture).mtimeMs)
    )
    expect(assets[2]!.previewUrl, '3D files have no preview').toBeNull()
  })

  it('reports the size of each picture and video, and how long a video runs, before they load', async () => {
    write(path.join(sharedDir, 'portrait.png'), pngHeader(640, 960))
    write(path.join(sharedDir, 'clip.webm'), fs.readFileSync(SAMPLE_VIDEO))
    write(path.join(sharedDir, 'broken.png'), 'not a picture')

    const facts = Object.fromEntries(
      (await listLocalAssets()).map((a) => [
        a.name,
        [a.width, a.height, a.durationSeconds && Math.round(a.durationSeconds)]
      ])
    )

    expect(facts).toEqual({
      'portrait.png': [640, 960, null],
      'clip.webm': [714, 530, 8],
      'broken.png': [null, null, null]
    })
  })

  it('finds a file once when two builds save to the same folder', async () => {
    write(path.join(sharedDir, 'shared.png'))

    expect((await listLocalAssets()).map((a) => a.name)).toEqual(['shared.png'])
  })

  it('keeps only the newest files when the folders are very large', async () => {
    for (let i = 0; i <= MAX_LOCAL_ASSETS; i++)
      write(path.join(sharedDir, `f${i}.png`), '', new Date(Date.UTC(2026, 0, 1, 0, 0, i)))

    const assets = await listLocalAssets()

    expect(assets).toHaveLength(MAX_LOCAL_ASSETS)
    expect(assets.map((a) => a.name)).not.toContain('f0.png')
  })

  it('does not follow links out of an output folder or walk without end', async () => {
    write(path.join(outsideDir, 'secret.png'))
    fs.symlinkSync(outsideDir, path.join(sharedDir, 'escape'))
    const deep = path.join(
      sharedDir,
      ...Array.from({ length: MAX_FOLDER_DEPTH + 1 }, (_, i) => `d${i}`)
    )
    write(path.join(deep, 'too-deep.png'))

    expect(await listLocalAssets()).toEqual([])
  })
})

describe('outputFilePath', () => {
  it('finds a file inside an output folder and refuses folders and files outside', async () => {
    const inside = path.join(ownDir, 'nested', 'still.png')
    const outside = path.join(outsideDir, 'secret.png')
    write(inside)
    write(outside)

    expect(await outputFilePath(inside)).toBe(inside)
    expect(await outputFilePath(path.join(ownDir, 'nested'))).toBeNull()
    expect(await outputFilePath(outside)).toBeNull()
    expect(await outputFilePath(path.join(ownDir, '..', 'outside', 'secret.png'))).toBeNull()
    expect(await outputFilePath('still.png')).toBeNull()
  })
})

describe('serveOutputFile', () => {
  it('serves the file itself when the OS thumbnail is slow, then the thumbnail once it is made', async () => {
    write(path.join(sharedDir, 'slow.png'))
    await listOutputFolders()
    let finishThumbnail: (image: unknown) => void = () => {}
    thumbnailImage.mockReturnValueOnce(new Promise((resolve) => (finishThumbnail = resolve)))
    const url = outputFileUrl(path.join(sharedDir, 'slow.png'), 1)
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const startedAt = Date.now()
      const slow = await serveOutputFile(new Request(url))

      expect(
        Date.now() - startedAt,
        'it waits for the thumbnail before giving up'
      ).toBeGreaterThanOrEqual(THUMBNAIL_WAIT_MS - 50)
      expect(await slow.text()).toMatch(/^file file:\/\/.*slow\.png$/)

      finishThumbnail({
        isEmpty: () => false,
        getSize: () => ({ width: 100, height: 100 }),
        toJPEG: () => Buffer.from('late')
      })
      await vi.waitFor(async () => {
        const later = await serveOutputFile(new Request(url))
        expect(later.headers.get('Content-Type')).toBe('image/jpeg')
        expect(await later.text()).toBe('late')
      })
      expect(thumbnailImage, 'the slow thumbnail is made once, not again').toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(process, 'platform', { value: platform })
    }
  })

  it('serves a file inside an output folder and refuses one outside', async () => {
    write(path.join(sharedDir, 'picture.png'))
    write(path.join(outsideDir, 'secret.png'))
    await listOutputFolders()

    const ok = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'picture.png')))
    )
    expect(ok.status).toBe(200)
    expect(fetchFile).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/.*picture\.png$/))

    expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(ok.headers.get('Content-Security-Policy')).toBe('sandbox')

    const refused = await serveOutputFile(
      new Request(outputFileUrl(path.join(outsideDir, 'secret.png')))
    )
    expect(refused.status).toBe(404)
    expect(fetchFile).toHaveBeenCalledOnce()
  })

  it('answers 404 for files it does not show, broken addresses and files that are gone', async () => {
    write(path.join(sharedDir, 'page.html'))
    write(path.join(sharedDir, 'gone.png'))
    await listOutputFolders()

    const html = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'page.html')))
    )
    expect(html.status).toBe(404)
    const broken = await serveOutputFile(new Request('comfy-output://file/%'))
    expect(broken.status).toBe(404)
    fetchFile.mockRejectedValueOnce(new Error('ENOENT'))
    const gone = await serveOutputFile(new Request(outputFileUrl(path.join(sharedDir, 'gone.png'))))
    expect(gone.status).toBe(404)
  })

  it('serves a small JPEG thumbnail, or the file itself when none can be made', async () => {
    write(path.join(sharedDir, 'thumb.png'))
    await listOutputFolders()
    const resize = vi.fn(() => ({ toJPEG: () => Buffer.from('small') }))
    const big = { isEmpty: () => false, getSize: () => ({ width: 2000, height: 1000 }), resize }
    thumbnailImage.mockResolvedValueOnce(big)
    fullImage.mockReturnValueOnce(big)

    const thumb = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'thumb.png'), 1))
    )
    expect(thumb.headers.get('Content-Type')).toBe('image/jpeg')
    expect(await thumb.text()).toBe('small')
    expect(resize).toHaveBeenCalledWith({ width: 480, height: 240 })
    expect(thumb.headers.get('X-Content-Type-Options')).toBe('nosniff')

    write(path.join(sharedDir, 'blank.png'))
    const blank = {
      isEmpty: () => false,
      getSize: () => ({ width: 10, height: 10 }),
      toJPEG: () => Buffer.alloc(0)
    }
    thumbnailImage.mockResolvedValueOnce(blank)
    fullImage.mockReturnValueOnce(blank)
    const empty = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'blank.png'), 1))
    )
    expect(empty.headers.get('Content-Type')).not.toBe('image/jpeg')
    expect(await empty.text()).toMatch(/^file file:\/\/.*blank\.png$/)

    write(path.join(sharedDir, 'broken.png'))
    thumbnailImage.mockRejectedValueOnce(new Error('no thumbnail'))
    fullImage.mockReturnValueOnce({ isEmpty: () => true })
    const none = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'broken.png'), 1))
    )
    expect(await none.text()).toMatch(/^file file:\/\/.*broken\.png$/)
  })
})

describe('acting on a file from its card', () => {
  it('shows, copies and moves to the Trash only files inside an output folder', async () => {
    const inside = path.join(sharedDir, 'portrait.png')
    const outside = path.join(outsideDir, 'secret.png')
    write(inside)
    write(outside)
    fullImage.mockReturnValue({ isEmpty: () => false })

    expect(await revealOutputFile(outside), 'a file outside is not shown').toBe(false)
    expect(await copyOutputImage(outside), 'a file outside is not copied').toBe(false)
    expect(await trashOutputFile(outside), 'a file outside is not deleted').toBe(false)
    expect(fs.existsSync(outside)).toBe(true)
    expect(shownInFolder).not.toHaveBeenCalled()
    expect(copiedImage).not.toHaveBeenCalled()

    expect(await revealOutputFile(inside)).toBe(true)
    expect(shownInFolder).toHaveBeenCalledExactlyOnceWith(inside)
    expect(await copyOutputImage(inside)).toBe(true)
    expect(copiedImage).toHaveBeenCalledOnce()
    expect(await trashOutputFile(inside)).toBe(true)
    expect(fs.existsSync(inside), 'the picture left the output folder').toBe(false)
  })
})
