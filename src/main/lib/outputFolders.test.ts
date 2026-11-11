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
  listOutputFolder,
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

    const refused = await serveOutputFile(
      new Request(outputFileUrl(path.join(outsideDir, 'secret.png')))
    )
    expect(refused.status).toBe(404)
    expect(fetchFile).toHaveBeenCalledOnce()
  })

  it('serves a small JPEG thumbnail and answers 404 when none can be made', async () => {
    write(path.join(sharedDir, 'thumb.png'))
    await listOutputFolders()
    const resize = vi.fn(() => ({ toJPEG: () => Buffer.from('small') }))
    const big = { isEmpty: () => false, getSize: () => ({ width: 2000 }), resize }
    thumbnailImage.mockResolvedValueOnce(big)
    fullImage.mockReturnValueOnce(big)

    const thumb = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'thumb.png'), 1))
    )
    expect(thumb.headers.get('Content-Type')).toBe('image/jpeg')
    expect(await thumb.text()).toBe('small')
    expect(resize).toHaveBeenCalledWith({ width: 480 })

    write(path.join(sharedDir, 'broken.png'))
    thumbnailImage.mockRejectedValueOnce(new Error('no thumbnail'))
    fullImage.mockReturnValueOnce({ isEmpty: () => true })
    const none = await serveOutputFile(
      new Request(outputFileUrl(path.join(sharedDir, 'broken.png'), 1))
    )
    expect(none.status).toBe(404)
  })
})
