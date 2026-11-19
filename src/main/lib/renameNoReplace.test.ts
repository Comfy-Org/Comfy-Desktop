import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installStagedAtFinal,
  scanForStagedDownloads,
  stagingMetaPathFor,
  stagingPathFor,
  writeStagedMeta
} from './modelDownloadStaging'
import * as exclusiveRename from './renameNoReplace'

const { renameNoReplace } = exclusiveRename
const testRoot = process.env.COMFY_TEST_RENAME_ROOT ?? os.tmpdir()
const expectLinkFailure = process.env.COMFY_TEST_RENAME_NO_LINK === '1'
const crossVolumeRoot = process.env.COMFY_TEST_RENAME_OTHER_VOLUME
const model = 'verified model bytes'

let dir: string
let final: string
let staged: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(testRoot, 'comfy-model-rename-'))
  final = path.join(dir, '模型 with spaces.safetensors')
  staged = stagingPathFor(final)
  fs.writeFileSync(staged, model)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('native exclusive rename', () => {
  it('moves the complete file at a long Unicode path', async () => {
    const nested = path.join(
      dir,
      '目录'.repeat(35),
      '模型 '.repeat(35) + 'x',
      'path '.repeat(25) + 'x'
    )
    fs.mkdirSync(nested, { recursive: true })
    const source = path.join(nested, '模型 weights.part')
    const destination = path.join(nested, '模型 weights.safetensors')
    fs.writeFileSync(source, model)
    expect(destination.length).toBeGreaterThan(260)
    await renameNoReplace(source, destination)
    expect(fs.existsSync(source)).toBe(false)
    expect(fs.readFileSync(destination, 'utf8')).toBe(model)
  })

  it('reports a missing source without changing the destination', async () => {
    await expect(renameNoReplace(staged + '.missing', final)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(fs.existsSync(final)).toBe(false)
  })

  it.skipIf(!crossVolumeRoot)('rejects a move across volumes without copying', async () => {
    const otherDir = fs.mkdtempSync(path.join(crossVolumeRoot!, 'comfy-model-rename-'))
    try {
      const destination = path.join(otherDir, 'cross-volume.safetensors')
      await expect(renameNoReplace(staged, destination)).rejects.toMatchObject({ code: 'EXDEV' })
      expect(fs.readFileSync(staged, 'utf8')).toBe(model)
      expect(fs.existsSync(destination)).toBe(false)
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true })
    }
  })
})

describe('native model finalization', () => {
  function requireRenameFallback(): void {
    if (expectLinkFailure) {
      expect(() => fs.linkSync(staged, final + '.link-probe')).toThrow()
    } else {
      vi.spyOn(fs, 'linkSync').mockImplementation(() => {
        throw Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' })
      })
    }
  }

  it('installs verified bytes with neither a placeholder nor a copy', async () => {
    requireRenameFallback()
    const open = vi.spyOn(fs, 'openSync')
    const copy = vi.spyOn(fs, 'copyFileSync')
    const asyncCopy = vi.spyOn(fs.promises, 'copyFile')
    await installStagedAtFinal(staged, final, Buffer.byteLength(model))
    expect(open.mock.calls.some(([filename]) => filename === final)).toBe(false)
    expect(copy).not.toHaveBeenCalled()
    expect(asyncCopy).not.toHaveBeenCalled()
    expect(fs.readdirSync(dir)).toEqual([path.basename(final)])
    expect(fs.readFileSync(final, 'utf8')).toBe(model)
  })

  it.each([
    { same: true, competingBytes: model },
    { same: false, competingBytes: 'x'.repeat(model.length) }
  ])(
    'handles an independent writer with same content = $same',
    async ({ same, competingBytes }) => {
      requireRenameFallback()
      vi.spyOn(exclusiveRename, 'renameNoReplace').mockImplementation(
        async (source, destination) => {
          expect(fs.existsSync(destination)).toBe(false)
          execFileSync(process.execPath, [
            '-e',
            "require('node:fs').writeFileSync(process.argv[1], process.argv[2], { flag: 'wx' })",
            destination,
            competingBytes
          ])
          await renameNoReplace(source, destination)
        }
      )
      const result = installStagedAtFinal(staged, final, Buffer.byteLength(model))
      if (same) {
        await result
        expect(fs.existsSync(staged)).toBe(false)
      } else {
        await expect(result).rejects.toThrow('a different file already exists')
        expect(fs.readFileSync(staged, 'utf8')).toBe(model)
      }
      expect(fs.readFileSync(final, 'utf8')).toBe(competingBytes)
    }
  )

  it('does not treat a directory as an installable model', async () => {
    fs.unlinkSync(staged)
    fs.mkdirSync(staged)
    const move = vi.spyOn(exclusiveRename, 'renameNoReplace')
    await expect(installStagedAtFinal(staged, final, model.length)).rejects.toThrow('regular file')
    expect(move).not.toHaveBeenCalled()
    expect(fs.existsSync(final)).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')(
    'preserves a genuine directory error from the hard-link call',
    async () => {
      fs.mkdirSync(final)
      const linkError = Object.assign(new Error('directory'), { code: 'EISDIR' })
      vi.spyOn(fs, 'linkSync').mockImplementation(() => {
        throw linkError
      })
      const move = vi.spyOn(exclusiveRename, 'renameNoReplace')
      await expect(installStagedAtFinal(staged, final, model.length)).rejects.toBe(linkError)
      expect(move).not.toHaveBeenCalled()
      expect(fs.statSync(final).isDirectory()).toBe(true)
      expect(fs.readFileSync(staged, 'utf8')).toBe(model)
    }
  )

  it.each(['before', 'after'])('recovers after termination %s the native move', async (point) => {
    writeStagedMeta(stagingMetaPathFor(final), {
      version: 2,
      url: 'https://example.com/model',
      expectedSize: model.length,
      readyToInstall: true,
      directory: 'checkpoints',
      filename: path.basename(final)
    })
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { pathToFileURL } from 'node:url'
        const [file, point, source, destination] = process.argv.slice(1)
        const { renameNoReplace } = await import(pathToFileURL(file).href)
        if (point === 'after') await renameNoReplace(source, destination)
        process.send('ready')
        setInterval(() => {}, 1000)`,
        path.resolve('src/main/lib/renameNoReplace.ts'),
        point,
        staged,
        final
      ],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }
    )
    const exit = once(child, 'exit')
    try {
      const [ready] = await Promise.race([once(child, 'message'), exit])
      expect(ready).toBe('ready')
    } finally {
      child.kill()
      await exit
    }

    const scan = await scanForStagedDownloads([dir])
    if (point === 'before') {
      expect(scan.downloads).toMatchObject([{ finalPath: final, stagedBytes: model.length }])
      expect(fs.existsSync(final)).toBe(false)
      expect(fs.existsSync(stagingMetaPathFor(final))).toBe(true)
    } else {
      expect(scan.downloads).toEqual([])
      expect(fs.readFileSync(final, 'utf8')).toBe(model)
      expect(fs.existsSync(stagingMetaPathFor(final))).toBe(false)
    }
  })
})
