import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  root,
  sharedDir,
  sharedInputDir,
  ownDir,
  installDir,
  outsideDir,
  installs,
  fetchFile,
  thumbnailImage,
  fullImage,
  shownInFolder,
  trashed,
  copiedImage,
  openedFolder,
  runningSessions
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
    sharedInputDir: nodePath.join(base, 'shared-input'),
    ownDir: nodePath.join(base, 'own-output'),
    installDir: nodePath.join(base, 'install'),
    outsideDir: nodePath.join(base, 'outside'),
    installs: vi.fn(),
    fetchFile: vi.fn(async (url: string) => new Response(`file ${url}`)),
    thumbnailImage: vi.fn(),
    fullImage: vi.fn(),
    shownInFolder: vi.fn(),
    trashed: vi.fn(async (file: string) => nodeFs.rmSync(file)),
    copiedImage: vi.fn(),
    openedFolder: vi.fn(async (_folder: string) => ''),
    runningSessions: new Map<string, { launchFolders?: { output: string; input: string } }>()
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: {
    showItemInFolder: (file: string) => shownInFolder(file),
    trashItem: (file: string) => trashed(file),
    openPath: (folder: string) => openedFolder(folder)
  },
  clipboard: { write: async (items: unknown[]) => copiedImage(items) },
  ClipboardItem: class {
    readonly types: string[]
    constructor(readonly items: Record<string, unknown>) {
      this.types = Object.keys(items)
    }
  },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: { fetch: (url: string) => fetchFile(url) },
  nativeImage: {
    createThumbnailFromPath: (file: string) => thumbnailImage(file),
    createFromPath: (file: string) => fullImage(file),
    createFromBuffer: (bytes: Buffer) => fullImage(bytes)
  }
}))
vi.mock('../installations', () => ({ list: () => installs() }))
vi.mock('../settings', () => ({
  get: (key: string) =>
    ({ outputDir: sharedDir, inputDir: sharedInputDir })[key as 'outputDir' | 'inputDir'],
  defaults: {
    outputDir: path.join(root, 'default-output'),
    inputDir: path.join(root, 'default-input')
  }
}))
vi.mock('./ipc/shared', () => ({
  _runningSessions: runningSessions,
  sourceMap: {
    standalone: { category: 'local' },
    desktop: { category: 'local', managesOwnPaths: true },
    cloud: { category: 'cloud' }
  }
}))
vi.mock('./models', () => ({
  installOutputDir: (installPath: string) => path.join(installPath, 'ComfyUI', 'output'),
  installInputDir: (installPath: string) => path.join(installPath, 'ComfyUI', 'input')
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
  comfyFoldersOf,
  comfyOutputPath,
  copyOutputImage,
  hasOutputFolder,
  launchFoldersOf,
  revealOutputFile,
  trashOutputFile,
  listLocalAssets,
  localPageRequest,
  listOutputFolders,
  outputFolderPaths,
  openOutputFolder,
  outputDirOverride,
  outputFilePath,
  outputFileUrl,
  serveOutputFile,
  thumbnailDataUrl,
  thumbnailDataUrlFromBytes
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
  runningSessions.clear()
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

describe('hasOutputFolder', () => {
  it('is true only for a local build that leaves its paths to Desktop', () => {
    expect(hasOutputFolder(install('a')), 'a build on the shared folder').toBe(true)
    expect(
      hasOutputFolder(install('a', { useSharedOutput: false })),
      'a build that saves inside its install'
    ).toBe(true)
    expect(hasOutputFolder(install('a', { sourceId: 'cloud' })), 'Cloud').toBe(false)
    expect(
      hasOutputFolder(install('a', { sourceId: 'desktop' })),
      'a build that manages its own paths'
    ).toBe(false)
    expect(hasOutputFolder(install('a', { sourceId: 'gone' })), 'an unknown source').toBe(false)
  })
})

describe('comfyFoldersOf', () => {
  it("gives a build's output and input folders, the shared ones by default", () => {
    expect(comfyFoldersOf(install('a'))).toEqual({ output: sharedDir, input: sharedInputDir })
    expect(
      comfyFoldersOf(
        install('a', {
          useSharedOutput: false,
          outputDir: ownDir,
          useSharedInput: false,
          inputDir: path.join(root, 'own-input')
        })
      )
    ).toEqual({ output: ownDir, input: path.join(root, 'own-input') })
    expect(
      comfyFoldersOf(install('a', { useSharedOutput: false, useSharedInput: false })),
      'a build that keeps both inside its install'
    ).toEqual({
      output: path.join(installDir, 'ComfyUI', 'output'),
      input: path.join(installDir, 'ComfyUI', 'input')
    })
  })

  it('gives the shared folders when no build is known, and none for Cloud', () => {
    expect(comfyFoldersOf(null)).toEqual({ output: sharedDir, input: sharedInputDir })
    expect(comfyFoldersOf(install('a', { sourceId: 'cloud' }))).toEqual({
      output: null,
      input: null
    })
    expect(comfyFoldersOf(install('a', { sourceId: 'desktop' }))).toEqual({
      output: null,
      input: null
    })
  })
})

describe('comfyFoldersOf a running build', () => {
  it('gives the folders it was launched with, not the ones the settings name now', () => {
    const launchedOutput = path.join(root, 'output-at-launch')
    const launchedInput = path.join(root, 'input-at-launch')
    runningSessions.set('a', { launchFolders: { output: launchedOutput, input: launchedInput } })

    expect(comfyFoldersOf(install('a'))).toEqual({ output: launchedOutput, input: launchedInput })
    expect(comfyFoldersOf(install('b')), 'a build that is not running').toEqual({
      output: sharedDir,
      input: sharedInputDir
    })
  })

  it('gives no folders when the launch folders are not known', () => {
    runningSessions.set('a', {})

    expect(comfyFoldersOf(install('a'))).toEqual({ output: null, input: null })
  })
})

describe('launchFoldersOf', () => {
  it('reads the folders from the arguments ComfyUI was started with', () => {
    const args = ['main.py', '--input-directory', '/old-input', '--output-directory', '/old-output']

    expect(launchFoldersOf(install('a'), { args })).toEqual({
      output: '/old-output',
      input: '/old-input'
    })
  })

  it('takes the last of a repeated flag, written either way, as ComfyUI does', () => {
    const args = ['--input-directory', '/first', '--input-directory=/second']

    expect(launchFoldersOf(install('a'), { args }).input).toBe('/second')
  })

  it("falls back to ComfyUI's own folders when no folder was passed", () => {
    expect(launchFoldersOf(install('a'), { args: ['main.py'] })).toEqual({
      output: path.join(installDir, 'ComfyUI', 'output'),
      input: path.join(installDir, 'ComfyUI', 'input')
    })
  })

  it('gives no folders when Desktop could not pass them', () => {
    const none = { output: null, input: null }
    const args = ['--input-directory', '/in']

    expect(launchFoldersOf(install('a'), { args, skipSharedPaths: true })).toEqual(none)
    expect(launchFoldersOf(install('a'), {})).toEqual(none)
    expect(launchFoldersOf(install('a', { sourceId: 'desktop' }), { args })).toEqual(none)
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

describe('outputFolderPaths and openOutputFolder', () => {
  it('names the shared folder and each build folder, and opens only those', async () => {
    installs.mockResolvedValue([
      { id: 'Test Instance', sourceId: 'standalone', useSharedOutput: false, outputDir: ownDir }
    ])

    const folders = await outputFolderPaths()

    expect(folders.shared).toBe(sharedDir)
    expect(folders.ofBuild).toEqual({ 'Test Instance': ownDir })
    expect(await openOutputFolder()).toBe(true)
    expect(await openOutputFolder('Test Instance')).toBe(true)
    expect(await openOutputFolder('unknown'), 'an unknown build opens nothing').toBe(false)
    expect(openedFolder.mock.calls).toEqual([[sharedDir], [ownDir]])
  })
})

describe('listLocalAssets', () => {
  it("lists the media in the picked build's output folder and its subfolders, newest first", async () => {
    write(path.join(sharedDir, 'old.png'), 'x', new Date('2026-10-01T00:00:00Z'))
    write(path.join(sharedDir, 'video', 'new.mp4'), 'xx', new Date('2026-11-05T00:00:00Z'))
    write(path.join(sharedDir, 'mesh.glb'), 'x', new Date('2026-11-02T00:00:00Z'))
    write(path.join(ownDir, 'voice.wav'), 'xxx', new Date('2026-11-03T00:00:00Z'))
    write(path.join(sharedDir, 'notes.txt'))
    write(path.join(sharedDir, '.hidden.png'))
    write(path.join(sharedDir, '.cache', 'inside-hidden.png'))

    const { assets, total, counts } = await listLocalAssets('Test Instance')

    expect(assets.map((a) => a.name)).toEqual(['new.mp4', 'mesh.glb', 'old.png'])
    expect(total).toBe(3)
    expect(counts).toEqual({ all: 3, image: 1, video: 1, audio: 0, '3d': 1 })
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
    expect(assets[2]!.thumbnailUrl, 'an image thumbnail link changes when the file does').toBe(
      outputFileUrl(oldPicture, fs.statSync(oldPicture).mtimeMs)
    )
    expect(assets[1]!.previewUrl, '3D files have no preview').toBeNull()
  })

  it('reports the size of each picture and video, and how long a video runs, before they load', async () => {
    write(path.join(sharedDir, 'portrait.png'), pngHeader(640, 960))
    write(path.join(sharedDir, 'clip.webm'), fs.readFileSync(SAMPLE_VIDEO))
    write(path.join(sharedDir, 'broken.png'), 'not a picture')

    const facts = Object.fromEntries(
      (await listLocalAssets('Test Instance')).assets.map((a) => [
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

  it('shows each build the files in its own output folder', async () => {
    write(path.join(sharedDir, 'shared.png'))
    write(path.join(ownDir, 'own.png'))
    write(path.join(installDir, 'ComfyUI', 'output', 'install.png'))
    const namesFor = async (id: string) => (await listLocalAssets(id)).assets.map((a) => a.name)

    expect(await namesFor('Test Instance'), 'a build on the shared folder').toEqual(['shared.png'])
    expect(await namesFor('My Local 1'), 'another build on the shared folder').toEqual([
      'shared.png'
    ])
    expect(await namesFor('Apps'), 'a build with its own folder').toEqual(['own.png'])
    expect(await namesFor('Bare'), 'a build that saves inside its install').toEqual(['install.png'])
    expect(await namesFor('Cloud'), 'Cloud has no folder on this computer').toEqual([])
    expect(await namesFor('Old Desktop'), 'a build that manages its own paths').toEqual([])
    expect(await namesFor('deleted'), 'a build that is gone').toEqual([])
    expect(
      (await listLocalAssets()).assets.map((a) => a.name),
      'no build: the shared output folder'
    ).toEqual(['shared.png'])
  })

  it('opens a file it listed for a build added a moment ago', async () => {
    await listOutputFolders()
    const newDir = path.join(root, 'new-output')
    const file = path.join(newDir, 'first.png')
    write(file)
    installs.mockResolvedValue([install('New', { useSharedOutput: false, outputDir: newDir })])
    try {
      const [listed] = (await listLocalAssets('New')).assets

      expect(listed!.id).toBe(file)
      expect(await outputFilePath(listed!.id)).toBe(file)
    } finally {
      fs.rmSync(newDir, { recursive: true, force: true })
    }
  })

  it('reads a very large folder one page at a time and counts every file', async () => {
    for (let i = 0; i <= MAX_LOCAL_ASSETS; i++)
      write(path.join(sharedDir, `f${i}.png`), '', new Date(Date.UTC(2026, 0, 1, 0, 0, i)))

    const first = await listLocalAssets('Test Instance')
    const last = await listLocalAssets('Test Instance', {
      offset: MAX_LOCAL_ASSETS,
      limit: MAX_LOCAL_ASSETS,
      order: 'newest'
    })

    expect(first.assets).toHaveLength(MAX_LOCAL_ASSETS)
    expect(first.assets.map((a) => a.name)).not.toContain('f0.png')
    expect(first.total).toBe(MAX_LOCAL_ASSETS + 1)
    expect(last.assets.map((a) => a.name)).toEqual(['f0.png'])
  })

  it('pages oldest first and keeps only the asked kind, still counting every kind', async () => {
    write(path.join(sharedDir, 'a.png'), 'x', new Date('2026-10-01T00:00:00Z'))
    write(path.join(sharedDir, 'b.mp4'), 'x', new Date('2026-10-02T00:00:00Z'))
    write(path.join(sharedDir, 'c.png'), 'x', new Date('2026-10-03T00:00:00Z'))
    write(path.join(sharedDir, 'd.png'), 'x', new Date('2026-10-04T00:00:00Z'))

    const page = await listLocalAssets(undefined, {
      offset: 1,
      limit: 1,
      order: 'oldest',
      kind: 'image'
    })

    expect(page.assets.map((a) => a.name)).toEqual(['c.png'])
    expect(page.total).toBe(3)
    expect(page.counts).toEqual({ all: 4, image: 3, video: 1, audio: 0, '3d': 0 })
  })

  it('reads the first page for a page request it does not understand', () => {
    const first = { offset: 0, limit: MAX_LOCAL_ASSETS, order: 'newest' }
    expect(localPageRequest(undefined)).toEqual(first)
    expect(localPageRequest({ offset: -1, limit: 10, order: 'newest' })).toEqual(first)
    expect(localPageRequest({ offset: 0, limit: MAX_LOCAL_ASSETS + 1, order: 'newest' })).toEqual(
      first
    )
    expect(localPageRequest({ offset: 0, limit: 10, order: 'newest', kind: 'pdf' })).toEqual(first)
    expect(localPageRequest({ offset: 20, limit: 10, order: 'oldest', kind: '3d' })).toEqual({
      offset: 20,
      limit: 10,
      order: 'oldest',
      kind: '3d'
    })
  })

  it('keeps a new nested output when the shared folder has 5,000 older files', async () => {
    for (let i = 0; i < 5_000; i++) write(path.join(sharedDir, `f${i}.glb`))
    write(
      path.join(sharedDir, 'later', 'newest.png'),
      pngHeader(512, 512),
      new Date('2026-11-02T00:00:00Z')
    )

    const { assets, total } = await listLocalAssets()

    expect(assets[0]?.name).toBe('newest.png')
    expect(assets).toHaveLength(MAX_LOCAL_ASSETS)
    expect(total).toBe(5_001)
  })

  it('does not follow links to folders or files outside, or walk without end', async () => {
    write(path.join(outsideDir, 'secret.png'))
    fs.symlinkSync(outsideDir, path.join(sharedDir, 'escape'))
    const deep = path.join(
      sharedDir,
      ...Array.from({ length: MAX_FOLDER_DEPTH + 1 }, (_, i) => `d${i}`)
    )
    write(path.join(deep, 'too-deep.png'))
    fs.symlinkSync(path.join(outsideDir, 'secret.png'), path.join(sharedDir, 'linked.png'))

    expect(await listLocalAssets('Test Instance')).toMatchObject({ assets: [], total: 0 })
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

describe('comfyOutputPath', () => {
  const CUTOUT = Buffer.from('cutout bytes')
  const appsBuild = (): InstallationRecord =>
    install('Apps', { useSharedOutput: false, outputDir: ownDir })
  const cutout = { filename: 'cutout_00001_.png', subfolder: 'apps/remove-background' }

  it("finds the file ComfyUI named in the build's own output folder, or in the shared one", async () => {
    const own = path.join(ownDir, 'apps', 'remove-background', 'cutout_00001_.png')
    const shared = path.join(sharedDir, 'cutout_00001_.png')
    write(own, CUTOUT)
    write(shared, CUTOUT)

    expect(await comfyOutputPath(appsBuild(), cutout, new Uint8Array(CUTOUT))).toBe(own)
    expect(
      await comfyOutputPath(
        install('Test Instance'),
        { filename: 'cutout_00001_.png', subfolder: '' },
        new Uint8Array(CUTOUT)
      )
    ).toBe(shared)
  })

  it('finds nothing for a missing file, or a file without exactly the bytes the page shows', async () => {
    write(path.join(ownDir, 'apps', 'remove-background', 'cutout_00001_.png'), CUTOUT)

    expect(
      await comfyOutputPath(
        appsBuild(),
        { ...cutout, filename: 'gone.png' },
        new Uint8Array(CUTOUT)
      )
    ).toBeNull()
    expect(
      await comfyOutputPath(appsBuild(), cutout, new Uint8Array(Buffer.from('cutout bytez'))),
      'same size, other bytes'
    ).toBeNull()
    expect(
      await comfyOutputPath(appsBuild(), cutout, new Uint8Array(Buffer.from('cutout'))),
      'other size'
    ).toBeNull()
  })

  it("refuses links out of the build's output folder, even into another build's", async () => {
    write(path.join(outsideDir, 'secret.png'), CUTOUT)
    write(path.join(sharedDir, 'shared.png'), CUTOUT)
    fs.symlinkSync(path.join(outsideDir, 'secret.png'), path.join(ownDir, 'secret.png'))
    fs.symlinkSync(path.join(sharedDir, 'shared.png'), path.join(ownDir, 'shared.png'))
    const bytes = new Uint8Array(CUTOUT)

    expect(
      await comfyOutputPath(appsBuild(), { filename: 'secret.png', subfolder: '' }, bytes)
    ).toBeNull()
    expect(
      await comfyOutputPath(appsBuild(), { filename: 'shared.png', subfolder: '' }, bytes)
    ).toBeNull()
    expect(
      await comfyOutputPath(
        appsBuild(),
        { filename: 'shared.png', subfolder: '../shared-output' },
        bytes
      )
    ).toBeNull()
  })

  it("refuses a subfolder that climbs out of the build's output folder, and an absolute filename", async () => {
    const secret = path.join(outsideDir, 'secret.png')
    write(secret, CUTOUT)
    const bytes = new Uint8Array(CUTOUT)

    expect(
      await comfyOutputPath(appsBuild(), { filename: 'secret.png', subfolder: '../outside' }, bytes)
    ).toBeNull()
    expect(
      await comfyOutputPath(
        appsBuild(),
        { filename: 'secret.png', subfolder: 'apps/../../outside' },
        bytes
      )
    ).toBeNull()
    expect(
      await comfyOutputPath(appsBuild(), { filename: secret, subfolder: '' }, bytes)
    ).toBeNull()
    expect(
      await comfyOutputPath(appsBuild(), { filename: '/etc/passwd', subfolder: '' }, bytes)
    ).toBeNull()
  })

  it('finds nothing for Cloud or a build that manages its own paths', async () => {
    write(path.join(sharedDir, 'cutout_00001_.png'), CUTOUT)
    const file = { filename: 'cutout_00001_.png', subfolder: '' }

    expect(
      await comfyOutputPath(install('Cloud', { sourceId: 'cloud' }), file, new Uint8Array(CUTOUT))
    ).toBeNull()
    expect(
      await comfyOutputPath(install('Old', { sourceId: 'desktop' }), file, new Uint8Array(CUTOUT))
    ).toBeNull()
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

describe('small thumbnails as data URLs', () => {
  it('scales the long side to the size asked for', async () => {
    write(path.join(sharedDir, 'small.png'))
    const resize = vi.fn(() => ({ toJPEG: () => Buffer.from('tiny') }))
    const big = { isEmpty: () => false, getSize: () => ({ width: 1000, height: 2000 }), resize }
    thumbnailImage.mockResolvedValueOnce(big)
    fullImage.mockReturnValueOnce(big)

    expect(await thumbnailDataUrl(path.join(sharedDir, 'small.png'), 256)).toBe(
      `data:image/jpeg;base64,${Buffer.from('tiny').toString('base64')}`
    )
    expect(resize).toHaveBeenCalledWith({ width: 128, height: 256 })
  })

  it('makes one from bytes, or none when they are not a picture', () => {
    const resize = vi.fn(() => ({ toJPEG: () => Buffer.from('cloud') }))
    fullImage.mockReturnValueOnce({
      isEmpty: () => false,
      getSize: () => ({ width: 512, height: 512 }),
      resize
    })
    expect(thumbnailDataUrlFromBytes(new Uint8Array([1, 2]), 256)).toBe(
      `data:image/jpeg;base64,${Buffer.from('cloud').toString('base64')}`
    )
    expect(resize).toHaveBeenCalledWith({ width: 256, height: 256 })

    fullImage.mockReturnValueOnce({ isEmpty: () => true })
    expect(thumbnailDataUrlFromBytes(new Uint8Array([1]), 256)).toBeNull()
  })
})

describe('acting on a file from its card', () => {
  it('shows, copies and moves to the Trash only files inside an output folder', async () => {
    const inside = path.join(sharedDir, 'portrait.png')
    const outside = path.join(outsideDir, 'secret.png')
    write(inside)
    write(outside)
    fullImage.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from('png bytes') })

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
    const [copiedItem] = copiedImage.mock.calls[0]?.[0] as {
      types: string[]
      items: Record<string, Blob>
    }[]
    expect(copiedItem?.types, 'the picture is copied as a PNG').toEqual(['image/png'])
    expect(await copiedItem?.items['image/png']?.text()).toBe('png bytes')
    expect(await trashOutputFile(inside)).toBe(true)
    expect(fs.existsSync(inside), 'the picture left the output folder').toBe(false)
  })
})
