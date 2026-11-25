import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false } }))

vi.mock('../settings', () => ({
  get: () => undefined,
  defaults: { inputDir: '/shared/input', outputDir: '/shared/output' }
}))

import { resolveFolderArg } from './startupArgFolders'

describe('a folder named in Startup arguments, on Windows', () => {
  const startDir = (): string => 'E:\\builds\\comfy-private'
  const resolve = (value: string): string => resolveFolderArg(value, startDir, path.win32)

  it('keeps a path with a drive as written', () => {
    expect(resolve('D:\\renders')).toBe('D:\\renders')
  })

  it('keeps a network share path as written', () => {
    expect(resolve('\\\\nas\\share\\renders')).toBe('\\\\nas\\share\\renders')
  })

  it('puts a path rooted without a drive on the drive ComfyUI starts on', () => {
    expect(resolve('/inputs')).toBe('E:\\inputs')
    expect(resolve('\\inputs')).toBe('E:\\inputs')
  })

  it('resolves a relative path from the folder ComfyUI starts in', () => {
    expect(resolve('renders')).toBe('E:\\builds\\comfy-private\\renders')
  })
})

describe('a folder named in Startup arguments, on macOS and Linux', () => {
  const resolve = (value: string): string =>
    resolveFolderArg(value, () => '/builds/comfy-private', path.posix)

  it('keeps an absolute path as written', () => {
    expect(resolve('/renders')).toBe('/renders')
  })

  it('resolves a relative path from the folder ComfyUI starts in', () => {
    expect(resolve('renders')).toBe('/builds/comfy-private/renders')
  })
})
