import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'

import { auditVcRuntime, isDllLoadFailure } from './vcRuntimeAudit'

const originalPlatform = process.platform

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function mockAccessMissing(...missing: string[]): void {
  vi.spyOn(fs.promises, 'access').mockImplementation((p: fs.PathLike): Promise<void> => {
    const target = String(p)
    if (missing.some((dll) => target.endsWith(dll))) {
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    }
    return Promise.resolve()
  })
}

describe('auditVcRuntime', () => {
  afterEach(() => {
    setPlatform(originalPlatform)
    vi.restoreAllMocks()
  })

  it('returns an empty array on non-Windows platforms without touching the fs', async () => {
    setPlatform('linux')
    const accessSpy = vi.spyOn(fs.promises, 'access')
    expect(await auditVcRuntime()).toEqual([])
    expect(accessSpy).not.toHaveBeenCalled()
  })

  it('reports no missing DLLs when all are present on Windows', async () => {
    setPlatform('win32')
    mockAccessMissing()
    expect(await auditVcRuntime()).toEqual([])
  })

  it('reports a specific DLL when it is absent (ENOENT) on Windows', async () => {
    setPlatform('win32')
    mockAccessMissing('vcruntime140_1.dll')
    expect(await auditVcRuntime()).toEqual(['vcruntime140_1.dll'])
  })

  it('reports every missing DLL', async () => {
    setPlatform('win32')
    mockAccessMissing('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll')
    expect(new Set(await auditVcRuntime())).toEqual(
      new Set(['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'])
    )
  })

  it('treats a non-ENOENT error (e.g. permissions) as inconclusive, not missing', async () => {
    setPlatform('win32')
    vi.spyOn(fs.promises, 'access').mockImplementation((p: fs.PathLike): Promise<void> => {
      if (String(p).endsWith('msvcp140.dll')) {
        return Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
      }
      return Promise.resolve()
    })
    expect(await auditVcRuntime()).toEqual([])
  })
})

describe('isDllLoadFailure', () => {
  it.each([
    [
      'torch c10.dll not found',
      'OSError: [WinError 126] The specified module could not be found. Error loading ' +
        '"C:\\ComfyUI\\.venv\\Lib\\site-packages\\torch\\lib\\c10.dll" or one of its dependencies.'
    ],
    [
      'localized c10.dll init failure',
      'OSError: [WinError 1114] 动态链接库(DLL)初始化例程失败。 Error loading ' +
        '"D:\\ComfyUI\\.venv\\Lib\\site-packages\\torch\\lib\\c10.dll" or one of its dependencies.'
    ],
    [
      'a library loaded through ctypes',
      'FileNotFoundError: Could not find module ' +
        "'C:\\ComfyUI\\.venv\\Lib\\site-packages\\comfy_aimdo\\aimdo.dll' " +
        '(or one of its dependencies). Try using the full path with constructor syntax.'
    ],
    [
      'extension module import',
      'ImportError: DLL load failed while importing _C: 指定されたモジュールが見つかりません。'
    ]
  ])('matches %s', (_name, output) => {
    expect(isDllLoadFailure(output)).toBe(true)
  })

  it.each([
    ['a CUDA traceback', 'Traceback (most recent call last):\nRuntimeError: CUDA error'],
    ['a paging file error', 'OSError: [WinError 1455] The paging file is too small'],
    ['a different WinError with the same digits', 'OSError: [WinError 1260] blocked'],
    ['a missing module with no dependency wording', "Could not find module 'foo'"],
    ['empty output', '']
  ])('ignores %s', (_name, output) => {
    expect(isDllLoadFailure(output)).toBe(false)
  })
})
