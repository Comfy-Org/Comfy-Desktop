import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import * as settings from '../settings'
import { ALLOWED_EXTENSIONS } from './downloadFilename'
import { areModelsPresent, buildExistenceCandidates } from './modelDownloadPaths'
import type * as ComfyDownloadManager from './comfyDownloadManager'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return os.homedir()
      return path.join(os.tmpdir(), 'comfyui-desktop-2-test')
    },
  },
  BrowserWindow: Object.assign(class {}, { getAllWindows: () => [] }),
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: {},
}))

let hasValidExtension: (filename: string) => boolean
let isPathContained: (filePath: string, baseDir: string) => boolean
let sanitizeAssetFilename: (filename: string, outputDir: string) => string | null
let resolveAssetSavePath: (
  currentSavePath: string,
  serverName: string,
  outputDir: string,
) => string | null
let parseContentDispositionFilename: (header: string | null) => string | null
let buildSaveDialogFilters: (suggestedName: string) => Electron.FileFilter[]
let mod: typeof ComfyDownloadManager

beforeAll(async () => {
  mod = await import('./comfyDownloadManager')
  hasValidExtension = mod.hasValidExtension
  isPathContained = mod.isPathContained
  sanitizeAssetFilename = mod.sanitizeAssetFilename
  resolveAssetSavePath = mod.resolveAssetSavePath
  parseContentDispositionFilename = mod.parseContentDispositionFilename
  buildSaveDialogFilters = mod.buildSaveDialogFilters
})

describe('buildExistenceCandidates', () => {
  it('uses only the destination when there is no install context', () => {
    const candidates = buildExistenceCandidates(null, '/shared', 'loras', 'x.safetensors')
    expect(candidates).toEqual([path.join('/shared', 'loras', 'x.safetensors')])
  })

  it('probes every model root for the folder type', () => {
    const ctx = {
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models', '/external'],
      extraPaths: [],
    }
    const candidates = buildExistenceCandidates(ctx, '/install/models', 'loras', 'x.safetensors')
    expect(candidates).toContain(path.join('/install/models', 'loras', 'x.safetensors'))
    expect(candidates).toContain(path.join('/external', 'loras', 'x.safetensors'))
    // The global shared dir is NOT a root here, so it must not be probed.
    expect(candidates).not.toContain(path.join('/shared', 'loras', 'x.safetensors'))
  })

  it('probes arbitrarily-mapped extra_model_paths dirs for the type', () => {
    const ctx = {
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models'],
      extraPaths: [
        { section: 's', basePath: null, type: 'loras', rawType: 'loras', dir: '/custom/somedir/myname', isDefault: false },
        { section: 's', basePath: null, type: 'checkpoints', rawType: 'checkpoints', dir: '/custom/cp', isDefault: false },
      ],
    }
    const candidates = buildExistenceCandidates(ctx, '/install/models', 'loras', 'x.safetensors')
    expect(candidates).toContain(path.join('/custom/somedir/myname', 'x.safetensors'))
    // checkpoints mapping must not be probed for a loras download.
    expect(candidates).not.toContain(path.join('/custom/cp', 'x.safetensors'))
  })

  it('probes a model root for both controlnet/ and its t2i_adapter/ alternate', () => {
    const ctx = {
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models'],
      extraPaths: [],
    }
    const candidates = buildExistenceCandidates(ctx, '/install/models', 'controlnet', 'x.safetensors')
    // ComfyUI's controlnet defaults also search <root>/t2i_adapter, and the
    // launcher YAML registers it under controlnet, so both must be probed.
    expect(candidates).toContain(path.join('/install/models', 'controlnet', 'x.safetensors'))
    expect(candidates).toContain(path.join('/install/models', 't2i_adapter', 'x.safetensors'))
  })

  it('matches legacy folder aliases (clip → text_encoders)', () => {
    const ctx = {
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models'],
      extraPaths: [
        { section: 's', basePath: null, type: 'text_encoders', rawType: 'clip', dir: '/custom/clip', isDefault: false },
      ],
    }
    const candidates = buildExistenceCandidates(ctx, '/install/models', 'clip', 'x.safetensors')
    expect(candidates).toContain(path.join('/custom/clip', 'x.safetensors'))
  })

  it('appends a nested directory remainder when probing extra dirs', () => {
    const ctx = {
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models'],
      extraPaths: [
        { section: 's', basePath: null, type: 'loras', rawType: 'loras', dir: '/custom/loras', isDefault: false },
      ],
    }
    const candidates = buildExistenceCandidates(ctx, '/install/models', 'loras/sub', 'x.safetensors')
    expect(candidates).toContain(path.join('/custom/loras', 'sub', 'x.safetensors'))
  })
})

describe('ALLOWED_EXTENSIONS', () => {
  const requiredExtensions = ['.safetensors', '.sft', '.ckpt', '.pth', '.pt']

  it.each(requiredExtensions)('includes %s', (ext) => {
    expect(ALLOWED_EXTENSIONS).toContain(ext)
  })
})

describe('hasValidExtension', () => {
  it.each([
    'model.safetensors',
    'model.sft',
    'model.ckpt',
    'model.pth',
    'model.pt',
  ])('returns true for %s', (filename) => {
    expect(hasValidExtension(filename)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(hasValidExtension('model.SafeTensors')).toBe(true)
  })

  it('returns false for disallowed extensions', () => {
    expect(hasValidExtension('script.py')).toBe(false)
    expect(hasValidExtension('archive.zip')).toBe(false)
  })
})

describe('isPathContained', () => {
  it('returns true when file is inside base directory', () => {
    expect(isPathContained('/models/stable-diffusion/model.sft', '/models')).toBe(true)
  })

  it('returns true when file is inside a filesystem root', () => {
    const root = path.parse(path.resolve('/output')).root
    expect(isPathContained(path.join(root, 'output', 'image.png'), root)).toBe(true)
  })

  it('returns false when file is outside base directory', () => {
    expect(isPathContained('/other/model.sft', '/models')).toBe(false)
  })

  it('returns false for the base directory itself and sibling prefixes', () => {
    expect(isPathContained('/models', '/models')).toBe(false)
    expect(isPathContained('/models-other/model.sft', '/models')).toBe(false)
  })
})

describe('sanitizeAssetFilename', () => {
  const outputDir = process.platform === 'win32' ? 'C:\\output' : '/output'

  it('returns simple filenames unchanged', () => {
    expect(sanitizeAssetFilename('image.png', outputDir)).toBe('image.png')
  })

  it('allows subfolder paths', () => {
    expect(sanitizeAssetFilename('myimages/output.png', outputDir)).toBe('myimages/output.png')
  })

  it('allows paths inside a filesystem-root output directory', () => {
    const root = path.parse(path.resolve('/output')).root
    expect(sanitizeAssetFilename('output/image.png', root)).toBe('output/image.png')
  })

  it.each(['C:/outside.png', 'C:outside.png', '//?/C:/outside.png', '//./C:/outside.png'])(
    'rejects Windows drive-qualified and device path %s',
    (filename) => {
      const root = path.parse(path.resolve('/output')).root
      expect(sanitizeAssetFilename(filename, root)).toBeNull()
    },
  )

  it.each(['../../etc/passwd', '../secret.txt', 'a/../../b/file.png'])(
    'rejects path traversal in %s',
    (filename) => {
      expect(sanitizeAssetFilename(filename, outputDir)).toBeNull()
    },
  )

  it.each(['/absolute/path.png', '///triple.png', '\\root-relative.png', '\\\\server\\file.png'])(
    'rejects absolute path %s',
    (filename) => {
      expect(sanitizeAssetFilename(filename, outputDir)).toBeNull()
    },
  )

  it('rejects traversal with backslash separators', () => {
    expect(sanitizeAssetFilename('..\\..\\etc\\passwd', outputDir)).toBeNull()
  })

  it('strips dot segments', () => {
    expect(sanitizeAssetFilename('./file.png', outputDir)).toBe('file.png')
    expect(sanitizeAssetFilename('a/./b/file.png', outputDir)).toBe('a/b/file.png')
  })

  it('normalises backslashes', () => {
    expect(sanitizeAssetFilename('sub\\dir\\file.png', outputDir)).toBe('sub/dir/file.png')
  })

  it('returns null for empty or whitespace filenames', () => {
    expect(sanitizeAssetFilename('', outputDir)).toBeNull()
    expect(sanitizeAssetFilename('   ', outputDir)).toBeNull()
  })

  it('returns null for filenames that resolve to nothing after sanitisation', () => {
    expect(sanitizeAssetFilename('..', outputDir)).toBeNull()
    expect(sanitizeAssetFilename('../..', outputDir)).toBeNull()
    expect(sanitizeAssetFilename('.', outputDir)).toBeNull()
  })

  it.each(['file.png:evil', 'sub/file.png:evil', 'file.png:Zone.Identifier'])(
    'rejects NTFS alternate data stream %s',
    (filename) => {
      expect(sanitizeAssetFilename(filename, outputDir)).toBeNull()
    },
  )

  it.each(['CON', 'NUL.png', 'aux.txt', 'COM1.mp4', 'lpt9', 'sub/nul.png'])(
    'rejects Windows reserved device name %s',
    (filename) => {
      expect(sanitizeAssetFilename(filename, outputDir)).toBeNull()
    },
  )

  it.each(['name.png.', 'name.png ', 'trailing./file.png', 'trailing /file.png'])(
    'rejects trailing dot/space alias %s',
    (filename) => {
      expect(sanitizeAssetFilename(filename, outputDir)).toBeNull()
    },
  )

  it.each(['file<x>.png', 'file|pipe.png', 'file?.png', 'file*.png', 'file"quote.png', 'file\u0001.png'])(
    'rejects Windows-invalid character in %s',
    (filename) => {
      expect(sanitizeAssetFilename(filename, outputDir)).toBeNull()
    },
  )

  it('does not treat reserved-name prefixes as reserved', () => {
    expect(sanitizeAssetFilename('console.png', outputDir)).toBe('console.png')
    expect(sanitizeAssetFilename('nullable.txt', outputDir)).toBe('nullable.txt')
    expect(sanitizeAssetFilename('com10.mp4', outputDir)).toBe('com10.mp4')
  })
})

describe('resolveAssetSavePath', () => {
  const outputDir = path.resolve('/output')

  it('preserves the requested subfolder when the server supplies a basename', () => {
    expect(
      resolveAssetSavePath(
        path.join(outputDir, 'video', 'ltx', 'remote-name.mp4'),
        'display-name.mp4',
        outputDir,
      ),
    ).toBe(path.join(outputDir, 'video', 'ltx', 'display-name.mp4'))
  })

  it('does not duplicate a requested subfolder included in the server name', () => {
    expect(
      resolveAssetSavePath(
        path.join(outputDir, 'images', 'remote-name.png'),
        'images/display-name.png',
        outputDir,
      ),
    ).toBe(path.join(outputDir, 'images', 'display-name.png'))
  })

  it('preserves a server-provided subfolder when none was requested', () => {
    expect(
      resolveAssetSavePath(
        path.join(outputDir, 'remote-name.png'),
        'images/display-name.png',
        outputDir,
      ),
    ).toBe(path.join(outputDir, 'images', 'display-name.png'))
  })

  it.each([
    '../../../../outside.mp4',
    '/outside.mp4',
    '\\outside.mp4',
    'C:\\outside.mp4',
    'C:outside.mp4',
    '\\\\server\\share\\outside.mp4',
    '\\\\?\\C:\\outside.mp4',
    '\\\\.\\C:\\outside.mp4',
  ])('rejects unsafe nested server path %s', (serverName) => {
    expect(
      resolveAssetSavePath(
        path.join(outputDir, 'video', 'ltx', 'remote-name.mp4'),
        serverName,
        outputDir,
      ),
    ).toBeNull()
  })

  it('rejects a current save path outside the output directory', () => {
    expect(
      resolveAssetSavePath(
        path.resolve(outputDir, '..', 'outside', 'remote-name.mp4'),
        'display-name.mp4',
        outputDir,
      ),
    ).toBeNull()
  })

  it.each(['', '.', '..', '/', '\\'])('rejects an invalid nested server basename %j', (serverName) => {
    expect(
      resolveAssetSavePath(
        path.join(outputDir, 'video', 'ltx', 'remote-name.mp4'),
        serverName,
        outputDir,
      ),
    ).toBeNull()
  })

  it('resolves a nested path inside a filesystem-root output directory', () => {
    const root = path.parse(outputDir).root
    expect(
      resolveAssetSavePath(
        path.join(root, 'video', 'ltx', 'remote-name.mp4'),
        'display-name.mp4',
        root,
      ),
    ).toBe(path.join(root, 'video', 'ltx', 'display-name.mp4'))
  })

  it('rejects a drive-qualified server path at the output root', () => {
    const root = path.parse(outputDir).root
    expect(
      resolveAssetSavePath(
        path.join(root, 'remote-name.mp4'),
        'C:\\outside.mp4',
        root,
      ),
    ).toBeNull()
  })
})

describe('asset download retries', () => {
  it('preserves a deduplicated nested path resolved from Content-Disposition', async () => {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-output-'))
    const url = 'https://remote.example/api/view?filename=hash.mp4'
    let willDownload: ((event: unknown, item: Electron.DownloadItem, webContents: null) => void) | undefined
    const session = {
      on: vi.fn((event: string, handler: typeof willDownload) => {
        if (event === 'will-download') willDownload = handler
      }),
      downloadURL: vi.fn(),
    } as unknown as Electron.Session
    const webContents = {
      session,
      send: vi.fn(),
      isDestroyed: () => false,
    } as unknown as Electron.WebContents
    const win = {
      isDestroyed: () => false,
      setProgressBar: vi.fn(),
      webContents,
    } as unknown as Electron.BrowserWindow

    function createItem(contentDisposition: string | null) {
      let done: ((event: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void) | undefined
      const setSavePath = vi.fn<(savePath: string) => void>()
      const item = {
        getURLChain: () => [url],
        getURL: () => url,
        getContentDisposition: () => contentDisposition,
        setSavePath,
        on: vi.fn(),
        once: vi.fn((event: string, handler: typeof done) => {
          if (event === 'done') done = handler
        }),
        getTotalBytes: () => 1,
        getReceivedBytes: () => 1,
        isPaused: () => false,
      } as unknown as Electron.DownloadItem
      return { item, setSavePath, getDone: () => done }
    }

    try {
      const nestedDir = path.join(outputDir, 'video', 'ltx')
      await fs.promises.mkdir(nestedDir, { recursive: true })
      await fs.promises.writeFile(path.join(nestedDir, 'display.mp4'), 'existing')

      await mod.startAssetDownload(win, url, 'video/ltx/hash.mp4', outputDir)
      expect(willDownload).toBeTypeOf('function')

      const first = createItem('attachment; filename="display.mp4"')
      willDownload!({}, first.item, null)
      const firstTempPath = first.setSavePath.mock.calls[0]?.[0]
      expect(firstTempPath).toBeTypeOf('string')
      if (!firstTempPath) throw new Error('First download did not receive a temporary path')
      await fs.promises.writeFile(firstTempPath, 'partial')

      // Same URL: joins the in-flight download instead of re-registering it,
      // so the duplicate destination cannot clobber the retry params.
      await expect(mod.startAssetDownload(win, url, 'duplicate/hash.mp4', outputDir)).resolves.toBe(true)
      expect(session.downloadURL).toHaveBeenCalledTimes(1)
      first.getDone()!({}, 'interrupted')

      expect(mod.retryDownload(url)).toBe(true)
      await vi.waitFor(() => expect(session.downloadURL).toHaveBeenCalledTimes(2))

      const retry = createItem(null)
      willDownload!({}, retry.item, null)
      const retryTempPath = retry.setSavePath.mock.calls[0]?.[0]
      expect(retryTempPath).toBeTypeOf('string')
      if (!retryTempPath) throw new Error('Retry did not receive a temporary path')
      await fs.promises.writeFile(retryTempPath, 'complete')
      retry.getDone()!({}, 'completed')

      await expect(fs.promises.readFile(path.join(nestedDir, 'display (1).mp4'), 'utf8')).resolves.toBe('complete')
    } finally {
      await fs.promises.rm(outputDir, { recursive: true, force: true })
    }
  })

  it('starts a single download when the same URL is requested twice in the same tick', async () => {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-output-'))
    const url = 'https://remote.example/api/view?filename=same-tick.png'
    let willDownload: ((event: unknown, item: Electron.DownloadItem, webContents: null) => void) | undefined
    const session = {
      on: vi.fn((event: string, handler: typeof willDownload) => {
        if (event === 'will-download') willDownload = handler
      }),
      downloadURL: vi.fn(),
    } as unknown as Electron.Session
    const webContents = {
      session,
      send: vi.fn(),
      isDestroyed: () => false,
    } as unknown as Electron.WebContents
    const win = {
      isDestroyed: () => false,
      setProgressBar: vi.fn(),
      webContents,
    } as unknown as Electron.BrowserWindow

    try {
      // Both calls begin before either finishes its async setup - the second
      // must join the first's reservation instead of starting a second
      // download that would save a duplicate file.
      const results = await Promise.all([
        mod.startAssetDownload(win, url, 'same-tick.png', outputDir),
        mod.startAssetDownload(win, url, 'same-tick.png', outputDir),
      ])
      expect(results).toEqual([true, true])
      expect(session.downloadURL).toHaveBeenCalledTimes(1)

      let done: ((event: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void) | undefined
      const setSavePath = vi.fn<(savePath: string) => void>()
      const item = {
        getURLChain: () => [url],
        getURL: () => url,
        getContentDisposition: () => null,
        setSavePath,
        on: vi.fn(),
        once: vi.fn((event: string, handler: typeof done) => {
          if (event === 'done') done = handler
        }),
        getTotalBytes: () => 1,
        getReceivedBytes: () => 1,
        isPaused: () => false,
      } as unknown as Electron.DownloadItem
      willDownload!({}, item, null)
      const tempPath = setSavePath.mock.calls[0]?.[0]
      expect(tempPath).toBeTypeOf('string')
      await fs.promises.writeFile(tempPath!, 'content')
      done!({}, 'completed')

      const saved = await fs.promises.readdir(outputDir)
      expect(saved).toEqual(['same-tick.png'])
    } finally {
      await fs.promises.rm(outputDir, { recursive: true, force: true })
    }
  })

  it('resolves false with an error entry when the save directory cannot be created', async () => {
    // `retryDownload` re-dispatches fire-and-forget, so a setup failure must
    // surface as an error progress event, never a rejected promise.
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-output-'))
    const url = 'https://remote.example/api/view?filename=blocked.png'
    const session = {
      on: vi.fn(),
      downloadURL: vi.fn(),
    } as unknown as Electron.Session
    const send = vi.fn()
    const webContents = {
      session,
      send,
      isDestroyed: () => false,
    } as unknown as Electron.WebContents
    const win = {
      isDestroyed: () => false,
      setProgressBar: vi.fn(),
      webContents,
    } as unknown as Electron.BrowserWindow

    try {
      // The output dir's parent component is a regular file, so mkdir of the
      // nested save directory fails.
      const blocker = path.join(base, 'blocker')
      await fs.promises.writeFile(blocker, 'file, not a directory')
      const outputDir = path.join(blocker, 'output')

      await expect(mod.startAssetDownload(win, url, 'sub/blocked.png', outputDir)).resolves.toBe(false)
      expect(session.downloadURL).not.toHaveBeenCalled()

      const errorEvents = send.mock.calls.filter(
        ([channel, progress]) =>
          channel === 'desktop2-download-progress' &&
          (progress as { status?: string }).status === 'error',
      )
      expect(errorEvents).toHaveLength(1)
      expect((errorEvents[0]?.[1] as { error?: string }).error).toMatch(/Failed to create download directory/)

      // The reservation is released - the URL is not stuck as an active download.
      expect(mod.getActiveDownloads().some((d) => d.url === url)).toBe(false)
    } finally {
      mod.dismissRecentDownload(url)
      await fs.promises.rm(base, { recursive: true, force: true })
    }
  })

  it('re-downloads a URL that completed earlier and keeps a single copy when identical', async () => {
    // The same output event can be delivered again after the download has
    // finished (a replay across a reconnect, a re-run re-serving the URL).
    // The repeat downloads again and the content-identity check discards it
    // in favor of the existing file, so no "repeat (1).png" appears.
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-output-'))
    const url = 'https://remote.example/api/view?filename=repeat.png'
    const h = makeAssetHarness()

    try {
      await expect(mod.startAssetDownload(h.win, url, 'repeat.png', outputDir)).resolves.toBe(true)
      expect(h.session.downloadURL).toHaveBeenCalledTimes(1)
      const first = h.createItem(url)
      h.getWillDownload()!({}, first.item, null)
      const tempPath = first.setSavePath.mock.calls[0]?.[0]
      expect(tempPath).toBeTypeOf('string')
      await fs.promises.writeFile(tempPath!, 'content')
      first.getDone()!({}, 'completed')
      await expect(fs.promises.readdir(outputDir)).resolves.toEqual(['repeat.png'])

      await expect(mod.startAssetDownload(h.win, url, 'repeat.png', outputDir)).resolves.toBe(true)
      expect(h.session.downloadURL).toHaveBeenCalledTimes(2)
      const second = h.createItem(url)
      h.getWillDownload()!({}, second.item, null)
      const tempPath2 = second.setSavePath.mock.calls[0]?.[0]
      expect(tempPath2).toBeTypeOf('string')
      await fs.promises.writeFile(tempPath2!, 'content')
      second.getDone()!({}, 'completed')
      await expect(fs.promises.readdir(outputDir)).resolves.toEqual(['repeat.png'])
    } finally {
      await fs.promises.rm(outputDir, { recursive: true, force: true })
    }
  })

  function makeAssetHarness() {
    let willDownload: ((event: unknown, item: Electron.DownloadItem, webContents: null) => void) | undefined
    const session = {
      on: vi.fn((event: string, handler: typeof willDownload) => {
        if (event === 'will-download') willDownload = handler
      }),
      downloadURL: vi.fn(),
    } as unknown as Electron.Session
    const send = vi.fn()
    const webContents = {
      session,
      send,
      isDestroyed: () => false,
    } as unknown as Electron.WebContents
    const win = {
      isDestroyed: () => false,
      setProgressBar: vi.fn(),
      webContents,
    } as unknown as Electron.BrowserWindow

    function createItem(itemUrl: string) {
      let done: ((event: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void) | undefined
      const setSavePath = vi.fn<(savePath: string) => void>()
      const item = {
        getURLChain: () => [itemUrl],
        getURL: () => itemUrl,
        getContentDisposition: () => null,
        setSavePath,
        on: vi.fn(),
        once: vi.fn((event: string, handler: typeof done) => {
          if (event === 'done') done = handler
        }),
        getTotalBytes: () => 1,
        getReceivedBytes: () => 1,
        isPaused: () => false,
      } as unknown as Electron.DownloadItem
      return { item, setSavePath, getDone: () => done }
    }

    return { win, session, send, getWillDownload: () => willDownload, createItem }
  }

  it('discards the download when an identical file already sits at the requested path', async () => {
    // The "remote" server may be a local ComfyUI writing outputs into the
    // same directory the auto-download saves to (desktop launches installs
    // with --output-directory <shared outputDir>). The server saves the file
    // first, so the download must be discarded instead of saved as "x (1)".
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-output-'))
    const url = 'https://remote.example/api/view?filename=served.png&subfolder=subdir'
    const h = makeAssetHarness()

    try {
      await fs.promises.mkdir(path.join(outputDir, 'subdir'), { recursive: true })
      await fs.promises.writeFile(path.join(outputDir, 'subdir', 'served.png'), 'identical-bytes')

      await expect(mod.startAssetDownload(h.win, url, 'subdir/served.png', outputDir)).resolves.toBe(true)
      const dl = h.createItem(url)
      h.getWillDownload()!({}, dl.item, null)
      const tempPath = dl.setSavePath.mock.calls[0]?.[0]
      expect(tempPath).toBeTypeOf('string')
      await fs.promises.writeFile(tempPath!, 'identical-bytes')
      dl.getDone()!({}, 'completed')

      await expect(fs.promises.readdir(path.join(outputDir, 'subdir'))).resolves.toEqual(['served.png'])
      const completed = h.send.mock.calls
        .map((c) => c[1] as { status?: string; savePath?: string; filename?: string })
        .filter((p) => p?.status === 'completed')
      expect(completed).toHaveLength(1)
      expect(completed[0]!.savePath).toBe(path.join(outputDir, 'subdir', 'served.png'))
      expect(completed[0]!.filename).toBe('served.png')
    } finally {
      await fs.promises.rm(outputDir, { recursive: true, force: true })
    }
  })

  it('keeps the deduplicated copy when the existing file has different content', async () => {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-output-'))
    const url = 'https://remote.example/api/view?filename=changed.png'
    const h = makeAssetHarness()

    try {
      await fs.promises.writeFile(path.join(outputDir, 'changed.png'), 'old-bytes')

      await expect(mod.startAssetDownload(h.win, url, 'changed.png', outputDir)).resolves.toBe(true)
      const dl = h.createItem(url)
      h.getWillDownload()!({}, dl.item, null)
      const tempPath = dl.setSavePath.mock.calls[0]?.[0]
      expect(tempPath).toBeTypeOf('string')
      await fs.promises.writeFile(tempPath!, 'new-bytes')
      dl.getDone()!({}, 'completed')

      const saved = (await fs.promises.readdir(outputDir)).sort()
      expect(saved).toEqual(['changed (1).png', 'changed.png'])
      await expect(fs.promises.readFile(path.join(outputDir, 'changed.png'), 'utf8')).resolves.toBe('old-bytes')
      await expect(fs.promises.readFile(path.join(outputDir, 'changed (1).png'), 'utf8')).resolves.toBe('new-bytes')
    } finally {
      await fs.promises.rm(outputDir, { recursive: true, force: true })
    }
  })

  it('allocates distinct temp paths for same-named downloads started in the same millisecond', async () => {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-output-'))
    // Freeze the clock: with a timestamp-only temp name these two downloads
    // would collide on the same temp file.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const urlA = 'https://remote.example/api/view?filename=a-video.mp4'
    const urlB = 'https://remote.example/api/view?filename=b-video.mp4'
    let willDownload: ((event: unknown, item: Electron.DownloadItem, webContents: null) => void) | undefined
    const session = {
      on: vi.fn((event: string, handler: typeof willDownload) => {
        if (event === 'will-download') willDownload = handler
      }),
      downloadURL: vi.fn(),
    } as unknown as Electron.Session
    const webContents = {
      session,
      send: vi.fn(),
      isDestroyed: () => false,
    } as unknown as Electron.WebContents
    const win = {
      isDestroyed: () => false,
      setProgressBar: vi.fn(),
      webContents,
    } as unknown as Electron.BrowserWindow

    function createItem(url: string) {
      let done: ((event: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void) | undefined
      const setSavePath = vi.fn<(savePath: string) => void>()
      const item = {
        getURLChain: () => [url],
        getURL: () => url,
        getContentDisposition: () => null,
        setSavePath,
        on: vi.fn(),
        once: vi.fn((event: string, handler: typeof done) => {
          if (event === 'done') done = handler
        }),
        getTotalBytes: () => 1,
        getReceivedBytes: () => 1,
        isPaused: () => false,
      } as unknown as Electron.DownloadItem
      return { item, setSavePath, getDone: () => done }
    }

    try {
      await mod.startAssetDownload(win, urlA, 'a/video.mp4', outputDir)
      await mod.startAssetDownload(win, urlB, 'b/video.mp4', outputDir)
      expect(willDownload).toBeTypeOf('function')

      const a = createItem(urlA)
      const b = createItem(urlB)
      willDownload!({}, a.item, null)
      willDownload!({}, b.item, null)

      const tempA = a.setSavePath.mock.calls[0]?.[0]
      const tempB = b.setSavePath.mock.calls[0]?.[0]
      expect(tempA).toBeTypeOf('string')
      expect(tempB).toBeTypeOf('string')
      expect(tempA).not.toBe(tempB)

      // Complete both so they land on their own nested destinations.
      await fs.promises.writeFile(tempA!, 'content-a')
      await fs.promises.writeFile(tempB!, 'content-b')
      a.getDone()!({}, 'completed')
      b.getDone()!({}, 'completed')
      await expect(fs.promises.readFile(path.join(outputDir, 'a', 'video.mp4'), 'utf8')).resolves.toBe('content-a')
      await expect(fs.promises.readFile(path.join(outputDir, 'b', 'video.mp4'), 'utf8')).resolves.toBe('content-b')
    } finally {
      nowSpy.mockRestore()
      await fs.promises.rm(outputDir, { recursive: true, force: true })
    }
  })
})

describe('parseContentDispositionFilename', () => {
  it('returns null for null/empty input', () => {
    expect(parseContentDispositionFilename(null)).toBeNull()
    expect(parseContentDispositionFilename('')).toBeNull()
  })

  it('parses quoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename="photo.png"')).toBe('photo.png')
  })

  it('parses unquoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename=photo.png')).toBe('photo.png')
  })

  it('parses RFC 5987 encoded filename*', () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''NetaYume_%E7%A7%98.png")).toBe('NetaYume_秘.png')
  })

  it('prefers filename* over filename', () => {
    expect(parseContentDispositionFilename("attachment; filename=\"fallback.png\"; filename*=UTF-8''preferred.png")).toBe('preferred.png')
  })

  it('parses GCS response-content-disposition format', () => {
    expect(parseContentDispositionFilename('attachment; filename="NetaYume_Lumina_3.5_00187_.png"')).toBe('NetaYume_Lumina_3.5_00187_.png')
  })

  it('returns null for header without filename', () => {
    expect(parseContentDispositionFilename('inline')).toBeNull()
    expect(parseContentDispositionFilename('attachment')).toBeNull()
  })
})

/**
 * The Preview Image "Save image..." right-click goes through Electron's
 * generic Save dialog; Windows collapses the "Save as type" dropdown to
 * "All Files (*.*)" if `filters` is omitted, which is the symptom field-
 * reported in #989. These tests lock the primary-extension inference and
 * the All Files fallback so the dialog always opens on a sensible format.
 */
describe('buildSaveDialogFilters (#989 save-image extension filters)', () => {
  it('picks PNG as the primary filter for a .png filename', () => {
    const filters = buildSaveDialogFilters('ComfyUI_00001_.png')
    expect(filters[0]).toEqual({ name: 'PNG Image', extensions: ['png'] })
    expect(filters.at(-1)).toEqual({ name: 'All Files', extensions: ['*'] })
  })

  it('groups jpg and jpeg under the same JPEG family filter', () => {
    expect(buildSaveDialogFilters('photo.jpg')[0]).toEqual({
      name: 'JPEG Image',
      extensions: ['jpg', 'jpeg'],
    })
    expect(buildSaveDialogFilters('photo.jpeg')[0]).toEqual({
      name: 'JPEG Image',
      extensions: ['jpg', 'jpeg'],
    })
  })

  it.each([
    ['out.webp', 'WebP Image', 'webp'],
    ['anim.gif', 'GIF Image', 'gif'],
    ['clip.mp4', 'MP4 Video', 'mp4'],
    ['clip.webm', 'WebM Video', 'webm'],
    ['clip.mov', 'QuickTime Video', 'mov'],
    ['voice.wav', 'WAV Audio', 'wav'],
    ['voice.mp3', 'MP3 Audio', 'mp3'],
    ['voice.flac', 'FLAC Audio', 'flac'],
    ['voice.ogg', 'OGG Audio', 'ogg'],
  ] as const)('maps %s to %s', (filename, expectedName, expectedExt) => {
    const filters = buildSaveDialogFilters(filename)
    expect(filters[0]).toEqual({ name: expectedName, extensions: [expectedExt] })
    expect(filters.at(-1)).toEqual({ name: 'All Files', extensions: ['*'] })
  })

  it('is case-insensitive on the input extension', () => {
    expect(buildSaveDialogFilters('CAPS.PNG')[0]).toEqual({
      name: 'PNG Image',
      extensions: ['png'],
    })
  })

  it('falls back to a literal-extension filter for unknown types', () => {
    const filters = buildSaveDialogFilters('weird.xyz')
    expect(filters[0]).toEqual({ name: 'XYZ File', extensions: ['xyz'] })
    expect(filters.at(-1)).toEqual({ name: 'All Files', extensions: ['*'] })
  })

  it('returns only All Files when there is no extension at all', () => {
    expect(buildSaveDialogFilters('justname')).toEqual([
      { name: 'All Files', extensions: ['*'] },
    ])
  })
})

describe('template tray-mirror cleanup', () => {
  const entry = (url: string, status: 'downloading' | 'completed') => ({
    url,
    filename: url.split('/').pop()!,
    progress: status === 'completed' ? 100 : 40,
    status,
  })

  it('dismissRecentDownload removes a finished mirrored template row', () => {
    mod.setTemplateTrayMirror('inst-a', [entry('template-model://checkpoints/m.safetensors', 'completed')])
    expect(mod.getDownloadsTrayState().recent.some((r) => r.url.includes('m.safetensors'))).toBe(true)

    expect(mod.dismissRecentDownload('template-model://checkpoints/m.safetensors')).toBe(true)
    expect(mod.getDownloadsTrayState().recent.some((r) => r.url.includes('m.safetensors'))).toBe(false)
  })

  it('clearFinishedDownloads purges terminal mirror rows but keeps in-flight ones', () => {
    mod.setTemplateTrayMirror('inst-b', [
      entry('template-model://vae/done.safetensors', 'completed'),
      entry('template-model://vae/live.safetensors', 'downloading'),
    ])
    const removed = mod.clearFinishedDownloads()
    expect(removed).toBeGreaterThanOrEqual(1)

    const tray = mod.getDownloadsTrayState()
    expect(tray.recent.some((r) => r.url.includes('done.safetensors'))).toBe(false)
    // The still-downloading row survives in `active`.
    expect(tray.active.some((r) => r.url.includes('live.safetensors'))).toBe(true)

    mod.clearTemplateTrayMirror('inst-b') // cleanup so other tests start clean
  })
})

describe('template mirror visibility in the All-Downloads modal', () => {
  const entry = (url: string) => ({
    url,
    filename: url.split('/').pop()!,
    progress: 40,
    status: 'downloading' as const,
  })

  it('getAllDownloads() includes template-mirror rows (modal seed)', () => {
    mod.setTemplateTrayMirror('inst-seed', [entry('template-model://loras/x.safetensors')])
    expect(mod.getAllDownloads().some((d) => d.url.includes('x.safetensors'))).toBe(true)
    mod.clearTemplateTrayMirror('inst-seed')
  })

  it('setTemplateTrayMirror fans each row out as model-download-progress (modal live)', async () => {
    const { BrowserWindow } = (await import('electron')) as unknown as {
      BrowserWindow: { getAllWindows: () => unknown[] }
    }
    const send = vi.fn()
    const fakeWin = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }
    const spy = vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([fakeWin])
    try {
      mod.setTemplateTrayMirror('inst-live', [entry('template-model://vae/y.safetensors')])
      const progressCalls = send.mock.calls.filter((c) => c[0] === 'model-download-progress')
      expect(progressCalls.length).toBeGreaterThanOrEqual(1)
      expect(progressCalls.some((c) => (c[1] as { url: string }).url.includes('y.safetensors'))).toBe(true)
    } finally {
      spy.mockRestore()
      mod.clearTemplateTrayMirror('inst-live')
    }
  })
})

describe('areModelsPresent', () => {
  let base: string

  beforeAll(async () => {
    base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'amp-'))
    await fs.promises.mkdir(path.join(base, 'checkpoints'), { recursive: true })
    await fs.promises.mkdir(path.join(base, 'vae'), { recursive: true })
    await fs.promises.writeFile(path.join(base, 'checkpoints', 'a.safetensors'), 'x')
    await fs.promises.writeFile(path.join(base, 'vae', 'b.safetensors'), 'x')
    vi.spyOn(settings, 'get').mockImplementation((key) =>
      key === 'modelsDirs' ? [base] : (settings.defaults as Record<string, unknown>)[key],
    )
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await fs.promises.rm(base, { recursive: true, force: true })
  })

  it('returns false for an empty model list', async () => {
    expect(await areModelsPresent(null, [])).toBe(false)
  })

  it('returns true only when every model is on disk (shared dir, no install)', async () => {
    const present = await areModelsPresent(null, [
      { directory: 'checkpoints', filename: 'a.safetensors' },
      { directory: 'vae', filename: 'b.safetensors' },
    ])
    expect(present).toBe(true)
  })

  it('returns false when any single model is missing', async () => {
    const present = await areModelsPresent(null, [
      { directory: 'checkpoints', filename: 'a.safetensors' },
      { directory: 'vae', filename: 'missing.safetensors' },
    ])
    expect(present).toBe(false)
  })
})
