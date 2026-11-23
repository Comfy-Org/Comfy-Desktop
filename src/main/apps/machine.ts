import type { ComfyDesktopMachine } from '../../types/comfyDesktopBridge'
import type { SystemInfo } from '../../types/ipc'
import { hardwareWithin } from '../lib/agentClientContext'
import { isVirtualGpu, isVirtualMachineGpu } from '../lib/gpu'

type Platform = ComfyDesktopMachine['platform']
type ProbedGpus = Partial<
  Pick<SystemInfo, 'gpu_vendor' | 'gpu_model' | 'gpu_vram_mb' | 'gpu_vram_gb' | 'gpus'>
>

const PROBE_WAIT_MS = 5000

function platformOf(platform: NodeJS.Platform): Platform {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux'
}

function hasNoGpu({ gpu_vendor: vendor, gpus = [] }: ProbedGpus): boolean {
  return vendor === null && gpus.length > 0 && gpus.every((gpu) => isVirtualMachineGpu(gpu.model))
}

function gpuMemoryOf(probed: ProbedGpus, platform: Platform): number | undefined {
  const { gpu_model: model, gpu_vram_mb: mb, gpu_vram_gb: gb } = probed
  if (!model || isVirtualGpu(model) || !mb || typeof gb !== 'number') return undefined
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
