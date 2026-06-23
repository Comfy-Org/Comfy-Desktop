import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'

import { auditVcRuntime } from './vcRuntimeAudit'

const originalPlatform = process.platform

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

/** Build a fake `fs.promises.access` that rejects (ENOENT) for the named DLLs
 *  and resolves for everything else. */
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
      new Set(['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']),
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
