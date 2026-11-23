import type { ComfyDesktopMachine } from '../../types/comfyDesktopBridge'
import type { SystemInfo } from '../../types/ipc'
import { hardwareWithin } from '../lib/agentClientContext'

type Platform = ComfyDesktopMachine['platform']
type ProbedGpus = Partial<Pick<SystemInfo, 'gpu_vendor' | 'gpu_vram_mb' | 'gpu_vram_gb' | 'gpus'>>

const PROBE_WAIT_MS = 5000
const VIRTUAL_MACHINE_GPU = /vmware|virtualbox|hyper-?v|virtio|\bqxl\b|bochs/i

function platformOf(platform: NodeJS.Platform): Platform {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux'
}

function hasNoGpu({ gpu_vendor: vendor, gpus = [] }: ProbedGpus): boolean {
  return (
    vendor === null && gpus.length > 0 && gpus.every((gpu) => VIRTUAL_MACHINE_GPU.test(gpu.model))
  )
}

function gpuMemoryOf(probed: ProbedGpus, platform: Platform): number | undefined {
  const { gpu_vram_mb: mb, gpu_vram_gb: gb } = probed
  if (!mb || !Number.isFinite(mb) || mb < 0 || typeof gb !== 'number') return undefined
  return gb === 0 && platform !== 'win32' ? undefined : gb
}

export async function machine(
  nodePlatform: NodeJS.Platform = process.platform
): Promise<ComfyDesktopMachine> {
  const platform = platformOf(nodePlatform)
  const probed: ProbedGpus = (await hardwareWithin(PROBE_WAIT_MS)) ?? {}
  if (platform !== 'darwin' && hasNoGpu(probed)) return { platform, noGpu: true }
  const gpuMemoryGb = gpuMemoryOf(probed, platform)
  return { platform, ...(gpuMemoryGb === undefined ? {} : { gpuMemoryGb }) }
}
