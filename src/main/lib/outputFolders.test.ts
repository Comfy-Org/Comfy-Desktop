import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  root,
  sharedDir,
  ownDir,
  installDir,
  outsideDir,
  installs,
  fetchFile,
  thumbnailImage,
  fullImage
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
    fullImage: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
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
    ({ png: 'image', mp4: 'video', wav: 'audio', glb: '3d' })[name.split('.').pop() ?? ''] ?? null
}))

import type { InstallationRecord } from '../installations'
import {
  MAX_FILES,
  comfyOutputPath,
  listOutputFolder,
  outputLocator,
  listOutputFolders,
  outputDirOverride,
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

function write(file: string, body = 'x', modified = new Date('2026-11-01T00:00:00Z')): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  fs.utimesSync(file, modified, modified)
}

beforeEach(() => {
  vi.clearAllMocks()
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

afterEach(() => {
  for (const link of ['escape', 'shared', 'shared.png'])
    fs.rmSync(path.join(ownDir, link), { force: true })
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
  it('lists each output folder once with the local builds that save there', async () => {
    expect(await listOutputFolders()).toEqual([
      { path: sharedDir, shared: true, builds: ['Test Instance', 'My Local 1'] },
      { path: ownDir, shared: false, builds: ['Apps'] },
      { path: path.join(installDir, 'ComfyUI', 'output'), shared: false, builds: ['Bare'] }
    ])
  })

  it('leaves out folders that do not exist yet', async () => {
    installs.mockResolvedValue([
      install('Gone', { useSharedOutput: false, outputDir: path.join(root, 'missing') })
    ])
    expect(await listOutputFolders()).toEqual([{ path: sharedDir, shared: true, builds: [] }])
  })
})

describe('listOutputFolder', () => {
  it('lists folders and media files newest first, with links that change when a file does', async () => {
    write(path.join(sharedDir, 'old.png'), 'x', new Date('2026-10-01T00:00:00Z'))
    write(path.join(sharedDir, 'new.mp4'), 'xx', new Date('2026-11-05T00:00:00Z'))
    write(path.join(sharedDir, 'notes.txt'))
    write(path.join(sharedDir, '.hidden.png'))
    fs.mkdirSync(path.join(sharedDir, 'apps'), { recursive: true })
    await listOutputFolders()

    const listing = await listOutputFolder(sharedDir)

    expect(listing!.truncated).toBe(false)
    expect(listing!.entries.map((e) => e.name)).not.toContain('.hidden.png')
    const byName = Object.fromEntries(listing!.entries.map((e) => [e.name, e]))
    expect(byName['apps']).toMatchObject({
      isFolder: true,
      kind: null,
      sizeBytes: null,
      previewUrl: null
    })
    expect(byName['new.mp4']).toMatchObject({
      isFolder: false,
      kind: 'video',
      sizeBytes: 2,
      previewUrl: outputFileUrl(path.join(sharedDir, 'new.mp4')),
      thumbnailUrl: outputFileUrl(
        path.join(sharedDir, 'new.mp4'),
        fs.statSync(path.join(sharedDir, 'new.mp4')).mtimeMs
      )
    })
    expect(byName['notes.txt']).toBeUndefined()
    const files = listing!.entries.filter((e) => !e.isFolder).map((e) => e.name)
    expect(files.indexOf('new.mp4')).toBeLessThan(files.indexOf('old.png'))
  })

  it('keeps every subfolder and only the newest files when a folder is very large', async () => {
    const big = path.join(sharedDir, 'big')
    fs.mkdirSync(path.join(big, 'old-folder'), { recursive: true })
    fs.utimesSync(path.join(big, 'old-folder'), new Date('2020-01-01'), new Date('2020-01-01'))
    for (let i = 0; i <= MAX_FILES; i++) fs.writeFileSync(path.join(big, `f${i}.png`), '')
    await listOutputFolders()

    const listing = await listOutputFolder(big)

    expect(listing!.truncated).toBe(true)
    expect(listing!.entries.filter((e) => e.isFolder).map((e) => e.name)).toEqual(['old-folder'])
    expect(listing!.entries.filter((e) => !e.isFolder)).toHaveLength(MAX_FILES)
    fs.rmSync(big, { recursive: true })
  })

  it('refuses folders outside the output folders, and links that climb out of them', async () => {
    write(path.join(outsideDir, 'secret.png'))
    fs.symlinkSync(outsideDir, path.join(sharedDir, 'escape'))
    await listOutputFolders()

    expect(await listOutputFolder(outsideDir)).toBeNull()
    expect(await listOutputFolder(path.join(sharedDir, '..', 'outside'))).toBeNull()
    expect(await listOutputFolder(path.join(sharedDir, 'escape'))).toBeNull()
    expect(await listOutputFolder('relative/path')).toBeNull()
    expect(await listOutputFolder(42)).toBeNull()
    fs.rmSync(path.join(sharedDir, 'escape'))
  })
})

describe('comfyOutputPath', () => {
  const apps = install('Apps', { useSharedOutput: false, outputDir: ownDir })

  it("finds a ComfyUI output in the build's own output folder", async () => {
    write(path.join(ownDir, 'apps', 'ComfyUI_00001_.png'), 'four')

    expect(
      await comfyOutputPath(apps, { filename: 'ComfyUI_00001_.png', subfolder: 'apps' }, 4)
    ).toBe(path.join(ownDir, 'apps', 'ComfyUI_00001_.png'))
  })

  it('finds an output of a build that saves to the shared folder', async () => {
    write(path.join(sharedDir, 'ComfyUI_00002_.png'), 'shared')

    expect(
      await comfyOutputPath(
        install('Test Instance'),
        { filename: 'ComfyUI_00002_.png', subfolder: '' },
        6
      )
    ).toBe(path.join(sharedDir, 'ComfyUI_00002_.png'))
  })

  it('refuses a file that is gone or does not match the bytes the page shows', async () => {
    write(path.join(ownDir, 'ComfyUI_00003_.png'), 'four')

    expect(await comfyOutputPath(apps, { filename: 'ComfyUI_00003_.png', subfolder: '' }, 5)).toBe(
      null
    )
    expect(await comfyOutputPath(apps, { filename: 'missing.png', subfolder: '' }, 4)).toBeNull()
  })

  it("refuses paths that leave the build's output folder", async () => {
    write(path.join(outsideDir, 'secret.png'), 'four')
    write(path.join(sharedDir, 'other-build.png'), 'four')
    fs.symlinkSync(outsideDir, path.join(ownDir, 'escape'))
    fs.symlinkSync(sharedDir, path.join(ownDir, 'shared'))

    const file = (subfolder: string, filename: string) =>
      comfyOutputPath(apps, { filename, subfolder }, 4)
    expect(await file('escape', 'secret.png')).toBeNull()
    expect(await file('shared', 'other-build.png')).toBeNull()
    expect(await file('../outside', 'secret.png')).toBeNull()
    expect(await file('', '../outside/secret.png')).toBeNull()
  })

  it('refuses builds whose output folder Desktop does not manage', async () => {
    write(path.join(sharedDir, 'ComfyUI_00004_.png'), 'four')
    const file = { filename: 'ComfyUI_00004_.png', subfolder: '' }

    expect(await comfyOutputPath(install('Cloud', { sourceId: 'cloud' }), file, 4)).toBeNull()
    expect(await comfyOutputPath(install('Old', { sourceId: 'desktop' }), file, 4)).toBeNull()
  })
})

describe('outputLocator', () => {
  const apps = install('Apps', { useSharedOutput: false, outputDir: ownDir })
  const bytesOf = (text: string) => new TextEncoder().encode(text)

  it("finds the file in the build's output folder with exactly the same bytes", async () => {
    write(path.join(ownDir, 'apps', 'sdr-to-hdr', 'hdr_00001.png'), 'other picture')
    write(path.join(ownDir, 'apps', 'sdr-to-hdr', 'hdr_00002.png'), 'same picture!')
    write(path.join(ownDir, 'apps', 'sdr-to-hdr', 'hdr_00003.png'), 'third picture')
    const locate = outputLocator(apps)
    const sameBytes = (bytes: Uint8Array) => locate(null, bytes)

    expect(await sameBytes(bytesOf('same picture!'))).toBe(
      path.join(ownDir, 'apps', 'sdr-to-hdr', 'hdr_00002.png')
    )
    expect(await sameBytes(bytesOf('third picture'))).toBe(
      path.join(ownDir, 'apps', 'sdr-to-hdr', 'hdr_00003.png')
    )
  })

  it('finds nothing when no file has those bytes, or there are no bytes', async () => {
    write(path.join(ownDir, 'kept.png'), 'kept')

    const locate = outputLocator(apps)
    const sameBytes = (bytes: Uint8Array) => locate(null, bytes)
    expect(await sameBytes(bytesOf('gone'))).toBeNull()
    expect(await sameBytes(new Uint8Array())).toBeNull()
  })

  it('looks by bytes when the reference does not lead to the file', async () => {
    write(path.join(ownDir, 'apps', 'renamed.png'), 'moved bytes')

    expect(
      await outputLocator(apps)(
        { filename: 'old-name.png', subfolder: 'apps' },
        new TextEncoder().encode('moved bytes')
      )
    ).toBe(path.join(ownDir, 'apps', 'renamed.png'))
  })

  it("does not follow links out of the build's output folder", async () => {
    write(path.join(outsideDir, 'secret.png'), 'secret bytes')
    write(path.join(sharedDir, 'shared.png'), 'shared bytes')
    fs.symlinkSync(outsideDir, path.join(ownDir, 'escape'))
    fs.symlinkSync(path.join(sharedDir, 'shared.png'), path.join(ownDir, 'shared.png'))

    const locate = outputLocator(apps)
    const sameBytes = (bytes: Uint8Array) => locate(null, bytes)
    expect(await sameBytes(bytesOf('secret bytes'))).toBeNull()
    expect(await sameBytes(bytesOf('shared bytes'))).toBeNull()
  })
})

describe('serveOutputFile', () => {
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

  it('serves a small JPEG thumbnail and answers 404 when none can be made', async () => {
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
    expect(empty.status).toBe(404)

    write(path.join(sharedDir, 'broken.png'))
    thumbnailImage.mockRejectedValueOnce(new Error('no thumbnail'))
    fullImage.mockReturnValueOnce({ isEmpty: () => true })
    const none = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'broken.png'), 1))
    )
    expect(none.status).toBe(404)
  })
})
