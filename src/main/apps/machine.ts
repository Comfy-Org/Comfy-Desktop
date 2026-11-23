import type { ComfyDesktopMachine } from '../../types/comfyDesktopBridge'
import { hardwareWithin } from '../lib/agentClientContext'

const PROBE_WAIT_MS = 5000

function platformOf(platform: NodeJS.Platform): ComfyDesktopMachine['platform'] {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux'
}

export async function machine(
  platform: NodeJS.Platform = process.platform
): Promise<ComfyDesktopMachine> {
  const gb = (await hardwareWithin(PROBE_WAIT_MS))?.['gpu_vram_gb']
  const known = typeof gb === 'number' && Number.isFinite(gb) && gb > 0
  return { platform: platformOf(platform), ...(known ? { gpuMemoryGb: gb } : {}) }
}
