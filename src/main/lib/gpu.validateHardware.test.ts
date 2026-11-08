// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  wmiPnpIds: null as string[] | null,
  nvidiaSmi: false
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    execFile: (file: string, ...rest: unknown[]) => {
      const cb = rest[rest.length - 1] as (err: Error | null, stdout: string) => void
      if (file === 'powershell.exe') {
        if (probe.wmiPnpIds === null) cb(new Error('WMI unavailable'), '')
        else cb(null, JSON.stringify(probe.wmiPnpIds))
      } else if (file === 'nvidia-smi') {
        cb(probe.nvidiaSmi ? null : new Error('not found'), '')
      } else {
        cb(new Error(`unexpected ${file}`), '')
      }
    }
  }
})

const SPARK_GPU = 'PCI\\VEN_10DE&DEV_2E12&SUBSYS_00000000&REV_A1\\4&1234&0&0008'
const ADRENO_GPU = 'ACPI\\QCOM0C36\\2&DABA3FF&0'

describe('validateHardware on Windows', () => {
  const realPlatform = process.platform
  const realArch = process.arch

  async function validate(arch: NodeJS.Architecture) {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    Object.defineProperty(process, 'arch', { value: arch })
    const { validateHardware } = await import('./gpu')
    return validateHardware()
  }

  beforeEach(() => {
    vi.resetModules()
    probe.wmiPnpIds = null
    probe.nvidiaSmi = false
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
    Object.defineProperty(process, 'arch', { value: realArch })
  })

  it('allows the native ARM64 app on an NVIDIA GPU', async () => {
    probe.wmiPnpIds = [SPARK_GPU]
    expect(await validate('arm64')).toEqual({ supported: true })
  })

  it('allows the native ARM64 app when only nvidia-smi finds the GPU', async () => {
    probe.nvidiaSmi = true
    expect(await validate('arm64')).toEqual({ supported: true })
  })

  it('blocks the native ARM64 app without an NVIDIA GPU and points to the x64 build', async () => {
    probe.wmiPnpIds = [ADRENO_GPU]
    const result = await validate('arm64')
    expect(result.supported).toBe(false)
    expect(result.error).toContain('x64 version')
    expect(result.error).toContain('comfy.org/download')
  })

  it('does not gate the x64 app on the GPU', async () => {
    probe.wmiPnpIds = [ADRENO_GPU]
    expect(await validate('x64')).toEqual({ supported: true })
  })
})
